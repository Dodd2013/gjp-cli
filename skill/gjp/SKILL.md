---
name: gjp
description: Use the gjp CLI to help operators work with the online Guanjiapo/Wangshang Guanjiapo inventory system through conversation. Trigger when users mention 管家婆, 网上管家婆, 进销存, gjp, 开销售单, 采购入库, 销售退货, 采购退货, 查库存, 商品, 客户, 供应商, 往来单位, 单据中心, 应收, 应付, 对账, 收款, 付款, 利润, 报表, 出入库, 删单, or ask an AI assistant to perform business operations in the system. The CLI must already be installed and authenticated with gjp auth login; business commands output JSON on stdout when successful.
---

# 管家婆进销存操作

Use `gjp` to operate the user's real 网上管家婆进销存账套. Treat this as a live business system: query freely when useful, but make write/delete/force actions explicit and confirm them with the user.

## First Step

Run a session check before the first business operation in a conversation:

```bash
gjp auth status
```

If there is no valid session and no saved credentials, ask the user to log in:

```bash
gjp auth login -c <公司名或手机号> -u <用户名>
```

Do not ask the user for their password in chat. Let the CLI prompt for it interactively.

## Operating Rules

- For read-only work, run the relevant command, parse the JSON, and answer in business language.
- For write work, collect required fields, run `--dry-run` when supported, show the resolved customer/supplier/product/warehouse and amount, then ask for confirmation before creating the real document.
- For delete work, find the document first, repeat bill number, party, date, amount, and inventory/finance impact, then require explicit user confirmation before using `--yes`.
- For `--force`, explain the business warning first. Use it only after the user explicitly accepts the consequence, such as negative stock or bypassing a price/stock validation.
- Keep stdout JSON parseable. If a command exits non-zero, inspect stderr and recover or explain the failure.
- Prefer exact names from list/search commands when a name is ambiguous. Do not guess between similar customers, suppliers, products, warehouses, or accounts.

## Intent Routing

Use this table to map operator language to CLI actions. Read the referenced file when the task needs details.

| User intent | Primary commands | Reference |
| --- | --- | --- |
| Check login/session | `gjp auth status`, `gjp auth whoami` | [troubleshooting.md](references/troubleshooting.md) |
| Create a sales outbound bill | `gjp sales create --dry-run`, then `gjp sales create` | [operator-workflows.md](references/operator-workflows.md), [command-reference.md](references/command-reference.md) |
| Create a sales return | `gjp sales return --dry-run`, then `gjp sales return` | [operator-workflows.md](references/operator-workflows.md) |
| Create a purchase inbound bill | `gjp purchase create --dry-run`, then `gjp purchase create` | [operator-workflows.md](references/operator-workflows.md) |
| Create a purchase return | `gjp purchase return --dry-run`, then `gjp purchase return` | [operator-workflows.md](references/operator-workflows.md) |
| Query stock or warehouses | `gjp stock status`, `gjp stock position`, `gjp stock warehouses` | [command-reference.md](references/command-reference.md) |
| Add or update products | `gjp product list`, `gjp product create`, `gjp product get` | [operator-workflows.md](references/operator-workflows.md), [command-reference.md](references/command-reference.md) |
| Add or update customers/suppliers | `gjp customer list`, `gjp customer create`, `gjp customer contact` | [operator-workflows.md](references/operator-workflows.md), [api-notes.md](references/api-notes.md) |
| Query bills/history | `gjp bill list`, `gjp bill types` | [command-reference.md](references/command-reference.md) |
| Delete purchase bills | `gjp purchase delete --bill ... --yes`, optional `--force` | [safety-policy.md](references/safety-policy.md), [operator-workflows.md](references/operator-workflows.md) |
| Query arrears/reconciliation | `gjp finance arrears`, `gjp finance reconciliation` | [operator-workflows.md](references/operator-workflows.md) |
| Create receipt/payment | `gjp finance receipt --dry-run`, `gjp finance payment --dry-run`, then real command | [operator-workflows.md](references/operator-workflows.md), [safety-policy.md](references/safety-policy.md) |
| Query/delete finance bills | `gjp finance list`, `gjp finance get`, `gjp finance delete --yes` | [operator-workflows.md](references/operator-workflows.md), [safety-policy.md](references/safety-policy.md) |
| Create a fee bill | `gjp finance fee --dry-run`, then `gjp finance fee` | [operator-workflows.md](references/operator-workflows.md), [safety-policy.md](references/safety-policy.md) |
| Query orders | `gjp order list`, `gjp order detail -b <订单号>` | [command-reference.md](references/command-reference.md) |
| Query bill line items | `gjp bill detail -b <单据号>` | [command-reference.md](references/command-reference.md) |
| Query profit report | `gjp report income --summary-only` | [command-reference.md](references/command-reference.md) |

## Conversation Pattern

For operator-facing tasks, use this loop:

1. Identify whether the request is read-only, write, delete, or force.
2. Ask only for missing business fields that cannot be inferred safely.
3. Run lookup or `--dry-run` commands to resolve names to system records.
4. Summarize the planned operation in plain language.
5. Ask for explicit confirmation for write/delete/force actions.
6. Execute the command and return the important result: bill number, amount, party, date, stock/arrears/profit values, or failure reason.

Example confirmation text:

```text
我将创建一张销售出库单：客户「万达超市」，商品「可口可乐」24 瓶，单价 3.5，仓库「默认仓库」，合计 84。确认创建吗？
```

## References

Load these only when needed:

- [operator-workflows.md](references/operator-workflows.md): Natural-language workflows for common operator tasks.
- [command-reference.md](references/command-reference.md): Full command parameters, outputs, and examples.
- [safety-policy.md](references/safety-policy.md): Confirmation, `--dry-run`, delete, and `--force` rules.
- [troubleshooting.md](references/troubleshooting.md): Login, matching, JSON, and business error recovery.
- [api-notes.md](references/api-notes.md): Non-obvious API behavior that affects CLI usage.
