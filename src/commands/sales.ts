/**
 * 销售模块命令：create。
 */
import { defineCommand } from "citty";
import { createSale, type SaleItemInput } from "../modules/sales.ts";
import { createSaleReturn, type SaleReturnItemInput } from "../modules/salesreturn.ts";
import { output, die, parseItems } from "./shared.ts";

const salesCreate = defineCommand({
  meta: { name: "create", description: "创建销售出库单" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    customer: { type: "string", description: "客户名（必填）", alias: "c" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":1,"price":9.2}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（忽略库存不足等需确认的异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.customer) die("缺少客户名 --customer");
    const items = parseItems<SaleItemInput>(args.items as string);

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const c = await api.resolveCustomer(args.customer as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const s = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...s };
        }),
      );
      output({ warehouse: w, customer: c, items: resolved });
      return;
    }

    const result = await createSale(
      {
        warehouse: args.warehouse as string | undefined,
        customer: args.customer as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    output(result);
    if (!result.success) process.exit(1);
  },
});

const salesReturn = defineCommand({
  meta: { name: "return", description: "创建销售退货单（客户退回商品，货入库）" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    customer: { type: "string", description: "客户名（必填）", alias: "c" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":1,"price":9.2}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（忽略库存不足等需确认的异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.customer) die("缺少客户名 --customer");
    const items = parseItems<SaleReturnItemInput>(args.items as string);

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const c = await api.resolveCustomer(args.customer as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const s = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...s };
        }),
      );
      output({ warehouse: w, customer: c, items: resolved });
      return;
    }

    const result = await createSaleReturn(
      {
        warehouse: args.warehouse as string | undefined,
        customer: args.customer as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    output(result);
    if (!result.success) process.exit(1);
  },
});

export const salesGroup = defineCommand({
  meta: { name: "sales", description: "销售模块" },
  subCommands: { create: salesCreate, return: salesReturn },
});
