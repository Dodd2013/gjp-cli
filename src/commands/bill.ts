/**
 * 单据中心命令：list（跨类型查单据）/ types（业务类型枚举）/ detail（已过账单据商品明细）。
 */
import { defineCommand } from "citty";
import {
  listBills,
  listBusinessTypes,
  getPostedBillDetail,
  BILL_PREFIX_MAP,
  GOODS_VCHTYPE_MAP,
  type BillTypeGroup,
} from "../modules/bill.ts";
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

const billDetail = defineCommand({
  meta: { name: "detail", description: "已过账单据明细（商品行）" },
  args: {
    bill: { type: "string", description: "单据号（PXX-/PXT-/CR-/CT- 开头）或 vchcode", alias: "b" },
    vchtype: { type: "string", description: "Sale|SaleBack|Buy|BuyBack（默认按单号前缀推断）" },
    from: { type: "string", description: "找单号用：起始日期（默认今天-7）" },
    to: { type: "string", description: "找单号用：结束日期（默认今天）" },
    size: { type: "string", description: "找单号用：搜索条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    if (!args.bill) die("--bill 必填，单据号或 vchcode");

    // 1) 推断单据族
    let family = (args.vchtype as string | undefined) ?? "";
    if (!family) {
      const prefix = Object.keys(BILL_PREFIX_MAP).find((k) => (args.bill as string).startsWith(k));
      family = prefix ? BILL_PREFIX_MAP[prefix] : "Sale";
    }
    if (!(family in GOODS_VCHTYPE_MAP)) {
      die(`--vchtype 只能是 ${Object.keys(GOODS_VCHTYPE_MAP).join("|")}`);
    }

    // 2) 单号 → vchcode（通过单据中心反查；vchcode 本身是 19 位数字串）
    let vchcode = args.bill as string;
    if (isNaN(Number(vchcode)) || vchcode.length < 15) {
      const found = await listBills({
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        type: GOODS_VCHTYPE_MAP[family].group,
        billNumber: args.bill as string,
        pageSize: Number(args.size ?? 50),
      });
      const hit = (found.list ?? []).find((b) => b.billNumber === args.bill);
      if (!hit) die(`未找到单号 "${args.bill}"，可用 --from/--to 扩大范围后重试`);
      vchcode = hit.vchcode;
    }

    // 3) 取明细
    const result = await getPostedBillDetail(vchcode, { vchtype: family });
    output(result);
  },
});

export const billGroup = defineCommand({
  meta: { name: "bill", description: "单据中心（跨类型查单据 / 业务类型枚举 / 单据明细）" },
  subCommands: { list: billList, types: billTypes, detail: billDetail },
});
