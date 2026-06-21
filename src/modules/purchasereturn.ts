/**
 * 采购退货模块：创建采购退货单（采购入库单的逆向流程）。
 *
 * 与采购入库单（purchase.ts）同构，差异：
 *   - vchtype/businessType = "BuyBack"/"Buy"（intVchtype 1100，入库是 "Buy"/1000）
 *   - 单据号前缀 CT-（入库是 CR-）
 *   - 明细用 outDetail（退货=货出库），不是 inDetail
 *   - btype 仍是供应商（resolveSupplier）
 *   - CONFIRM 异常同样靠 body 里 `confirm:true` 解除（与入库一致）
 *
 * 流程：
 *   1. 解析 仓库/供应商/商品 → ID
 *   2. getBillByVchcode(DEFAULT, BuyBack) 取新单据模板（含 vchcode + number）
 *   3. 填充 warehouse/supplier/outDetail → submitBill
 *   4. 处理 CONFIRM 异常（--force 置 confirm:true）
 */
import { JxcClient } from "../api/client.ts";

// HAR 真实生效的采购退货明细行模板（196 字段，outDetail），仅覆盖动态字段
import outDetailTemplateRaw from "./templates/purchasereturn-outdetail-line.json";
const outDetailTemplate = outDetailTemplateRaw as Record<string, unknown>;

export interface PurchaseReturnItemInput {
  /** 商品全名 */
  name: string;
  /** 退货数量 */
  qty: number;
  /** 退货单价（不含税）。为 0 会触发 COST_BATCH_ERROR，需 --force */
  price: number;
}

export interface CreatePurchaseReturnInput {
  /** 仓库名（默认取第一个） */
  warehouse?: string;
  /** 供应商名 */
  supplier: string;
  /** 明细 */
  items: PurchaseReturnItemInput[];
  /** 备注 */
  memo?: string;
  /** 摘要 */
  summary?: string;
  /** 单据日期 YYYY-MM-DD，默认今天 */
  date?: string;
}

export interface CreatePurchaseReturnResult {
  success: boolean;
  billNumber?: string;
  vchcode?: string;
  total?: number;
  needsConfirm: boolean;
  exceptions: { code: string; message: string }[];
  raw?: unknown;
}

/** 构造一条 outDetail 明细行：克隆 HAR 真实模板，仅覆盖动态字段 */
function buildOutDetailLine(opts: {
  ptypeId: string; skuId: string; unitId: string;
  fullname: string; usercode: string; shortname: string;
  qty: number; price: number;
  ktypeId: string; kfullname: string;
  rowIndex: number;
}): Record<string, unknown> {
  const { qty, price, ptypeId, skuId, unitId, ktypeId, kfullname, fullname, usercode, shortname, rowIndex } = opts;
  const lineTotal = +(price * qty).toFixed(10);
  const qtyStr = String(qty);
  const line = JSON.parse(JSON.stringify(outDetailTemplate)) as Record<string, unknown>;
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
  // 金额（退货单价；成本由服务端按库存现值回填，estimateProfit 同入库处理留 total 让服务端订正）
  line.currencyPrice = price;
  line.currencyTotal = lineTotal;
  line.currencyDisedPrice = price;
  line.currencyDisedTotal = lineTotal;
  line.currencyDisedTaxedPrice = price;
  line.currencyDisedTaxedTotal = lineTotal;
  line.estimateProfit = lineTotal;
  line.currencyOrderFeeAllotPrice = price;
  return line;
}

export async function createPurchaseReturn(
  input: CreatePurchaseReturnInput,
  opts: { force?: boolean } = {},
): Promise<CreatePurchaseReturnResult> {
  const api = new JxcClient();
  await api.init();

  // 1. 解析
  const warehouse = await api.resolveWarehouse(input.warehouse ?? "");
  const supplier = await api.resolveSupplier(input.supplier);

  const lines = await Promise.all(
    input.items.map(async (item, i) => {
      const product = await api.resolveProduct(item.name, warehouse.id);
      const { skuId, unitId } = await api.resolveSku(product.id);
      return buildOutDetailLine({
        ptypeId: product.id, skuId, unitId,
        fullname: product.fullname, usercode: product.usercode, shortname: product.shortname ?? product.fullname,
        qty: item.qty, price: item.price,
        ktypeId: warehouse.id, kfullname: warehouse.name,
        rowIndex: i,
      });
    }),
  );

  const total = +input.items.reduce((s, it) => s + it.qty * it.price, 0).toFixed(10);

  // 2. 取新单据模板（含 vchcode + number，BuyBack 退货单）
  const template = await api.call<Record<string, unknown>>(
    "recordsheet/goodsBill/getBillByVchcode",
    {
      vchtype: "BuyBack",
      businessType: "Buy",
      copyTypeEnum: "DEFAULT",
      sourceVchtype: "BuyBack",
      targetVchtype: "BuyBack",
    },
  );

  // 3. 填充模板
  const bill = {
    ...template,
    ktypeId: warehouse.id,
    kfullname: warehouse.name,
    btypeId: supplier.id,
    bfullname: supplier.name,
    businessType: "Buy",
    inDetail: [],
    outDetail: lines,
    currencyBillTotal: total,
    source: "手工新增",
    memo: input.memo ?? template.memo ?? "",
    summary: input.summary ?? template.summary ?? "",
    ...(input.date ? { date: `${input.date}T00:00:00.000Z`, numberDate: `${input.date}T00:00:00.000Z` } : {}),
    // 采购退货 CONFIRM（如 COST_BATCH_ERROR 价格为0）靠 confirm:true 解除（同入库）
    needValidation: true,
    confirm: !!opts.force,
    activeControl: "save",
    validaterOrder: 0,
    createStartTime: true,
    startObjSave: {
      startTime: Date.now(),
      funcName: "单据->采购-采购退货单->保存单据(PROCESS_COMPLETED)",
      batchCount: lines.length,
    },
    saveModel: "SAVE_NEW",
  };

  // 4. 提交
  const { json } = await api.callRaw("recordsheet/goodsBill/submitBill", bill);
  const data = json?.data ?? {};
  const exceptions: { code: string; message: string }[] = (data.exceptionInfo ?? []).map(
    (e: { bizErrorCode: string; message: string }) => ({ code: e.bizErrorCode, message: e.message }),
  );
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
