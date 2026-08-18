/**
 * 财务模块命令：arrears（应收应付汇总）/ reconciliation（对账明细）/ payment（付款单）/ receipt（收款单）。
 */
import { defineCommand } from "citty";
import {
  listArrears,
  listReconciliation,
  createPayment,
  createReceipt,
  createFeeBill,
  type ArrearsKind,
  type FeeLineInput,
  type FeeCustomTypeName,
} from "../modules/finance.ts";
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


/** 解析费用行参数：--subject/--amount 单行，或 --lines '科目:金额[:备注];科目:金额' */
function parseFeeLines(args: Record<string, unknown>): FeeLineInput[] {
  const lines: FeeLineInput[] = [];
  if (args.lines) {
    for (const part of String(args.lines).split(";")) {
      const seg = part.split(":").map((x) => x.trim());
      if (seg.length < 2) die(`--lines 格式：科目:金额[:备注]，收到 "${part}"`);
      const amount = Number(seg[1]);
      if (!Number.isFinite(amount) || amount <= 0) die(`--lines 金额必须 > 0：${seg[0]}`);
      lines.push({ subject: seg[0], amount, memo: seg[2] });
    }
  }
  if (args.subject) {
    if (!args.amount) die("使用 --subject 时必须同时传 --amount");
    lines.push({ subject: String(args.subject), amount: Number(args.amount) });
  }
  return lines;
}

const financeFee = defineCommand({
  meta: { name: "fee", description: "创建费用单（XFY- 前缀，费用科目+付款账户，过账冲往来/费用）" },
  args: {
    party: { type: "string", description: "费用往来单位名（必填，付款方向）", alias: "p", required: true },
    subject: { type: "string", description: "费用科目名（单行：运费/佣金/手续费…）", alias: "s" },
    amount: { type: "string", description: "费用金额（与 --subject 搭配）" },
    lines: { type: "string", description: "多行费用，格式 科目:金额[:备注];科目:金额（与 --subject 二选一）", alias: "l" },
    type: { type: "string", description: "费用性质：采购|销售|管理|库存（默认 管理）", alias: "t" },
    account: { type: "string", description: "付款账户名（现金/银行存款…，默认 现金；none=挂应付不付款）", alias: "a" },
    memo: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    "no-post": { type: "boolean", description: "仅保存草稿，不过账" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    const lines = parseFeeLines(args);
    const customType = (args.type as FeeCustomTypeName | undefined) ?? "管理";
    if (!["采购", "销售", "管理", "库存"].includes(customType)) die("--type 只能是 采购|销售|管理|库存");
    if (!lines.length) die("需要 --subject/--amount 或 --lines 指定费用行");

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const resolved = [];
      for (const l of lines) resolved.push({ line: l, subject: await api.resolveFeeSubject(l.subject) });
      const party = await api.resolveSupplier(String(args.party));
      let account: unknown = "(挂应付)";
      if (args.account !== "none") account = await api.resolveAccount(String(args.account ?? "现金"));
      output({ party, account, customType, resolved });
      return;
    }

    const result = await createFeeBill({
      party: String(args.party),
      customType,
      lines,
      account: args.account as string | undefined,
      memo: args.memo as string | undefined,
      date: args.date as string | undefined,
      post: !args["no-post"],
    });
    output(result);
    if (!result.success) process.exit(1);
  },
});

export const financeGroup = defineCommand({
  meta: { name: "finance", description: "财务模块（应收应付 / 对账 / 付款单 / 收款单 / 费用单）" },
  subCommands: {
    arrears: financeArrears,
    reconciliation: financeReconciliation,
    payment: financePayment,
    receipt: financeReceipt,
    fee: financeFee,
  },
});
