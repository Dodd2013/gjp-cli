/**
 * 库存模块命令：status（库存状况）/ position（明细分布）/ warehouses（仓库列表）。
 */
import { defineCommand } from "citty";
import { listStockStatus, listStockPosition, listWarehouses } from "../modules/stock.ts";
import { output } from "./shared.ts";

const stockStatus = defineCommand({
  meta: { name: "status", description: "库存状况查询（按商品汇总：现存量/可销量/可发量/成本/售价总额）" },
  args: {
    keyword: { type: "string", description: "商品关键字（名称/编号/条码）", alias: "k" },
    warehouse: { type: "string", description: "仓库名（不传=全部仓库）", alias: "w" },
    "include-zero": { type: "boolean", description: "包含零库存商品" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const result = await listStockStatus({
      keyword: args.keyword as string | undefined,
      warehouse: args.warehouse as string | undefined,
      includeZero: !!args["include-zero"],
      pageSize: Number(args.size ?? 50),
    });
    output(result);
  },
});

const stockPosition = defineCommand({
  meta: { name: "position", description: "明细库存分布（按商品 + 库位拆分）" },
  args: {
    keyword: { type: "string", description: "商品关键字", alias: "k" },
    warehouse: { type: "string", description: "仓库名（不传=全部仓库）", alias: "w" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const result = await listStockPosition({
      keyword: args.keyword as string | undefined,
      warehouse: args.warehouse as string | undefined,
      pageSize: Number(args.size ?? 50),
    });
    output(result);
  },
});

const stockWarehouses = defineCommand({
  meta: { name: "warehouses", description: "仓库列表（库存查询前选仓库用）" },
  async run() {
    output(await listWarehouses());
  },
});

export const stockGroup = defineCommand({
  meta: { name: "stock", description: "库存模块（库存状况 / 明细分布 / 仓库列表）" },
  subCommands: { status: stockStatus, position: stockPosition, warehouses: stockWarehouses },
});
