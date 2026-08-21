# Command Reference

Use this file when exact parameters or output fields are needed. Successful business commands print JSON on stdout.

## Auth

```bash
gjp auth login -c <公司名或手机号> -u <用户名>
gjp auth status
gjp auth refresh
gjp auth whoami
gjp auth logout
```

Do not collect passwords in chat. Let `auth login` prompt interactively.

## Sales

Create sales outbound:

```bash
gjp sales create -c <客户名> --items '<JSON明细>' [-w 仓库] [--memo 备注] [--summary 摘要] [--date YYYY-MM-DD] [--dry-run] [--force]
```

Create sales return:

```bash
gjp sales return -c <客户名> --items '<JSON明细>' [-w 仓库] [--memo 备注] [--summary 摘要] [--date YYYY-MM-DD] [--dry-run] [--force]
```

`--items` format:

```json
[{"name":"可口可乐","qty":24,"price":3.5}]
```

Success output:

```json
{
  "success": true,
  "billNumber": "PXX-20260620-00010",
  "vchcode": "1904436181773954104",
  "total": 84,
  "needsConfirm": false,
  "exceptions": []
}
```

Sales return bill numbers start with `PXT-`.

## Purchase

Create purchase inbound:

```bash
gjp purchase create -s <供应商名> --items '<JSON明细>' [-w 仓库] [--memo 备注] [--summary 摘要] [--date YYYY-MM-DD] [--dry-run] [--force]
```

Create purchase return:

```bash
gjp purchase return -s <供应商名> --items '<JSON明细>' [-w 仓库] [--memo 备注] [--summary 摘要] [--date YYYY-MM-DD] [--dry-run] [--force]
```

Delete purchase inbound:

```bash
gjp purchase delete --bill <CR-单号或vchcode> [--yes] [--force]
```

Purchase inbound bill numbers start with `CR-`; purchase return bill numbers start with `CT-`.

## Product

```bash
gjp product list [-k <关键字>] [-n <条数>]
gjp product get --id <商品ID>
gjp product create -n <商品全名> -c <编号> [-u 单位] [--cost 成本价] [--sale 售价] [--retail 零售价] [--standard 规格]
```

Duplicate product code returns an error such as `5001002`. Search first when the operator gives a product that may already exist.

## Customer And Supplier

```bash
gjp customer list [-k <关键字>] [-t customer|supplier|all] [-n <条数>] [--include-stopped]
gjp customer get --id <往来单位ID>
gjp customer create -n <全名> -t customer|supplier [-c 编号] [-s 简称] [--category 分类名] [--contact 联系人] [--phone 电话] [--area 地区] [--address 地址] [--memo 备注]
gjp customer contact --id <ID> [--phone 电话] [--contact 联系人] [--area 地区] [--address 地址]
gjp customer stop --ids <ID,ID或JSON数组>
gjp customer enable --ids <ID,ID或JSON数组>
```

Use `customer` for customers and `supplier` for suppliers. The CLI handles category/accounting differences internally.

## Stock

```bash
gjp stock status [-k <商品关键字>] [-w <仓库名>] [--include-zero] [-n <条数>]
gjp stock position [-k <商品关键字>] [-w <仓库名>] [-n <条数>]
gjp stock warehouses
```

Common stock fields:

- `qty`: current quantity.
- `stockQty`: physical stock.
- `saleableQty`: saleable quantity.
- `sendableQty`: sendable quantity.
- `costTotal`: cost amount.
- `prepriceTotal`: sale price amount.

## Bill Center

```bash
gjp bill list [--from YYYY-MM-DD] [--to YYYY-MM-DD] [-t purchase|sale|stock|finance|all] [--party <对方单位名>] [--bill <单据号>] [-n <条数>]
gjp bill types [--all]
```

Use `bill list --bill <单号>` to obtain `vchcode` for follow-up operations.

## Finance

Arrears:

```bash
gjp finance arrears [-t customer|supplier|all] [-k <关键字>] [--include-zero] [-n <条数>]
```

Reconciliation:

```bash
gjp finance reconciliation --party <对方单位名> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [-n <条数>]
```

Payment to supplier:

```bash
gjp finance payment -s <供应商名> --amount <金额> [-a 资金账户] [--memo 摘要] [--date YYYY-MM-DD] [--dry-run]
```

Receipt from customer:

```bash
gjp finance receipt -c <客户名> --amount <金额> [-a 资金账户] [--memo 摘要] [--date YYYY-MM-DD] [--dry-run]
```

Finance bill query/detail/delete:

```bash
gjp finance list [-t payment|receipt|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--party 对方名] [--bill 单号] [-n 条数]
gjp finance get --id <vchcode或FK-/SK-单号>
gjp finance delete --bill <FK-/SK-单号或vchcode> [--yes]
```

Payment bill numbers start with `FK-`; receipt bill numbers start with `SK-`.

## Report

```bash
gjp report income [-p YYYYMM] [--summary-only]
```

Summary output:

```json
{
  "period": "202606",
  "revenue": 113.8,
  "expense": 46.58,
  "profit": 67.22,
  "yearProfit": 0
}
```


## Orders (order)

Order family (sale/buy/quotation/inquiry) is separate from goods bills; not in `bill list`.

```bash
gjp order list [--from YYYY-MM-DD] [--to YYYY-MM-DD] [-c sale|buy|quotation|inquiry|transfer] [--state 1,2,3,4,5,6] [-n <条数>]
gjp order detail -b <订单号|vchcode> [-c sale] [--from ...] [--to ...]
```

- Default: sale orders, last 7 days, auditState=5 (已审核).
- auditState: 1待提交 2待审核 3审核中 4已驳回 5已审核 6已完成.
- API: `recordsheet/orderBillCore/list` (vchtypes: sale=9001 buy=9000 quotation=9003 inquiry=9004 transfer=9005) + `recordsheet/orderBill/getBill` (`{vchcode, vchtype:"SaleOrder", show:true}`).
- Note: order numbers share the `PXXD-` prefix with sales outbound bills; tell them apart via summary ("由销售订单…生成" on the outbound bill).

## Posted Bill Detail (bill detail)

`bill list` returns summaries only; `bill detail` fetches product lines of a posted bill.

```bash
gjp bill detail -b <单据号|vchcode> [--vchtype Sale|SaleBack|Buy|BuyBack] [--from ...] [--to ...] [-n <条数>]
```

- Bill family inferred from prefix: `PXX-`→Sale, `PXT-`→SaleBack, `CR-`/`CGD`→Buy, `CT-`→BuyBack.
- API: `recordsheet/goodsBill/getBillByVchcode` `{vchcode, vchtype, businessType, copyTypeEnum:"DEFAULT"}`; lines in `outDetail`/`inDetail` (`pFullName`, `standard`, `qty`, `unitName`, `currencyPrice`, `currencyTotal`).
- Typical flow: `bill list` → pick billNumber → `bill detail -b <billNumber>`.
