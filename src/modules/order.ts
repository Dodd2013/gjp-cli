/**
 * 订单模块：销售/采购/报价/询价订单查询 + 订单明细。
 *
 * - listOrders: `recordsheet/orderBillCore/list`（订单列表，独立于 postBill 的订单单据族）
 * - getOrder: `recordsheet/orderBill/getBill`（订单详情含 detail[] 商品行）
 *
 * vchtype 码与枚举见 docs/API.md §15。订单是"准备单据"（BillTypes.code=90），
 * 不在 goodsBill/postBill 体系里，单号与出库单共用 PXXD- 前缀（以 summary 区分）。
 */
import { JxcClient } from "../api/client.ts";

/** 订单类别（CLI 对外参数值） */
export type OrderCategory = "sale" | "buy" | "quotation" | "inquiry" | "transfer";

/** orderBillCore/list 的 vchtypes 数字码 */
const ORDER_VCHTYPES: Record<OrderCategory, number> = {
  buy: 9000,
  sale: 9001,
  quotation: 9003,
  inquiry: 9004,
  transfer: 9005,
};

/** orderBill/getBill 的 vchtype 字符串枚举 */
const ORDER_VCHTYPE_ENUMS: Record<OrderCategory, string> = {
  buy: "BuyOrder",
  sale: "SaleOrder",
  quotation: "Quotation",
  inquiry: "InQuiry",
  transfer: "GoodsTrans",
};

export const ORDER_CATEGORIES = Object.keys(ORDER_VCHTYPES) as OrderCategory[];

/** auditState: 1待提交 2待审核 3审核中 4已驳回 5已审核 6已完成 */
export const AUDIT_STATE_NAMES: Record<number, string> = {
  1: "待提交",
  2: "待审核",
  3: "审核中",
  4: "已驳回",
  5: "已审核",
  6: "已完成",
};

export interface ListOrdersOpts {
  from?: string;
  to?: string;
  category?: OrderCategory;
  /** 审核状态码数组，默认 [5]（已审核） */
  auditStates?: number[];
  /** 完成状态码数组，默认 [0, 3] */
  overStates?: number[];
  pageSize?: number;
}

export interface OrderSummary {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  vchtypeName: string;
  businessTypeName: string;
  party: string;
  total: number;
  auditState: number;
  auditStateName: string;
  overState: number | null;
  billDate: string;
  todate: string | null;
  summary: string;
  memo: string;
}

interface RawOrder {
  billNumber: string;
  vchcode: string;
  vchtype: number;
  vchtypeName?: string;
  billBusinessTypeName?: string;
  bfullname?: string;
  currencyBillTotal: number;
  auditState: number;
  overState?: number | null;
  billDate: string;
  todate?: string | null;
  summary?: string;
  memo?: string;
}

function summarizeOrder(b: RawOrder): OrderSummary {
  const auditState = Number(b.auditState ?? 0);
  return {
    billNumber: b.billNumber ?? "",
    vchcode: String(b.vchcode ?? ""),
    vchtype: b.vchtype,
    vchtypeName: b.vchtypeName ?? "",
    businessTypeName: b.billBusinessTypeName ?? "",
    party: b.bfullname ?? "",
    total: Number(b.currencyBillTotal ?? 0),
    auditState,
    auditStateName: AUDIT_STATE_NAMES[auditState] ?? String(auditState),
    overState: b.overState ?? null,
    billDate: b.billDate ?? "",
    todate: b.todate ?? null,
    summary: b.summary ?? "",
    memo: b.memo ?? "",
  };
}

/** 订单列表（默认近 7 天已审核销售订单） */
export async function listOrders(opts: ListOrdersOpts = {}): Promise<{ total: string; list: OrderSummary[] }> {
  const api = new JxcClient();
  await api.init();

  const now = new Date();
  const from = opts.from ?? toDateStr(new Date(now.getTime() - 7 * 86400000));
  const to = opts.to ?? toDateStr(now);
  const vt = ORDER_VCHTYPES[opts.category ?? "sale"];
  const auditStates = (opts.auditStates ?? [5]).map(Number);

  const data = await api.call<{ total: string; list: RawOrder[] }>("recordsheet/orderBillCore/list", {
    pageIndex: 1,
    pageSize: opts.pageSize ?? 20,
    queryParams: {
      vchtypes: [vt],
      auditStateList: auditStates,
      overStateList: opts.overStates ?? [0, 3],
      startTime: `${from} 00:00:00`,
      endTime: `${to} 23:59:59`,
      businessTypeList: [201],
      dateType: 0,
      queryOnlyUnFinishDetail: false,
    },
  });

  return {
    total: data.total ?? String((data.list ?? []).length),
    list: (data.list ?? []).map(summarizeOrder),
  };
}

export interface OrderLine {
  name: string;
  standard: string;
  qty: number;
  unit: string;
  price: number;
  total: number;
}

export interface OrderDetail {
  billNumber: string;
  vchcode: string;
  party: string;
  warehouse: string | null;
  total: number;
  auditState: number | null;
  auditStateName: string | null;
  billDate: string;
  todate: string | null;
  summary: string;
  memo: string;
  lines: OrderLine[];
}

interface RawLine {
  pFullName?: string;
  pfullname?: string;
  standard?: string;
  qty: number;
  unitName?: string;
  currencyPrice: number;
  currencyTotal: number;
}

/** 订单详情（含商品行） */
export async function getOrder(
  vchcode: string,
  opts: { category?: OrderCategory } = {},
): Promise<OrderDetail> {
  const api = new JxcClient();
  await api.init();

  const data = await api.call<{
    billNumber?: string;
    number?: string;
    vchcode?: string;
    bfullname?: string;
    kfullname?: string | null;
    currencyBillTotal: number;
    auditState?: number | null;
    billDate: string;
    todate?: string | null;
    summary?: string;
    memo?: string;
    detail?: RawLine[];
    outDetail?: RawLine[];
    inDetail?: RawLine[];
  }>("recordsheet/orderBill/getBill", {
    vchcode,
    vchtype: ORDER_VCHTYPE_ENUMS[opts.category ?? "sale"],
    show: true,
    queryOnlyUnFinishDetail: false,
  });

  const lines = data.detail ?? data.outDetail ?? data.inDetail ?? [];
  const auditState = data.auditState ?? null;

  return {
    billNumber: data.billNumber ?? data.number ?? "",
    vchcode: String(data.vchcode ?? vchcode),
    party: data.bfullname ?? "",
    warehouse: data.kfullname ?? null,
    total: Number(data.currencyBillTotal ?? 0),
    auditState,
    auditStateName: auditState != null ? (AUDIT_STATE_NAMES[auditState] ?? String(auditState)) : null,
    billDate: data.billDate ?? "",
    todate: data.todate ?? null,
    summary: data.summary ?? "",
    memo: data.memo ?? "",
    lines: lines.map((l) => ({
      name: l.pFullName ?? l.pfullname ?? "",
      standard: l.standard ?? "",
      qty: Number(l.qty ?? 0),
      unit: l.unitName ?? "",
      price: Number(l.currencyPrice ?? 0),
      total: Number(l.currencyTotal ?? 0),
    })),
  };
}

/** 日期 → YYYY-MM-DD（本地时区；与 bill.ts 保持一致） */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
