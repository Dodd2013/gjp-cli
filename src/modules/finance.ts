/**
 * 财务模块：往来单位应收应付汇总、往来对账明细、付款单、收款单。
 *
 * - listArrears: `analysiscloud/btypeAnalyse/listBtypeAnalyse`（按客户/供应商汇总应收/应付/预收/预付余额）
 * - listReconciliation: `analysiscloud/accountReconciliation/listNewAccountReconciliation`（某往来单位的对账明细：单据/已核销/未核销余额）
 * - createPayment / createReceipt: `recordsheet/finance/getBill` 取模板 → 填充 → `recordsheet/finance/submitBill/`
 *   - 付款单 Payment(FK-, intVchtype 4002, btype=供应商)；收款单 Receiving(SK-, intVchtype 4001, btype=客户)
 *   - 金额经 `accountDetail`（资金账户+金额）登记；默认不核销具体单据（balanceBillDetail:[]），直接冲减往来余额
 *
 * 关键枚举：bcategory 0=客户(应收) 1=供应商(应付)。
 */
import { JxcClient, ApiError } from "../api/client.ts";

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(4) : 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export type ArrearsKind = "customer" | "supplier" | "all";

/** 应收应付汇总项 */
export interface ArrearsItem {
  id: string;
  name: string;
  /** 客户 / 供应商 / 其它 */
  type: string;
  /** 应收余额（客户欠我） */
  arTotal: number;
  /** 应付余额（我欠供应商） */
  apTotal: number;
  /** 预收余额 */
  prTotal: number;
  /** 预付余额 */
  ppTotal: number;
  /** 可用预收 */
  availablePrTotal: number;
  person: string;
  tel: string;
  stoped: boolean;
}

interface RawArrears {
  btypeId: string;
  bFullName: string;
  bcategory: number;
  bcategoryName: string;
  arTotal: number;
  apTotal: number;
  prTotal: number;
  ppTotal: number;
  availablePrTotal: number;
  person: string;
  tel: string;
  memo: string;
  stoped: boolean;
}

function summarizeArrears(a: RawArrears): ArrearsItem {
  return {
    id: str(a.btypeId),
    name: str(a.bFullName),
    type: str(a.bcategoryName) || (a.bcategory === 0 ? "客户" : a.bcategory === 1 ? "供应商" : "其它"),
    arTotal: num(a.arTotal),
    apTotal: num(a.apTotal),
    prTotal: num(a.prTotal),
    ppTotal: num(a.ppTotal),
    availablePrTotal: num(a.availablePrTotal),
    person: str(a.person),
    tel: str(a.tel),
    stoped: !!a.stoped,
  };
}

export interface ListArrearsOpts {
  /** customer=应收(客户) / supplier=应付(供应商) / all=全部 */
  kind?: ArrearsKind;
  /** 名称关键字过滤 */
  keyword?: string;
  /** 包含零余额单位，默认 false */
  includeZero?: boolean;
  /** 返回条数，默认 50 */
  pageSize?: number;
}

/** 往来单位应收应付汇总 */
export async function listArrears(opts: ListArrearsOpts = {}): Promise<{ total: string; list: ArrearsItem[] }> {
  const api = new JxcClient();
  await api.init();
  const kind = opts.kind ?? "all";
  const bcategory = kind === "customer" ? 0 : kind === "supplier" ? 1 : null;

  const data = await api.call<{ total: string; list: RawArrears[] }>(
    "analysiscloud/btypeAnalyse/listBtypeAnalyse",
    {
      refresh: true,
      queryParams: {
        bigData: false,
        filter: opts.keyword ?? null,
        btypeId: null,
        bcategory,
        btypeStopType: 0,
        btypeZeroFilter: opts.includeZero ? 1 : 0,
        cooperationType: 0,
        partypeid: null,
      },
      pageSize: opts.pageSize ?? 50,
      pageIndex: 1,
      sorts: null,
      orders: null,
    },
  );

  return {
    total: str(data.total),
    list: (data.list ?? []).map(summarizeArrears),
  };
}

/** 对账明细项 */
export interface ReconciliationItem {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  /** 业务名称（销售出库/采购入库/收款/付款…） */
  businessName: string;
  billDate: string;
  /** 单据金额 */
  billTotal: number;
  /** 已核销金额（已收/已付） */
  settled: number;
  /** 未核销余额（剩余应收/应付） */
  remain: number;
  summary: string;
}

interface RawRecon {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  businessName: string;
  billDate: string;
  billTotal: number;
  billPaymentTotal: number;
  billPaymentRemainTotal: number;
  summary: string;
}

function summarizeRecon(r: RawRecon): ReconciliationItem {
  return {
    billNumber: str(r.billNumber),
    vchcode: str(r.vchcode),
    vchtype: num(r.vchtype),
    businessName: str(r.businessName),
    billDate: str(r.billDate),
    billTotal: num(r.billTotal),
    settled: num(r.billPaymentTotal),
    remain: num(r.billPaymentRemainTotal),
    summary: str(r.summary),
  };
}

export interface ListReconciliationOpts {
  /** 往来单位名（客户/供应商，必填，解析成 btypeId） */
  party: string;
  /** 起始日期 YYYY-MM-DD（默认本月1日） */
  from?: string;
  /** 结束日期 YYYY-MM-DD（默认今天） */
  to?: string;
  /** 返回条数，默认 50 */
  pageSize?: number;
}

/** 日期 → 该日本地 23:59:59 的 ISO（对账接口需 UTC ISO 串） */
function endOfDayIso(dateStr: string): string {
  return `${dateStr}T23:59:59.000Z`;
}
function startOfDayIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

/** 某往来单位的对账明细（单据级：金额/已核销/未核销余额） */
export async function listReconciliation(
  opts: ListReconciliationOpts,
): Promise<{ total: string; list: ReconciliationItem[] }> {
  if (!opts.party) throw new ApiError("对账明细需指定往来单位 --party", "VALIDATION");
  const api = new JxcClient();
  await api.init();

  const now = new Date();
  const from = opts.from ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = opts.to ?? todayStr(now);
  const { id: btypeId } = await api.resolveBtype(opts.party);

  // 对账明细覆盖采购/销售/财务收付款等单据类型
  const vchTypes = [1000, 1100, 1200, 2000, 2100, 2200, 4000, 4001, 4002, 4005, 4006, 4008, 4009, 4014, 4017, 1, 2];

  const data = await api.call<{ total: string; list: RawRecon[] }>(
    "analysiscloud/accountReconciliation/listNewAccountReconciliation",
    {
      refresh: true,
      queryParams: {
        bigData: false,
        filter: null,
        filterKey: "quick",
        filterValue: "",
        btypeId,
        vchTypes,
        reconciliationStartDate: startOfDayIso(from),
        reconciliationEndDate: endOfDayIso(to),
        type: 1,
        detail: null,
        groupFilter: -1,
        reconciliationFilter: -1,
        redbillState: -1,
        orderGroupNo: 0,
      },
      pageSize: opts.pageSize ?? 50,
      pageIndex: 1,
      sorts: null,
      orders: null,
    },
  );

  return {
    total: str(data.total),
    list: (data.list ?? []).map(summarizeRecon),
  };
}

// ===== 付款单 / 收款单 =====

export type FinanceBillDirection = "payment" | "receipt";

interface FinanceBillConfig {
  direction: FinanceBillDirection;
  vchtype: string;
  intVchtype: number;
  /** funcName 文案，仅埋点用 */
  funcName: string;
}

const PAYMENT_CONFIG: FinanceBillConfig = {
  direction: "payment",
  vchtype: "Payment",
  intVchtype: 4002,
  funcName: "主页面->财务->付款单->保存过账",
};
const RECEIPT_CONFIG: FinanceBillConfig = {
  direction: "receipt",
  vchtype: "Receiving",
  intVchtype: 4001,
  funcName: "主页面->财务->收款单->保存过账",
};

export interface CreateFinanceBillInput {
  /** 对方单位名：付款=供应商，收款=客户 */
  party: string;
  /** 金额（必填） */
  amount: number;
  /** 资金账户名（现金/银行存款…），默认"现金" */
  account?: string;
  /** 摘要（写入明细行 memo + 单据 summary） */
  memo?: string;
  /** 单据日期 YYYY-MM-DD，默认今天 */
  date?: string;
}

export interface CreateFinanceBillResult {
  success: boolean;
  billNumber?: string;
  vchcode?: string;
  amount: number;
  /** 对方单位 */
  party: string;
  /** 资金账户 */
  account: string;
  direction: FinanceBillDirection;
  raw?: unknown;
}

/** 构造 accountDetail 行（资金账户 + 金额） */
function buildAccountLine(opts: {
  atypeId: string;
  atypeFullName: string;
  atypeUserCode: string;
  total: number;
  memo?: string;
  rowIndex: number;
}): Record<string, unknown> {
  return {
    pic: "shell/skins/images/default.png",
    icon: "插入一行=aicon-zengjia",
    __rowIndex: opts.rowIndex,
    atypeUserCode: opts.atypeUserCode,
    atypeFullName: opts.atypeFullName,
    atypeId: opts.atypeId,
    taxRate: 0,
    iconColum: "添加=aicon-zengjia,删除=aicon-jian",
    total: opts.total,
    ...(opts.memo ? { memo: opts.memo } : {}),
  };
}

/** 取当前员工姓名（etype/getform）作为单据业务员/制单人 */
async function resolveEmployeeName(api: JxcClient): Promise<string> {
  const data = await api.call<{ fullname?: string }>("baseinfo/etype/getform", api.employeeId);
  return data?.fullname ?? "";
}

/** 付款单 / 收款单 共用创建逻辑 */
async function createFinanceBill(
  cfg: FinanceBillConfig,
  input: CreateFinanceBillInput,
): Promise<CreateFinanceBillResult> {
  if (!input.party) throw new ApiError(`${cfg.direction === "payment" ? "付款" : "收款"}单需指定对方单位 --party`, "VALIDATION");
  if (!input.amount || input.amount <= 0) throw new ApiError("金额必须 > 0（--amount）", "VALIDATION");

  const api = new JxcClient();
  await api.init();

  // 1. 解析对方单位（付款=供应商，收款=客户）+ 资金账户 + 业务员
  const party = cfg.direction === "payment"
    ? await api.resolveSupplier(input.party)
    : await api.resolveCustomer(input.party);
  const account = await api.resolveAccount(input.account ?? "现金");
  const efullname = await resolveEmployeeName(api);

  // 2. 取单据模板（finance/getBill 返回含 vchcode + number）
  const template = await api.call<Record<string, unknown>>(
    "recordsheet/finance/getBill",
    { vchtype: cfg.vchtype, businessType: "PaymentNormal", customType: 0 },
  );

  // 3. 填充模板
  const accountDetail = [buildAccountLine({
    atypeId: account.id,
    atypeFullName: account.fullname,
    atypeUserCode: account.usercode,
    total: input.amount,
    memo: input.memo,
    rowIndex: 0,
  })];
  const billDateIso = input.date ? `${input.date}T00:00:00.000Z` : (template.date as string) ?? todayIsoNow();

  const bill = {
    ...template,
    // 业务关键字段
    vchtype: cfg.vchtype,
    intVchtype: cfg.intVchtype,
    businessType: "PaymentNormal",
    billType: "finance",
    btypeId: party.id,
    bfullname: party.name,
    // 业务员 / 制单人
    etypeId: api.employeeId,
    efullname,
    eshortname: efullname,
    createEtypeId: api.employeeId,
    createEfullname: efullname,
    // 金额 + 资金账户明细
    currencyBillTotal: input.amount,
    accountDetail,
    balanceBillDetail: [],
    // 摘要/备注
    summary: input.memo ?? "",
    memo: input.memo ?? "",
    source: "手工新增",
    // 日期
    date: billDateIso,
    // 过账 + 保存控制
    postState: "PROCESS_COMPLETED",
    oldPostState: 0,
    saveModel: "SAVE_NEW",
    needValidation: true,
    // 付款单冲销方向标记（HAR：付款 true / 收款 false）
    balanceReverse: cfg.direction === "payment",
    startObjSave: {
      startTime: Date.now(),
      funcName: cfg.funcName,
    },
  };

  // 4. 提交
  const { json } = await api.callRaw("recordsheet/finance/submitBill/", bill);
  const data = json?.data ?? {};

  return {
    success: json.code === "200" && data.vchcode != null,
    billNumber: data.billNumber ?? (template.number as string),
    vchcode: data.vchcode ?? (template.vchcode as string),
    amount: input.amount,
    party: party.name,
    account: account.fullname,
    direction: cfg.direction,
    raw: data,
  };
}

/** 创建付款单（付钱给供应商，FK- 前缀） */
export function createPayment(input: CreateFinanceBillInput): Promise<CreateFinanceBillResult> {
  return createFinanceBill(PAYMENT_CONFIG, input);
}

/** 创建收款单（收客户钱，SK- 前缀） */
export function createReceipt(input: CreateFinanceBillInput): Promise<CreateFinanceBillResult> {
  return createFinanceBill(RECEIPT_CONFIG, input);
}

// ===== 日期辅助 =====

function todayStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 当前时刻 ISO（getBill 模板若无 date 时的兜底；正常情况模板自带） */
function todayIsoNow(): string {
  return new Date().toISOString();
}
