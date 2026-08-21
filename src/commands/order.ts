/**
 * 订单命令：list（订单列表）/ detail（订单明细）。
 */
import { defineCommand } from "citty";
import {
  listOrders,
  getOrder,
  ORDER_CATEGORIES,
  type OrderCategory,
} from "../modules/order.ts";
import { output, die } from "./shared.ts";

function requireCategory(raw: unknown): OrderCategory {
  const cat = (raw as string | undefined) ?? "sale";
  if (!ORDER_CATEGORIES.includes(cat as OrderCategory)) {
    die(`--category 只能是 ${ORDER_CATEGORIES.join("|")}`);
  }
  return cat as OrderCategory;
}

const orderList = defineCommand({
  meta: { name: "list", description: "订单列表（默认近7天已审核销售订单）" },
  args: {
    from: { type: "string", description: "起始日期 YYYY-MM-DD（默认今天-7）" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD（默认今天）" },
    category: {
      type: "string",
      description: "sale|buy|quotation|inquiry|transfer（默认 sale）",
      alias: "c",
    },
    state: {
      type: "string",
      description: "审核状态，逗号分隔：1待提交 2待审核 3审核中 4已驳回 5已审核 6已完成（默认 5）",
    },
    size: { type: "string", description: "返回条数，默认 20", alias: "n" },
  },
  async run({ args }) {
    const cat = requireCategory(args.category);
    const result = await listOrders({
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      category: cat,
      auditStates: args.state
        ? (args.state as string).split(",").map((s) => Number(s.trim()))
        : undefined,
      pageSize: Number(args.size ?? 20),
    });
    output(result);
  },
});

const orderDetail = defineCommand({
  meta: { name: "detail", description: "订单明细（商品行）" },
  args: {
    bill: { type: "string", description: "订单号（如 PXXD-20260810-00124）或 vchcode", alias: "b" },
    category: {
      type: "string",
      description: "sale|buy|quotation|inquiry|transfer（默认 sale）",
      alias: "c",
    },
    from: { type: "string", description: "找单号用：起始日期（默认今天-7）" },
    to: { type: "string", description: "找单号用：结束日期（默认今天）" },
    size: { type: "string", description: "找单号用：搜索条数，默认 200", alias: "n" },
  },
  async run({ args }) {
    if (!args.bill) die("--bill 必填，订单号或 vchcode");
    const cat = requireCategory(args.category);

    let vchcode = args.bill as string;
    // 传入的是单号 → 先在订单列表里解析成 vchcode
    if (isNaN(Number(vchcode)) || vchcode.length < 15) {
      const found = await listOrders({
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        category: cat,
        pageSize: Number(args.size ?? 200),
        auditStates: [1, 2, 3, 4, 5, 6], // 找单号时放开状态限制
      });
      const hit = (found.list ?? []).find((b) => b.billNumber === args.bill);
      if (!hit) {
        die(`订单中未找到单号 "${args.bill}"，可用 --from/--to 扩大范围后先 order list`);
      }
      vchcode = hit.vchcode;
    }

    const result = await getOrder(vchcode, { category: cat });
    output(result);
  },
});

export const orderGroup = defineCommand({
  meta: { name: "order", description: "订单管理（销售/采购/报价/询价订单查询）" },
  subCommands: { list: orderList, detail: orderDetail },
});
