# API Notes For CLI Use

Use this file when a business behavior seems surprising or when extending/debugging the CLI. It is not a full API document; the full project API notes live in `docs/API.md` when working inside the repository.

## Authentication

Login is pure HTTP and does not require browser device fingerprint fields. `/jxc/` business APIs rely on session cookies such as `ngp-authorization` and `ngp-router`. The CLI handles this; skill users should normally use only `gjp auth ...`.

## Response Envelope

Business APIs use a unified envelope:

```json
{"code":"200","message":"操作成功","traceId":"...","data":{}}
```

`code !== "200"` is an error. CLI modules should surface the message explicitly.

## Goods Bill Families

Sales outbound:

- `vchtype: "Sale"`
- `businessType: "SaleNormal"`
- Bill prefix `PXX-`
- Uses `outDetail`.
- Force uses sales-family validation bypass fields.

Sales return:

- `vchtype: "SaleBack"`
- `businessType: "SaleNormal"`
- Bill prefix `PXT-`
- Uses `inDetail`.
- Force mechanism is the same as sales outbound.

Purchase inbound:

- `vchtype: "Buy"`
- `businessType: "Buy"`
- Bill prefix `CR-`
- Uses `inDetail`.
- Force retries with `confirm:true`.

Purchase return:

- `vchtype: "BuyBack"`
- `businessType: "Buy"`
- Bill prefix `CT-`
- Uses `outDetail`.
- Force retries with `confirm:true`.

## Customer Contact Fields

`btype/save` does not persist phone/contact/address fields by itself. The CLI saves these via `deliverinfo/batchSave`, then the server backfills `btype.tel` and `btype.person`.

If a contact update appears not to stick, inspect the deliverinfo flow rather than only the btype save payload.

## Finance Bills

Receipt/payment use `recordsheet/finance/submitBill/`, not the goods bill submit endpoint.

- Payment to supplier: `Payment`, prefix `FK-`, amount is often represented as negative in finance bill list.
- Receipt from customer: `Receiving`, prefix `SK-`.
- Both use `businessType: "PaymentNormal"`.
- Current CLI receipt/payment does not settle specific source bills; it directly changes the party balance.

## Stock Queries

Inventory query filters warehouse by `ktypeIdss` with two `s` characters. This is handled internally by the CLI. `data.total` may be `-1` for some stock queries; prefer the returned list length when summarizing.

## Bill Center

`postBill/listPostBill` uses numeric `vchtypes` grouped by broad document category. `accBusinessType/list` returns a related but different business type dictionary. For operator-facing work, prefer CLI aliases like `-t purchase|sale|stock|finance|all`.


## Order Bills (orderBillCore / orderBill)

- Orders live in a separate bill family ("prepare bills", BillTypes code 90). They do NOT appear in `postBill/listPostBill` or `goodsBill/*`.
- List: `recordsheet/orderBillCore/list` with numeric `vchtypes` in queryParams: sale=9001, buy=9000, quotation=9003, inquiry=9004, transfer=9005; `auditStateList` is required (5=已审核; 1待提交 2待审核 3审核中 4已驳回 6已完成); `overStateList` default [0,3]; `businessTypeList:[201]`.
- Detail: `recordsheet/orderBill/getBill` `{vchcode, vchtype:"SaleOrder", show:true, queryOnlyUnFinishDetail:false}` → `data.detail[]` product lines.
- vchtype parameter style differs per endpoint: string enums for `orderBill/getBill` / `billStatus/billStatus` ("Sale"), numeric codes for list filters ([9001]). Always mirror what the web frontend sends.
- Order→outbound conversion: `orderBill/checkBill` `{createType:4, vchcodeList, createVchtype:"Sale", fromVchtype:"SaleOrder"}` then `orderBill/selectDetailCreateBill`.
- Full reverse-engineering notes: docs/API.md §15-§18.

## Posted Bill Detail

`recordsheet/goodsBill/getBillByVchcode` with `copyTypeEnum:"DEFAULT"` + an existing vchcode returns the full posted bill incl. `outDetail`/`inDetail` product lines (196 fields per line; key ones: pFullName, standard, qty, unitName, currencyPrice, currencyTotal, costPrice).
