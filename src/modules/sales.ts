/**
 * 销售模块：创建销售出库单。
 *
 * 流程（见 docs/API.md 第 5 节）：
 *   1. 解析 仓库/客户/商品 → ID
 *   2. getBillByVchcode(DEFAULT) 取新单据模板（含 vchcode + number）
 *   3. 填充 warehouse/customer/outDetail → submitBill
 *   4. 处理 CONFIRM 异常（库存不足等）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JxcClient } from "../api/client.ts";

// HAR 真实生效的销售明细行模板（199 字段），仅覆盖动态字段，保证服务端字段对齐
const __dirname = dirname(fileURLToPath(import.meta.url));
const saleOutdetailTemplate = JSON.parse(
  readFileSync(join(__dirname, "templates", "sale-outdetail-line.json"), "utf-8"),
) as Record<string, unknown>;

export interface SaleItemInput {
  /** 商品全名 */
  name: string;
  /** 数量 */
  qty: number;
  /** 单价（不含税） */
  price: number;
}

export interface CreateSaleInput {
  /** 仓库名（默认取第一个） */
  warehouse?: string;
  /** 客户名 */
  customer: string;
  /** 明细 */
  items: SaleItemInput[];
  /** 备注 */
  memo?: string;
  /** 摘要 */
  summary?: string;
  /** 业务类型，默认普通销售 */
  businessType?: string;
  /** 单据日期 YYYY-MM-DD，默认今天 */
  date?: string;
}

export interface CreateSaleResult {
  success: boolean;
  /** 单据号 */
  billNumber?: string;
  /** 单据唯一 ID */
  vchcode?: string;
  /** 总金额 */
  total?: number;
  /** 是否存在需确认的异常（如库存不足） */
  needsConfirm: boolean;
  /** 异常详情 */
  exceptions: { code: string; message: string }[];
  /** 原始响应 */
  raw?: unknown;
}

/** 构造一条 outDetail 明细行：克隆 HAR 真实模板，仅覆盖动态字段。保证服务端字段对齐。 */
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
  // 深拷贝模板（结构化克隆语义）
  const line = JSON.parse(JSON.stringify(saleOutdetailTemplate)) as Record<string, unknown>;
  // 覆盖商品/单位
  line.ptypeId = ptypeId;
  line.skuId = skuId;
  line.unitId = unitId;
  line.pFullName = fullname;
  line.pUserCode = usercode;
  line.shortname = shortname;
  line.ktypeId = ktypeId;
  line.kfullname = kfullname;
  // 默认单位字段对齐到当前 unitId
  line.stockDefaultUnit = unitId;
  line.buyDefaultUnit = unitId;
  line.saleDefaultUnit = unitId;
  line.retailDefaultUnit = unitId;
  // sku 嵌套对象的 id 对齐
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
  // 金额
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

export async function createSale(input: CreateSaleInput, opts: { force?: boolean } = {}): Promise<CreateSaleResult> {
  const api = new JxcClient();
  await api.init();

  // 1. 解析
  const warehouse = await api.resolveWarehouse(input.warehouse ?? "");
  const customer = await api.resolveCustomer(input.customer);

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
  const businessType = input.businessType ?? "SaleNormal";

  // 2. 取新单据模板（含 vchcode + number）
  const template = await api.call<Record<string, unknown>>(
    "recordsheet/goodsBill/getBillByVchcode",
    { vchtype: "Sale", businessType, copyTypeEnum: "DEFAULT", sourceVchtype: "Sale", targetVchtype: "Sale" },
  );

  // 3. 填充模板
  const bill = {
    ...template,
    // 业务关键字段
    ktypeId: warehouse.id,
    kfullname: warehouse.name,
    btypeId: customer.id,
    bfullname: customer.name,
    businessType,
    outDetail: lines,
    currencyBillTotal: total,
    source: "手工新增",
    memo: input.memo ?? template.memo ?? "",
    summary: input.summary ?? template.summary ?? "",
    // 日期覆盖
    ...(input.date ? { date: `${input.date}T00:00:00.000Z`, numberDate: `${input.date}T00:00:00.000Z` } : {}),
    // 确认/校验控制
    needValidation: opts.force ? false : true,
    failedSaveUnconfirmed: !!opts.force,
    allowZeroQty: !!opts.force,
    // 保存控制字段（模板不含，必须补 —— 否则服务端不处理明细）
    activeControl: "save",
    validaterOrder: 0,
    createStartTime: true,
    startObjSave: {
      startTime: Date.now(),
      funcName: "单据->销售-销售出库单->保存单据(PROCESS_COMPLETED)",
      batchCount: 1,
    },
    // 保留模板分配的标识
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
