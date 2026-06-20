/**
 * 单据中心命令：list（跨类型查单据）/ types（业务类型枚举）。
 */
import { defineCommand } from "citty";
import { listBills, listBusinessTypes, type BillTypeGroup } from "../modules/bill.ts";
import { output, die } from "./shared.ts";

const TYPE_GROUPS: BillTypeGroup[] = ["all", "purchase", "sale", "stock", "finance"];

const billList = defineCommand({
  meta: { name: "list", description: "单据中心：跨类型查询已过账单据" },
  args: {
    from: { type: "string", description: "起始日期 YYYY-MM-DD（默认今天-7）" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD（默认今天）" },
    type: { type: "string", description: "purchase|sale|stock|finance|all（默认 all）", alias: "t" },
    party: { type: "string", description: "对方单位名（客户/供应商）" },
    bill: { type: "string", description: "精确单据号，如 CR-20260620-00001", alias: "b" },
    size: { type: "string", description: "返回条数，默认 20", alias: "n" },
  },
  async run({ args }) {
    const type = (args.type as BillTypeGroup | undefined) ?? "all";
    if (!TYPE_GROUPS.includes(type)) die("--type 只能是 purchase|sale|stock|finance|all");
    const result = await listBills({
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      type,
      party: args.party as string | undefined,
      billNumber: args.bill as string | undefined,
      pageSize: Number(args.size ?? 20),
    });
    output(result);
  },
});

const billTypes = defineCommand({
  meta: { name: "types", description: "业务类型枚举（vchtype / businessType 字典）" },
  args: {
    all: { type: "boolean", description: "包含已停用的业务类型" },
  },
  async run({ args }) {
    const list = await listBusinessTypes(!!args.all);
    output(list);
  },
});

export const billGroup = defineCommand({
  meta: { name: "bill", description: "单据中心（跨类型查单据 / 业务类型枚举）" },
  subCommands: { list: billList, types: billTypes },
});
