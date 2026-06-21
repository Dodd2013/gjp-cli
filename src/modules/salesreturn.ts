/**
 * 销售退货模块：创建销售退货单（销售出库单的逆向流程）。
 *
 * 与销售出库单（sales.ts）同构，差异：
 *   - vchtype/businessType = "SaleBack"/"SaleNormal"（intVchtype 2100，出库是 "Sale"/2000）
 *   - 单据号前缀 PXT-（出库是 PXX-）
 *   - 明细用 inDetail（退货=货退回入库），不是 outDetail
 *   - btype 仍是客户（resolveCustomer）
 *   - CONFIRM 异常机制同销售（needValidation:false + failedSaveUnconfirmed + allowZeroQty）
 *
 * 流程：
 *   1. 解析 仓库/客户/商品 → ID
 *   2. getBillByVchcode(DEFAULT, SaleBack) 取新单据模板（含 vchcode + number）
 *   3. 填充 warehouse/customer/inDetail → submitBill
 *   4. 处理 CONFIRM 异常（--force）
 */
import { JxcClient } from "../api/client.ts";

// HAR 真实生效的销售退货明细行模板（196 字段，inDetail），仅覆盖动态字段
import inDetailTemplateRaw from "./templates/salesreturn-indetail-line.json";
const inDetailTemplate = inDetailTemplateRaw as Record<string, unknown>;

export interface SaleReturnItemInput {
  /** 商品全名 */
  name: string;
  /** 退货数量 */
  qty: number;
  /** 退货单价（不含税） */
  price: number;
}

export interface CreateSaleReturnInput {
  /** 仓库名（默认取第一个） */
  warehouse?: string;
  /** 客户名 */
  customer: string;
  /** 明细 */
  items: SaleReturnItemInput[];
  /** 备注 */
  memo?: string;
  /** 摘要 */
  summary?: string;
  /** 单据日期 YYYY-MM-DD，默认今天 */
  date?: string;
}

export interface CreateSaleReturnResult {
  success: boolean;
  /** 单据号 */
  billNumber?: string;
  /** 单据唯一 ID */
  vchcode?: string;
  /** 总金额 */
  total?: number;
  /** 是否存在需确认的异常 */
  needsConfirm: boolean;
  /** 异常详情 */
  exceptions: { code: string; message: string }[];
  /** 原始响应 */
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
  // differenceQty 在 inDetail 模板里为 null（出库概念，入库不设）
  // 金额（退货单价）
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

export async function createSaleReturn(
  input: CreateSaleReturnInput,
  opts: { force?: boolean } = {},
): Promise<CreateSaleReturnResult> {
  const api = new JxcClient();
  await api.init();

  // 1. 解析
  const warehouse = await api.resolveWarehouse(input.warehouse ?? "");
  const customer = await api.resolveCustomer(input.customer);

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

  // 2. 取新单据模板（含 vchcode + number，SaleBack 退货单）
  const template = await api.call<Record<string, unknown>>(
    "recordsheet/goodsBill/getBillByVchcode",
    {
      vchtype: "SaleBack",
      businessType: "SaleNormal",
      copyTypeEnum: "DEFAULT",
      sourceVchtype: "SaleBack",
      targetVchtype: "SaleBack",
    },
  );

  // 3. 填充模板
  const bill = {
    ...template,
    ktypeId: warehouse.id,
    kfullname: warehouse.name,
    btypeId: customer.id,
    bfullname: customer.name,
    businessType: "SaleNormal",
    inDetail: lines,
    outDetail: [],
    currencyBillTotal: total,
    source: "手工新增",
    memo: input.memo ?? template.memo ?? "",
    summary: input.summary ?? template.summary ?? "",
    ...(input.date ? { date: `${input.date}T00:00:00.000Z`, numberDate: `${input.date}T00:00:00.000Z` } : {}),
    // 销售退货 CONFIRM 同销售：needValidation:false + failedSaveUnconfirmed + allowZeroQty
    needValidation: opts.force ? false : true,
    failedSaveUnconfirmed: !!opts.force,
    allowZeroQty: !!opts.force,
    activeControl: "save",
    validaterOrder: 0,
    createStartTime: true,
    startObjSave: {
      startTime: Date.now(),
      funcName: "单据->销售-销售退货单->保存单据(PROCESS_COMPLETED)",
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
