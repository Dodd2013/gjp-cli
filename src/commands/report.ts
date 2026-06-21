/**
 * 报表模块命令：income（利润表/本月发生额）。
 */
import { defineCommand } from "citty";
import { getIncomeReport } from "../modules/report.ts";
import { output, die } from "./shared.ts";

const reportIncome = defineCommand({
  meta: { name: "income", description: "利润表（收入/支出/利润，按月发生额）" },
  args: {
    period: {
      type: "string",
      description: "期间 YYYYMM（如 202606），默认当前月",
      alias: "p",
    },
    "summary-only": {
      type: "boolean",
      description: "只输出收入/支出/利润汇总，不含明细科目",
    },
  },
  async run({ args }) {
    const period = args.period as string | undefined;
    if (period && !/^\d{6}$/.test(period)) die("--period 需为 6 位 YYYYMM（如 202606）");

    const report = await getIncomeReport(period);
    if (args["summary-only"]) {
      output({
        period: report.period,
        revenue: report.revenue,
        expense: report.expense,
        profit: report.profit,
        yearProfit: report.yearProfit,
      });
      return;
    }
    output(report);
  },
});

export const reportGroup = defineCommand({
  meta: { name: "report", description: "报表模块（利润表等）" },
  subCommands: { income: reportIncome },
});
