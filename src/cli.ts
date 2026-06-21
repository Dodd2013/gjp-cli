#!/usr/bin/env bun
/**
 * gjp CLI 入口：仅做命令树装配。各模块命令定义在 src/commands/，业务逻辑在 src/modules/。
 */
import { defineCommand, runMain } from "citty";
import { authGroup } from "./commands/auth.ts";
import { salesGroup } from "./commands/sales.ts";
import { purchaseGroup } from "./commands/purchase.ts";
import { productGroup } from "./commands/product.ts";
import { customerGroup } from "./commands/customer.ts";
import { billGroup } from "./commands/bill.ts";
import { stockGroup } from "./commands/stock.ts";
import { financeGroup } from "./commands/finance.ts";
import { reportGroup } from "./commands/report.ts";

const main = defineCommand({
  meta: {
    name: "gjp",
    version: "0.1.0",
    description: "管家婆进销存 CLI — 纯 HTTP，AI 友好",
  },
  subCommands: {
    auth: authGroup,
    sales: salesGroup,
    purchase: purchaseGroup,
    product: productGroup,
    customer: customerGroup,
    bill: billGroup,
    stock: stockGroup,
    finance: financeGroup,
    report: reportGroup,
  },
});

runMain(main);
