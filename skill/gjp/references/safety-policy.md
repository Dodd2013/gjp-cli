# Safety Policy

Use this file before any write, delete, or force operation.

## Risk Levels

Read-only commands can be run without confirmation:

- `auth status`, `auth whoami`
- `product list/get`
- `customer list/get`
- `stock status/position/warehouses`
- `bill list/types`
- `finance arrears/reconciliation/list/get`
- `report income`

Write commands require confirmation after lookup or dry-run:

- `sales create`
- `sales return`
- `purchase create`
- `purchase return`
- `product create`
- `customer create`
- `customer contact`
- `customer stop/enable`
- `finance payment`
- `finance receipt`

Delete commands require explicit confirmation:

- `purchase delete`
- `finance delete`

Force actions require a second, consequence-aware confirmation:

- `sales create --force`
- `sales return --force`
- `purchase create --force`
- `purchase return --force`
- `purchase delete --force`

## Confirmation Requirements

Before a write, repeat:

- Operation type.
- Customer/supplier/party.
- Warehouse/account when relevant.
- Products, quantities, prices, and total when relevant.
- Date and memo/summary when provided.

Before a delete, repeat:

- Bill number and `vchcode` if available.
- Bill type.
- Party.
- Date.
- Amount.
- Consequence: stock or receivable/payable/account balance will be reversed or affected.

Before `--force`, repeat:

- The exact warning or exception.
- What the force means in business terms.
- The affected product(s) or document(s), if available.

Do not proceed on vague confirmation such as "whatever" when the action is destructive or forced. Ask for a clear yes/confirm.

## Dry Run Rules

Use `--dry-run` before real writes when supported:

- Sales create/return.
- Purchase create/return.
- Finance receipt/payment.

Dry-run output resolves names to system records. Show the operator resolved names/IDs only as needed; avoid overwhelming them with internal fields.

If dry-run resolves the wrong party/product/warehouse/account, stop and ask the operator to clarify. Do not create the real document.

## Force Rules

Sales family force:

- Applies to `sales create` and `sales return`.
- Bypasses validation warnings such as negative stock by setting the sales-family confirmation fields internally.

Purchase family force:

- Applies to `purchase create` and `purchase return`.
- Retries with `confirm:true`, commonly for `COST_BATCH_ERROR` when price is zero.

Purchase delete force:

- Applies only when deletion would cause negative stock.
- Requires `--force` and explicit user acceptance.

Never add `--force` preemptively. First run without it, inspect the warning, explain it, and ask.

## Non-Interactive Deletes

When an AI tool runs a delete command, pass `--yes` only after the user has already confirmed in chat.

Good:

```bash
gjp finance delete --bill FK-20260621-00001 --yes
```

Not enough:

```bash
gjp finance delete --bill FK-20260621-00001
```

The latter may wait for interactive confirmation or fail in non-interactive environments.

## Result Reporting

After a successful write or delete, report only the important business fields:

- Bill number.
- Party.
- Amount.
- Date.
- Whether it was forced.
- Any remaining warning.

If the command fails, do not imply the operation happened. Report that it did not complete and explain the stderr or JSON error.

