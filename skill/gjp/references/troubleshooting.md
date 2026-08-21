# Troubleshooting

Use this file when a command fails, exits non-zero, or returns a business warning.

## Session Problems

Symptom:

```text
无有效 session
无本地会话
已过期
```

Action:

1. Run `gjp auth status`.
2. If credentials are saved, retry the business command; the CLI may auto-login.
3. If no credentials are saved, ask the user to run `gjp auth login -c <公司> -u <用户名>`.

Do not ask for the password in chat.

## Login Failure

If login fails, ask the user to check company/user/password. If repeated failures trigger slider verification, the CLI cannot solve it. Ask the user to wait or log in through the web UI to reset the verification state.

## Name Not Found Or Ambiguous

Typical messages:

```text
未找到仓库/客户/供应商/商品/资金账户
```

Action:

- Use list/search commands to find the exact name.
- Ask the operator to choose if multiple records look plausible.
- Re-run dry-run with the corrected name before writing.

Useful commands:

```bash
gjp product list -k <关键字>
gjp customer list -k <关键字> -t customer|supplier|all
gjp stock warehouses
gjp finance payment -s <供应商> --amount 1 --dry-run
gjp finance receipt -c <客户> --amount 1 --dry-run
```

Use the finance dry-run account lookup only when the party and amount are harmless placeholders and no real write will occur.

## JSON And Shell Quoting

`--items` must be valid JSON and is safest inside single quotes:

```bash
gjp sales create -c 万达超市 --items '[{"name":"可口可乐","qty":24,"price":3.5}]' --dry-run
```

Common failures:

- Missing quotes around property names.
- Chinese punctuation.
- Empty array.
- Quantity or price as non-numeric text.

## Command Output

Successful business commands print JSON on stdout. Warnings and prompts should be treated as stderr or non-JSON text. If stdout contains non-JSON text before JSON, do not parse blindly; report the issue and prefer fixing the CLI command contract.

Some validation failures exit non-zero and print only stderr, not `{"success":false}`. In that case, use the stderr message as the failure reason.

## Confirmation Results

`needsConfirm:true` means the server returned a warning that needs user decision.

Sales warnings commonly include:

- `NEG_STOCK_ERROR`: stock is insufficient or would go negative.

Purchase warnings commonly include:

- `COST_BATCH_ERROR`: price/cost warning, often price is zero.

Do not automatically retry with force. Explain the warning and ask.

## Delete Failures

For purchase delete:

- If deletion would cause negative stock, the command prints affected products and asks for `--force`.
- Explain the stock consequence and ask whether to force delete.

For finance delete:

- It reverses the finance document's effect on balance/accounting.
- It does not have the purchase negative-stock chain.

## Date Defaults

Many commands default to today or a recent range. If the operator says "昨天", "上周", "本月", translate to explicit dates before running. If the date changes the business document date, include it in confirmation.


## Multi-product login (多账套)

Accounts with multiple product profiles (produtId) do not get a `loginUrl` directly from `ngpLogin`; the CLI auto-resolves via `/api/loginByProfileId` using the selected entry's `sign`.

- Pin a profile: `GJP_PRODUCT_ID=88` env var, or write the numeric id to `~/.gjp/product-id` (e.g. `88`).
- Without pinning, the first profile is used (stderr prints a notice listing all profiles).
- Some profiles live on a dedicated cluster (e.g. `ngpd5kj.wsgjp.com.cn`). After login the actual API origin is saved to `~/.gjp/api-base` and all `/jxc` requests are transparently re-rooted there. If you see HTML login pages in responses ("响应非 JSON"), the api-base is missing/stale — re-login to regenerate it.
