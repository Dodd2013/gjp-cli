/**
 * 财务模块命令：arrears（应收应付汇总）/ reconciliation（对账明细）/ payment（付款单）/ receipt（收款单）。
 */
import { defineCommand } from "citty";
import {
  listArrears,
  listReconciliation,
  createPayment,
  createReceipt,
  listFinanceBills,
  getFinanceBillDetail,
  findFinanceBill,
  deleteFinanceBill,
  type ArrearsKind,
  type FinanceBillType,
} from "../modules/finance.ts";
import { readConfirm } from "../prompt.ts";
import { output, die } from "./shared.ts";

const financeArrears = defineCommand({
  meta: { name: "arrears", description: "往来单位应收应付汇总（按客户/供应商列出应收/应付/预收/预付余额）" },
  args: {
    type: {
      type: "string",
      description: "customer=应收(客户) | supplier=应付(供应商) | all（默认 all）",
      alias: "t",
    },
    keyword: { type: "string", description: "名称关键字过滤", alias: "k" },
    "include-zero": { type: "boolean", description: "包含零余额单位" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const kind = (args.type as ArrearsKind | undefined) ?? "all";
    if (!["customer", "supplier", "all"].includes(kind)) die("--type 只能是 customer | supplier | all");
    const result = await listArrears({
      kind,
      keyword: args.keyword as string | undefined,
      includeZero: !!args["include-zero"],
      pageSize: Number(args.size ?? 50),
    });
    output(result);
  },
});

const financeReconciliation = defineCommand({
  meta: { name: "reconciliation", description: "往来对账明细（某客户/供应商的单据级金额/已核销/未核销余额）" },
  args: {
    party: { type: "string", description: "对方单位名（必填）", required: true },
    from: { type: "string", description: "起始日期 YYYY-MM-DD（默认本月1日）" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD（默认今天）" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const result = await listReconciliation({
      party: args.party as string,
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      pageSize: Number(args.size ?? 50),
    });
    output(result);
  },
});

const financePayment = defineCommand({
  meta: { name: "payment", description: "创建付款单（付钱给供应商，FK- 前缀）" },
  args: {
    supplier: { type: "string", description: "供应商名（必填）", alias: "s", required: true },
    amount: { type: "string", description: "付款金额（必填，>0）", required: true },
    account: { type: "string", description: "资金账户名（现金/银行存款…，默认现金）", alias: "a" },
    memo: { type: "string", description: "摘要（如：货款）" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) die("--amount 必须是 >0 的数字");
    const input = {
      party: args.supplier as string,
      amount,
      account: args.account as string | undefined,
      memo: args.memo as string | undefined,
      date: args.date as string | undefined,
    };

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const supplier = await api.resolveSupplier(input.party);
      const account = await api.resolveAccount(input.account ?? "现金");
      output({ supplier, account, amount });
      return;
    }

    const result = await createPayment(input);
    output(result);
    if (!result.success) process.exit(1);
  },
});

const financeReceipt = defineCommand({
  meta: { name: "receipt", description: "创建收款单（收客户钱，SK- 前缀）" },
  args: {
    customer: { type: "string", description: "客户名（必填）", alias: "c", required: true },
    amount: { type: "string", description: "收款金额（必填，>0）", required: true },
    account: { type: "string", description: "资金账户名（现金/银行存款…，默认现金）", alias: "a" },
    memo: { type: "string", description: "摘要（如：货款）" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) die("--amount 必须是 >0 的数字");
    const input = {
      party: args.customer as string,
      amount,
      account: args.account as string | undefined,
      memo: args.memo as string | undefined,
      date: args.date as string | undefined,
    };

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const customer = await api.resolveCustomer(input.party);
      const account = await api.resolveAccount(input.account ?? "现金");
      output({ customer, account, amount });
      return;
    }

    const result = await createReceipt(input);
    output(result);
    if (!result.success) process.exit(1);
  },
});

const financeList = defineCommand({
  meta: { name: "list", description: "查询收付款单列表（付款单 FK- / 收款单 SK-）" },
  args: {
    type: {
      type: "string",
      description: "payment=付款单 | receipt=收款单 | all（默认 all）",
      alias: "t",
    },
    from: { type: "string", description: "起始日期 YYYY-MM-DD（默认今天-7）" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD（默认今天）" },
    party: { type: "string", description: "对方单位名过滤" },
    bill: { type: "string", description: "精确单据号，如 FK-20260621-00001" },
    size: { type: "string", description: "返回条数，默认 20", alias: "n" },
  },
  async run({ args }) {
    const type = (args.type as FinanceBillType | undefined) ?? "all";
    if (!["payment", "receipt", "all"].includes(type)) die("--type 只能是 payment | receipt | all");
    const result = await listFinanceBills({
      type,
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      party: args.party as string | undefined,
      billNumber: args.bill as string | undefined,
      pageSize: Number(args.size ?? 20),
    });
    output(result);
  },
});

const financeGet = defineCommand({
  meta: { name: "get", description: "查财务单据详情（账户明细：哪个账户收/付多少）" },
  args: {
    id: { type: "string", description: "单据 vchcode 或单据号 FK-/SK-（必填）", required: true },
  },
  async run({ args }) {
    // 若传单据号，先解析成 vchcode
    const ref = await findFinanceBill(args.id as string);
    const detail = await getFinanceBillDetail(ref.vchcode);
    output(detail);
  },
});

const financeDelete = defineCommand({
  meta: { name: "delete", description: "删除收付款单（二次确认；资金运动由核算反冲）" },
  args: {
    bill: { type: "string", description: "单据号(FK-/SK-)或 vchcode（必填）", required: true },
    yes: { type: "boolean", description: "跳过交互二次确认（非交互/脚本用）" },
  },
  async run({ args }) {
    const ref = await findFinanceBill(args.bill as string);
    const direction = ref.vchtypeEnum === "Payment" ? "付款" : ref.vchtypeEnum === "Receiving" ? "收款" : ref.vchtypeEnum;
    // 警告走 stderr，保持 stdout 为纯 JSON（便于 AI 解析）
    console.error(
      `⚠️  即将删除${direction}单 ${ref.billNumber} | 对方 ${ref.bfullname} | 金额 ${ref.currencyBillTotal} | 日期 ${ref.billDate}`,
    );

    const confirmed = args.yes ? true : await readConfirm("确认删除? (y/N) ");
    if (!confirmed) {
      console.error(process.stdin.isTTY ? "✗ 已取消" : "✗ 未确认：非交互环境请加 --yes 显式确认");
      process.exit(1);
    }

    const result = await deleteFinanceBill(ref);
    output(result);
    if (!result.success) process.exit(1);
  },
});

export const financeGroup = defineCommand({
  meta: { name: "finance", description: "财务模块（应收应付 / 对账 / 付款单 / 收款单 / 查删单据）" },
  subCommands: {
    arrears: financeArrears,
    reconciliation: financeReconciliation,
    payment: financePayment,
    receipt: financeReceipt,
    list: financeList,
    get: financeGet,
    delete: financeDelete,
  },
});
