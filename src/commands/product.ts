/**
 * 商品模块命令：list / get / create。
 */
import { defineCommand } from "citty";
import { listProducts, getProduct, createProduct } from "../modules/product.ts";
import { output } from "./shared.ts";

const productList = defineCommand({
  meta: { name: "list", description: "查询商品列表" },
  args: {
    keyword: { type: "string", description: "搜索关键字（商品名/编码）", alias: "k" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const list = await listProducts((args.keyword as string) ?? "", Number(args.size ?? 50));
    output(list);
  },
});

const productGet = defineCommand({
  meta: { name: "get", description: "按 ID 查商品详情" },
  args: { id: { type: "string", description: "商品 ID", required: true } },
  async run({ args }) {
    const info = await getProduct(args.id as string);
    output(info);
  },
});

const productCreate = defineCommand({
  meta: { name: "create", description: "新建商品" },
  args: {
    name: { type: "string", description: "商品全名", alias: "n", required: true },
    code: { type: "string", description: "商品编号（需唯一）", alias: "c", required: true },
    unit: { type: "string", description: "单位，默认'个'", alias: "u" },
    cost: { type: "string", description: "成本价（进价）" },
    sale: { type: "string", description: "售价（批发价1）" },
    retail: { type: "string", description: "零售价" },
    standard: { type: "string", description: "规格" },
  },
  async run({ args }) {
    const result = await createProduct({
      name: args.name as string,
      code: args.code as string,
      unit: args.unit as string | undefined,
      costPrice: args.cost != null ? Number(args.cost) : undefined,
      salePrice: args.sale != null ? Number(args.sale) : undefined,
      retailPrice: args.retail != null ? Number(args.retail) : undefined,
      standard: args.standard as string | undefined,
    });
    output(result);
    if (!result.success) process.exit(1);
  },
});

export const productGroup = defineCommand({
  meta: { name: "product", description: "商品模块" },
  subCommands: { list: productList, get: productGet, create: productCreate },
});
