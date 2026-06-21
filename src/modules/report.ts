/**
 * 报表模块：利润表（本月/本年发生额）。
 *
 * - getIncomeReport: `accounting/incomeReport/getCurrentIncomeReportDynamicShow`
 *   入参 `{period:"YYYYMM", atypeLevel:2, atypeFilter:1, multiOtypeId:[], dimensionType:1, showCheck:false}`
 *   返回按会计科目层级铺平的列表：收入类(00003)/支出类(00004)/利润。
 *   收入 - 支出 = 利润。
 */
import { JxcClient } from "../api/client.ts";

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(4) : 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export interface IncomeSubject {
  /** 科目类型 ID（层级编码：00003=收入类根，00004=支出类根，null=利润行） */
  typeId: string;
  /** 科目全名（含层级缩进） */
  fullname: string;
  /** 本期（本月）发生额 */
  monthTotal: number;
  /** 本年累计发生额 */
  yearTotal: number;
  /** 父科目 ID */
  parentTypeId: string;
}

export interface IncomeReport {
  /** 期间 YYYYMM */
  period: string;
  /** 收入合计 */
  revenue: number;
  /** 支出合计 */
  expense: number;
  /** 利润（收入-支出） */
  profit: number;
  /** 本年累计利润 */
  yearProfit: number;
  /** 明细科目列表 */
  items: IncomeSubject[];
}

interface RawIncomeRow {
  typeid: string;
  fullname: string;
  monthPeriodTotal: number;
  yearPeriodTotal: number;
  partypeid: string;
  classed: number;
  usercode: string;
}

/**
 * 取利润表。
 * @param period YYYYMM（如 "202606"），默认当前月
 */
export async function getIncomeReport(period?: string): Promise<IncomeReport> {
  const api = new JxcClient();
  await api.init();

  const now = new Date();
  const ym = period ?? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const data = await api.call<{ list: RawIncomeRow[] }>(
    "accounting/incomeReport/getCurrentIncomeReportDynamicShow",
    {
      refresh: true,
      queryParams: {
        period: ym,
        atypeLevel: 2,
        atypeFilter: 1,
        multiOtypeId: [],
        dimensionType: 1,
        showCheck: false,
      },
      pageSize: 100,
      pageIndex: 1,
      sorts: null,
      orders: null,
    },
  );

  const rows = data.list ?? [];
  const items: IncomeSubject[] = rows.map((r) => ({
    typeId: str(r.typeid),
    fullname: str(r.fullname),
    monthTotal: num(r.monthPeriodTotal),
    yearTotal: num(r.yearPeriodTotal),
    parentTypeId: str(r.partypeid),
  }));

  const revenueRow = rows.find((r) => r.typeid === "00003");
  const expenseRow = rows.find((r) => r.typeid === "00004");
  const profitRow = rows.find((r) => !r.typeid && str(r.fullname).trim() === "利润");

  return {
    period: ym,
    revenue: num(revenueRow?.monthPeriodTotal),
    expense: num(expenseRow?.monthPeriodTotal),
    profit: num(profitRow?.monthPeriodTotal),
    yearProfit: num(profitRow?.yearPeriodTotal),
    items,
  };
}
