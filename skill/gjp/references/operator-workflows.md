# Operator Workflows

Use this file when the user asks in natural business language and you need to choose commands, ask follow-up questions, or explain results.

## General Workflow

1. Check session once with `gjp auth status`.
2. Classify the task:
   - Read-only: stock, bill list, arrears, reconciliation, report, detail lookup.
   - Write: create sales/purchase/return/product/customer/payment/receipt.
   - Delete: purchase bill deletion or finance bill deletion.
   - Force: any operation requiring `--force`.
3. For writes, gather missing required fields and run `--dry-run` when available.
4. Show the resolved records and ask for confirmation before the real write.
5. Run the command, parse JSON, and tell the operator the business result.

## Sales Outbound

Operator examples:

- "给万达超市开一张可口可乐 24 瓶，单价 3.5 的销售单"
- "昨天给客户补一张销售出库单"

Required fields:

- Customer name.
- Item list: product name, quantity, unit price.
- Optional warehouse, date, memo/summary.

Process:

```bash
gjp sales create -c <客户名> --items '<JSON明细>' --dry-run
```

After dry-run, confirm customer, warehouse, resolved products/SKUs, quantities, prices, date, and total. Then run without `--dry-run`.

If result has `needsConfirm:true` and exceptions include `NEG_STOCK_ERROR`, explain that stock is insufficient. Use `--force` only after the user explicitly agrees to save despite the warning.

## Sales Return

Use when the customer returns goods and stock should increase.

Command shape:

```bash
gjp sales return -c <客户名> --items '<JSON明细>' --dry-run
```

Confirm that this is a return, not a new sale. The real bill number starts with `PXT-`. `--force` follows the sales family mechanism and bypasses validation warnings.

## Purchase Inbound

Use when buying goods from a supplier and stock should increase.

Required fields:

- Supplier name.
- Item list: product name, quantity, purchase unit price.
- Optional warehouse, date, memo/summary.

Process:

```bash
gjp purchase create -s <供应商名> --items '<JSON明细>' --dry-run
```

Confirm supplier, warehouse, products, quantities, prices, date, and total. Then run without `--dry-run`.

If result has `needsConfirm:true` and exceptions include `COST_BATCH_ERROR`, it usually means a price is zero. Use `--force` only after the user confirms that zero price or the warning is acceptable.

## Purchase Return

Use when returning previously purchased goods to a supplier and stock should decrease.

Command shape:

```bash
gjp purchase return -s <供应商名> --items '<JSON明细>' --dry-run
```

Confirm this is a return to supplier, not a purchase inbound. The real bill number starts with `CT-`. The force behavior is the same as purchase inbound: `confirm:true` on retry.

## Stock Query

Use `stock status` for business questions like "还剩多少", "够不够卖", or "库存金额".

```bash
gjp stock status -k <商品关键字> [-w <仓库名>] [-n 50]
```

Use `stock position` when the operator asks for warehouse/position/batch distribution:

```bash
gjp stock position -k <商品关键字> [-w <仓库名>]
```

Answer with the product name, warehouse if relevant, current quantity, saleable quantity, sendable quantity, and unit.

## Product Maintenance

Before creating a product, search by name/code:

```bash
gjp product list -k <关键字>
```

If no existing product matches, create:

```bash
gjp product create -n <商品全名> -c <编号> [-u 单位] [--cost 成本价] [--sale 售价] [--retail 零售价] [--standard 规格]
```

If duplicate code appears, tell the operator the code already exists and ask whether to use another code or inspect the existing product.

## Customer And Supplier Maintenance

Search first:

```bash
gjp customer list -k <关键字> -t customer|supplier|all
```

Create only after confirming whether the party is a customer or supplier:

```bash
gjp customer create -n <全名> -t customer|supplier [--phone 电话] [--contact 联系人] [--area 地区] [--address 地址] [--memo 备注]
```

For contact updates:

```bash
gjp customer contact --id <往来单位ID> [--phone ...] [--contact ...] [--area ...] [--address ...]
```

If the user provides only a name for updates, search first and ask them to choose if there is more than one plausible match.

## Bill Search

Use for "查历史单据", "找这张单", "上周某客户的单据".

```bash
gjp bill list [--from YYYY-MM-DD] [--to YYYY-MM-DD] [-t purchase|sale|stock|finance|all] [--party <对方>] [--bill <单号>] [-n 条数]
```

Return bill number, date, party, amount, business type, and `vchcode` when the next operation needs it.

## Purchase Bill Deletion

Use only for purchase inbound bills. Search or confirm the exact `CR-` bill number first.

```bash
gjp purchase delete --bill <CR-单号或vchcode> --yes
```

If the command reports negative stock and asks for `--force`, explain the affected products and require explicit confirmation before:

```bash
gjp purchase delete --bill <CR-单号或vchcode> --yes --force
```

## Arrears And Reconciliation

For "客户欠多少钱", "供应商还欠多少", "应收应付":

```bash
gjp finance arrears [-t customer|supplier|all] [-k <关键字>] [--include-zero]
```

For bill-level details:

```bash
gjp finance reconciliation --party <客户或供应商名> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
```

Explain `arTotal` as receivable from customer, `apTotal` as payable to supplier, `prTotal` as advance received, and `ppTotal` as advance paid.

## Receipt And Payment

Use receipt when receiving money from a customer:

```bash
gjp finance receipt -c <客户名> --amount <金额> [-a 资金账户] [--memo 摘要] --dry-run
```

Use payment when paying a supplier:

```bash
gjp finance payment -s <供应商名> --amount <金额> [-a 资金账户] [--memo 摘要] --dry-run
```

After dry-run, confirm party, account, amount, date, and memo. Then run without `--dry-run`.

Important: these commands do not settle specific source bills; they directly reduce the party balance.

## Finance Bill Query And Deletion

List finance bills:

```bash
gjp finance list [-t payment|receipt|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--party 对方] [--bill 单号]
```

Inspect detail:

```bash
gjp finance get --id <vchcode或FK-/SK-单号>
```

Delete only after repeating bill number, party, amount, and date:

```bash
gjp finance delete --bill <FK-/SK-单号或vchcode> --yes
```

## Profit Report

For "本月利润", "收入支出利润":

```bash
gjp report income --summary-only [-p YYYYMM]
```

Answer with period, revenue, expense, profit, and year profit.

