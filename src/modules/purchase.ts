/**
 * 采购模块：创建采购入库单。
 *
 * 与销售高度同构，差异：
 *   - vchtype/businessType = "Buy"（intVchtype 1000），单据号前缀 CR-
 *   - 明细用 inDetail（入库），不是 outDetail
 *   - btype = 供应商（resolveSupplier）
 *   - CONFIRM 异常（如 COST_BATCH_ERROR「价格为0」）靠 body 里 `confirm:true` 解除（不是 needValidation:false）
 *
 * 流程：
 *   1. 解析 仓库/供应商/商品 → ID
 *   2. getBillByVchcode(DEFAULT, Buy) 取新单据模板（含 vchcode + number + payment）
 *   3. 填充 warehouse/supplier/inDetail → submitBill
 *   4. 处理 CONFIRM 异常（--force 置 confirm:true）
 */
import { JxcClient, ApiError } from "../api/client.ts";

// HAR 真实生效的采购入库明细行模板（196 字段），仅覆盖动态字段
import inDetailTemplateRaw from "./templates/purchase-indetail-line.json";
const inDetailTemplate = inDetailTemplateRaw as Record<string, unknown>;

export interface PurchaseItemInput {
  /** 商品全名 */
  name: string;
  /** 数量 */
  qty: number;
  /** 采购单价（不含税）。为 0 会触发 COST_BATCH_ERROR，需 --force */
  price: number;
}

export interface CreatePurchaseInput {
  /** 仓库名（默认取第一个） */
  warehouse?: string;
  /** 供应商名 */
  supplier: string;
  /** 明细 */
  items: PurchaseItemInput[];
  /** 备注 */
  memo?: string;
  /** 摘要 */
  summary?: string;
  /** 单据日期 YYYY-MM-DD，默认今天 */
  date?: string;
}

export interface CreatePurchaseResult {
  success: boolean;
  billNumber?: string;
  vchcode?: string;
  total?: number;
  needsConfirm: boolean;
  exceptions: { code: string; message: string }[];
  raw?: unknown;
}

/** 构造一条 inDetail 明细行：克隆 HAR 真实模板，仅覆盖动态字段 */
function buildInDetailLine(opts: {
  ptypeId: string; skuId: string; unitId: string;
  fullname: string; usercode: string; shortname: string;
  qty: number; price: number;
  ktypeId: string; kfullname: string;
  rowIndex: number;
}): Record<string, unknown> {
  const { qty, price, ptypeId, skuId, unitId, ktypeId, kfullname, fullname, usercode, shortname, rowIndex } = opts;
  const lineTotal = +(price * qty).toFixed(10);
  const qtyStr = String(qty);
  const line = JSON.parse(JSON.stringify(inDetailTemplate)) as Record<string, unknown>;
  // 商品/单位
  line.ptypeId = ptypeId;
  line.skuId = skuId;
  line.unitId = unitId;
  line.pFullName = fullname;
  line.pUserCode = usercode;
  line.shortname = shortname;
  line.ktypeId = ktypeId;
  line.kfullname = kfullname;
  line.stockDefaultUnit = unitId;
  line.buyDefaultUnit = unitId;
  line.saleDefaultUnit = unitId;
  line.retailDefaultUnit = unitId;
  if (line.sku && typeof line.sku === "object") {
    (line.sku as Record<string, unknown>).id = skuId;
  }
  // 数量
  line.unitQty = qty;
  line.qty = qty;
  line.uRateQty0 = qty;
  line.uRateQty = qtyStr;
  line.sumAssistBaseQty = qty;
  line.assistQty0 = qtyStr;
  line.assistQty0Number = qty;
  line.comboRowId = rowIndex + 3;
  line.rowIndex = rowIndex;
  line.__rowIndex = rowIndex;
  line.differenceQty = qty;
  // 金额（采购价即成本）
  line.currencyPrice = price;
  line.currencyCost = price;
  line.currencyTotal = lineTotal;
  line.currencyDisedPrice = price;
  line.currencyDisedTotal = lineTotal;
  line.currencyDisedTaxedPrice = price;
  line.currencyDisedTaxedTotal = lineTotal;
  line.estimateProfit = lineTotal;
  line.currencyOrderFeeAllotPrice = price;
  return line;
}

export async function createPurchase(input: CreatePurchaseInput, opts: { force?: boolean } = {}): Promise<CreatePurchaseResult> {
  const api = new JxcClient();
  await api.init();

  // 1. 解析
  const warehouse = await api.resolveWarehouse(input.warehouse ?? "");
  const supplier = await api.resolveSupplier(input.supplier);

  const lines = await Promise.all(
    input.items.map(async (item, i) => {
      const product = await api.resolveProduct(item.name, warehouse.id);
      const { skuId, unitId } = await api.resolveSku(product.id);
      return buildInDetailLine({
        ptypeId: product.id, skuId, unitId,
        fullname: product.fullname, usercode: product.usercode, shortname: product.shortname ?? product.fullname,
        qty: item.qty, price: item.price,
        ktypeId: warehouse.id, kfullname: warehouse.name,
        rowIndex: i,
      });
    }),
  );

  const total = +input.items.reduce((s, it) => s + it.qty * it.price, 0).toFixed(10);

  // 2. 取新单据模板（含 vchcode + number + payment）
  const template = await api.call<Record<string, unknown>>(
    "recordsheet/goodsBill/getBillByVchcode",
    { vchtype: "Buy", businessType: "Buy", copyTypeEnum: "DEFAULT", sourceVchtype: "Buy", targetVchtype: "Buy" },
  );

  // 3. 填充模板
  const bill = {
    ...template,
    ktypeId: warehouse.id,
    kfullname: warehouse.name,
    btypeId: supplier.id,
    bfullname: supplier.name,
    businessType: "Buy",
    inDetail: lines,
    outDetail: [],
    currencyBillTotal: total,
    source: "手工新增",
    memo: input.memo ?? template.memo ?? "",
    summary: input.summary ?? template.summary ?? "",
    ...(input.date ? { date: `${input.date}T00:00:00.000Z`, numberDate: `${input.date}T00:00:00.000Z` } : {}),
    // 采购 CONFIRM（如 COST_BATCH_ERROR 价格为0）靠 confirm:true 解除
    needValidation: true,
    confirm: !!opts.force,
    activeControl: "save",
    validaterOrder: 0,
    createStartTime: true,
    startObjSave: {
      startTime: Date.now(),
      funcName: "单据->采购-采购入库单->保存单据(PROCESS_COMPLETED)",
      batchCount: lines.length,
    },
    saveModel: "SAVE_NEW",
  };

  // 4. 提交
  const { json } = await api.callRaw("recordsheet/goodsBill/submitBill", bill);
  const data = json?.data ?? {};
  const exceptions: { code: string; message: string }[] = (data.exceptionInfo ?? []).map((e: { bizErrorCode: string; message: string }) => ({
    code: e.bizErrorCode,
    message: e.message,
  }));
  const needsConfirm = data.resultType === "CONFIRM" || exceptions.length > 0;

  return {
    success: json.code === "200" && data.vchcode != null,
    billNumber: data.billNumber,
    vchcode: data.vchcode,
    total,
    needsConfirm,
    exceptions,
    raw: data,
  };
}

// ===== 采购单删除 =====
// 接口 recordsheet/billCore/deleteBill，body {vchcode, vchtype:"Buy", businessType:"Buy", billDate, billPostState, confirm?}
// 正常 → data.success:true。删后会导致负库存 → data.success:false, result:"ALLOW", errorDetail:[NEG_STOCK_ERROR, resultType:CONFIRM]
// → 带 confirm:true 重提即落库（同 create 的 --force 机制）。

export interface PurchaseBillRef {
  vchcode: string;
  billNumber: string;
  billDate: string;
  billPostState: number;
  bfullname: string;
  currencyBillTotal: number;
}

/** 按单号(CR-...)或 vchcode 查找已过账(postState=800)采购单，取 billDate/postState 供删除用 */
export async function findPurchaseBill(bill: string): Promise<PurchaseBillRef> {
  const api = new JxcClient();
  await api.init();
  const now = Date.now();
  const data = await api.call<{ list: Record<string, unknown>[] }>("recordsheet/billCore/list", {
    queryParams: {
      postStateList: [800],
      startTime: new Date(now - 3 * 365 * 86400000).toISOString(),
      endTime: new Date(now + 365 * 86400000).toISOString(),
      conformType: 0, postState: "", saleOrbuy: 1, invoiceType: 0, paymentType: 0,
      redbillState: -1, sourceNumber: "", settleAccountVisible: false,
      execQueryPage: "BuyBillQuery", vchtypes: [1000, 1100, 1200],
    },
    pageSize: 200, pageIndex: 1, sorts: null,
  });
  const list = data.list ?? [];
  const hit = list.find((b) => b.vchcode === bill || b.billNumber === bill);
  if (!hit) {
    throw new ApiError(`未找到已过账(postState=800)的采购单"${bill}"`, "NOT_FOUND");
  }
  return {
    vchcode: String(hit.vchcode),
    billNumber: String(hit.billNumber ?? ""),
    billDate: String(hit.billDate ?? ""),
    billPostState: Number(hit.postState ?? 800),
    bfullname: String(hit.bfullname ?? ""),
    currencyBillTotal: Number(hit.currencyBillTotal ?? 0),
  };
}

export interface DeletePurchaseResult {
  success: boolean;
  deleted: boolean;
  /** 删除会导致负库存，需 --force(confirm:true) 重提 */
  needsForce: boolean;
  exceptions: { code: string; message: string; detail?: unknown[] }[];
  raw?: unknown;
}

function parseErrs(errorDetail: unknown[]): { code: string; message: string; detail?: unknown[] }[] {
  return (errorDetail ?? []).map((e) => {
    const o = e as Record<string, unknown>;
    return { code: String(o.bizErrorCode ?? ""), message: String(o.message ?? ""), detail: o.detailList as unknown[] };
  });
}

/** 删除采购单（第1阶段，不带 confirm）。若返回 needsForce=true 表示会导致负库存，需再调 forceDeletePurchaseBill。 */
export async function deletePurchaseBill(ref: PurchaseBillRef): Promise<DeletePurchaseResult> {
  const api = new JxcClient();
  await api.init();
  const { json } = await api.callRaw("recordsheet/billCore/deleteBill", {
    vchcode: ref.vchcode,
    vchtype: "Buy",
    businessType: "Buy",
    billDate: ref.billDate,
    billPostState: ref.billPostState,
  });
  const data = json?.data ?? {};
  if (data.success === true) {
    return { success: true, deleted: true, needsForce: false, exceptions: [], raw: data };
  }
  const errs = parseErrs(data.errorDetail);
  const needsForce = errs.some((e) => e.code === "NEG_STOCK_ERROR");
  return {
    success: false,
    deleted: false,
    needsForce,
    exceptions: errs.length ? errs : [{ code: "ERROR", message: String(json?.message ?? "删除失败") }],
    raw: data,
  };
}

/** 强制删除（confirm:true，允许负库存）。仅在用户明确确认负库存影响后调用。 */
export async function forceDeletePurchaseBill(ref: PurchaseBillRef): Promise<DeletePurchaseResult> {
  const api = new JxcClient();
  await api.init();
  const { json } = await api.callRaw("recordsheet/billCore/deleteBill", {
    vchcode: ref.vchcode,
    vchtype: "Buy",
    businessType: "Buy",
    billDate: ref.billDate,
    billPostState: ref.billPostState,
    confirm: true,
  });
  const data = json?.data ?? {};
  const errs = parseErrs(data.errorDetail);
  return {
    success: data.success === true,
    deleted: data.success === true,
    needsForce: false,
    exceptions: errs,
    raw: data,
  };
}
