/**
 * 单据中心模块：跨单据类型查询 + 业务类型枚举。
 *
 * - listBills: `recordsheet/postBill/listPostBill`（单据中心查询，按日期/类型/对方/单号过滤）
 * - listBusinessTypes: `recordsheet/accBusinessType/list {vchtypeEnum:null, query:true}`
 *   （全量业务类型枚举：businessType↔名称↔vchtype，即 vchtype 枚举接口）
 */
import { JxcClient } from "../api/client.ts";

/** 单据类型分组（按 vchtype 千位归类，来自 listPostBill 的 vchtypes 数组） */
export type BillTypeGroup = "all" | "purchase" | "sale" | "stock" | "finance";

const VCHTYPE_GROUPS: Record<BillTypeGroup, number[]> = {
  purchase: [1000, 1100, 1200],
  sale: [2000, 2100, 2200],
  stock: [3000, 3100, 3200, 3300, 3301, 3302, 3303],
  finance: [4000, 4001, 4002, 4005, 4006, 4007, 4008, 4009, 4010, 4014, 4017],
  all: [
    1000, 1100, 1200, 2000, 2100, 2200, 3000, 3100, 3200, 3300, 3301, 3302, 3303,
    4000, 4001, 4002, 4005, 4006, 4007, 4008, 4009, 4010, 4014, 4017, 9802,
  ],
};

export interface ListBillsOpts {
  /** 起始日期 YYYY-MM-DD（默认今天-7） */
  from?: string;
  /** 结束日期 YYYY-MM-DD（默认今天） */
  to?: string;
  /** 单据类型分组，默认 all */
  type?: BillTypeGroup;
  /** 对方单位名（客户/供应商，解析成 btypeId） */
  party?: string;
  /** 精确单据号，如 CR-20260620-00001 */
  billNumber?: string;
  /** 返回条数，默认 20 */
  pageSize?: number;
}

export interface BillSummary {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  businessType: number;
  businessTypeName: string;
  billType: number;
  bfullname: string;
  currencyBillTotal: number;
  billDate: string;
  postTime: string;
  memo: string;
  summary: string;
}

interface RawBill {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  businessType: number;
  businessTypeName: string;
  billType: number;
  bfullname: string;
  currencyBillTotal: number;
  billDate: string;
  postTime: string;
  memo: string;
  summary: string;
}

function summarizeBill(b: RawBill): BillSummary {
  return {
    billNumber: b.billNumber ?? "",
    vchcode: b.vchcode ?? "",
    vchtype: b.vchtype,
    businessType: b.businessType,
    businessTypeName: b.businessTypeName ?? "",
    billType: b.billType,
    bfullname: b.bfullname ?? "",
    currencyBillTotal: Number(b.currencyBillTotal ?? 0),
    billDate: b.billDate ?? "",
    postTime: b.postTime ?? "",
    memo: b.memo ?? "",
    summary: b.summary ?? "",
  };
}

/** 日期 → YYYY-MM-DD（本地时区） */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 单据中心查询：跨类型列出已过账单据 */
export async function listBills(opts: ListBillsOpts = {}): Promise<{ total: string; list: BillSummary[] }> {
  const api = new JxcClient();
  await api.init();

  const now = new Date();
  const from = opts.from ?? toDateStr(new Date(now.getTime() - 7 * 86400000));
  const to = opts.to ?? toDateStr(now);
  const vchtypes = VCHTYPE_GROUPS[opts.type ?? "all"];

  let btypeId = "";
  if (opts.party) {
    btypeId = (await api.resolveBtype(opts.party)).id;
  }

  const data = await api.call<{ total: string; list: RawBill[] }>("recordsheet/postBill/listPostBill", {
    pageIndex: 1,
    pageSize: opts.pageSize ?? 20,
    queryParams: {
      beginDate: `${from} 00:00:00`,
      endDate: `${to} 23:59:59`,
      vchtypes,
      saleModeList: [],
      btypeId,
      ptypeId: "",
      etypeIds: [],
      createEtypeIds: [],
      ktypeId: "",
      otypeIds: [],
      redbillState: -1,
      queryStockBillTotal: false,
      billNumbers: opts.billNumber ? [opts.billNumber] : [],
      summary: "",
      memo: "",
      sourceNumber: "",
      sorts: null,
    },
  });

  return {
    total: data.total ?? String((data.list ?? []).length),
    list: (data.list ?? []).map(summarizeBill),
  };
}

export interface BusinessType {
  vchtype: number;
  name: string;
  businessType: string;
  businessCode: number;
  businessTypeEnum: string;
  stoppedInVchtype: boolean;
}

/** 全量业务类型枚举（vchtype 枚举接口） */
export async function listBusinessTypes(includeStopped = false): Promise<BusinessType[]> {
  const api = new JxcClient();
  await api.init();
  const data = await api.call<RawBizType[]>("recordsheet/accBusinessType/list", {
    vchtypeEnum: null,
    intVchtypeList: null,
    query: true,
  });
  return (data ?? [])
    .filter((b) => includeStopped || !b.stoppedInVchtype)
    .map((b) => ({
      vchtype: b.vchtype,
      name: b.name ?? "",
      businessType: b.businessType ?? "",
      businessCode: b.businessCode,
      businessTypeEnum: b.businessTypeEnum ?? "",
      stoppedInVchtype: !!b.stoppedInVchtype,
    }));
}

interface RawBizType {
  vchtype: number;
  name: string;
  businessType: string;
  businessCode: number;
  businessTypeEnum: string;
  stoppedInVchtype: boolean;
}
