/**
 * 采购模块命令：create / delete。
 */
import { defineCommand } from "citty";
import {
  createPurchase,
  type PurchaseItemInput,
  findPurchaseBill,
  deletePurchaseBill,
  forceDeletePurchaseBill,
} from "../modules/purchase.ts";
import {
  createPurchaseReturn,
  type PurchaseReturnItemInput,
} from "../modules/purchasereturn.ts";
import { readConfirm } from "../prompt.ts";
import { output, die, parseItems } from "./shared.ts";

const purchaseCreate = defineCommand({
  meta: { name: "create", description: "创建采购入库单" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    supplier: { type: "string", description: "供应商名（必填）", alias: "s" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":10,"price":3.5}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（confirm:true，绕过「价格为0」等需确认异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.supplier) die("缺少供应商名 --supplier");
    const items = parseItems<PurchaseItemInput>(args.items as string);

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const s = await api.resolveSupplier(args.supplier as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const sk = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...sk };
        }),
      );
      output({ warehouse: w, supplier: s, items: resolved });
      return;
    }

    const result = await createPurchase(
      {
        warehouse: args.warehouse as string | undefined,
        supplier: args.supplier as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    output(result);
    if (!result.success) process.exit(1);
  },
});

const purchaseDelete = defineCommand({
  meta: { name: "delete", description: "删除采购入库单（二次确认 + 负库存保护）" },
  args: {
    bill: { type: "string", description: "采购单号(CR-...)或 vchcode（必填）", required: true },
    force: { type: "boolean", description: "删除会导致负库存时，强制删除(confirm:true)" },
    yes: { type: "boolean", description: "跳过交互二次确认（非交互/脚本用；负库存强制删除仍需 --force）" },
  },
  async run({ args }) {
    const ref = await findPurchaseBill(args.bill as string);
    console.log(
      `⚠️  即将删除采购单 ${ref.billNumber} | 供应商 ${ref.bfullname} | 金额 ${ref.currencyBillTotal} | 日期 ${ref.billDate}`,
    );

    // ① 二次确认（删除意图）
    const confirmed = args.yes ? true : await readConfirm("确认删除? (y/N) ");
    if (!confirmed) {
      console.error(process.stdin.isTTY ? "✗ 已取消" : "✗ 未确认：非交互环境请加 --yes 显式确认");
      process.exit(1);
    }

    // 第1阶段删除（不带 confirm）
    const r1 = await deletePurchaseBill(ref);
    if (r1.deleted) {
      output({ success: true, deleted: true, billNumber: ref.billNumber, vchcode: ref.vchcode });
      return;
    }

    if (r1.needsForce) {
      // 删除会导致负库存：打印影响
      const lines = r1.exceptions.flatMap((e) =>
        (e.detail ?? []).map((d) => {
          const x = d as Record<string, unknown>;
          return `  - ${x.pfullname}(${x.kfullname ?? "默认仓库"}): 库存 ${x.stockQty}，删除后 ${x.unitQty}`;
        }),
      );
      console.error(`✗ 删除会导致库存为负：\n${lines.join("\n")}`);
      if (!args.force) {
        console.error("如需强制删除（允许负库存），请加 --force");
        process.exit(1);
      }
      // ② 负库存强制删除的二次确认
      const confirmed2 = args.yes ? true : await readConfirm("⚠️ 强制删除会导致负库存，仍继续? (y/N) ");
      if (!confirmed2) {
        console.error("✗ 已取消");
        process.exit(1);
      }
      const r2 = await forceDeletePurchaseBill(ref);
      output({ success: r2.success, deleted: r2.deleted, forced: true, billNumber: ref.billNumber, vchcode: ref.vchcode, exceptions: r2.exceptions });
      if (!r2.success) process.exit(1);
      return;
    }

    // 其它错误
    console.error(`✗ 删除失败：${r1.exceptions.map((e) => `${e.code}:${e.message}`).join("; ")}`);
    process.exit(1);
  },
});

const purchaseReturn = defineCommand({
  meta: { name: "return", description: "创建采购退货单（采购入库的逆向流程，货退回供应商）" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    supplier: { type: "string", description: "供应商名（必填）", alias: "s" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":1,"price":4}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（confirm:true，绕过「价格为0」等需确认异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.supplier) die("缺少供应商名 --supplier");
    const items = parseItems<PurchaseReturnItemInput>(args.items as string);

    if (args["dry-run"]) {
      const { JxcClient } = await import("../api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const s = await api.resolveSupplier(args.supplier as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const sk = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...sk };
        }),
      );
      output({ warehouse: w, supplier: s, items: resolved });
      return;
    }

    const result = await createPurchaseReturn(
      {
        warehouse: args.warehouse as string | undefined,
        supplier: args.supplier as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    output(result);
    if (!result.success) process.exit(1);
  },
});

export const purchaseGroup = defineCommand({
  meta: { name: "purchase", description: "采购模块" },
  subCommands: { create: purchaseCreate, delete: purchaseDelete, return: purchaseReturn },
});
