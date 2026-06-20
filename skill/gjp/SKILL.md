---
name: gjp
description: 通过 gjp CLI 操作网上管家婆（wsgjp）进销存系统——开销售/采购单、查库存、查报表等。
  当用户提到「管家婆」「进销存」「开单/开销售单/开采购单」「查库存」「出入库」「gjp」等，需要在该系统里做操作时使用。
  前置：需已安装 gjp CLI 并执行 gjp auth login。所有命令默认输出 JSON。
---

# 管家婆进销存操作（gjp CLI）

本 Skill 驱动 `gjp` 命令行工具操作网上管家婆云进销存系统。`gjp` 是纯 HTTP 实现的 CLI，会话本地持久化（5 小时有效，过期自动重登）。

## 前置检查

每次操作前先确认会话可用：

```bash
gjp auth status
```

若提示「无本地会话」或「已过期」且本地无凭据，需先登录（用户自己的账号）：

```bash
gjp auth login -c <公司名或手机号> -u <用户名>
# 密码会以掩码方式交互输入；凭据落盘 ~/.gjp/credentials.json（0600）
```

会话过期时只要有保存的凭据，命令会**自动重登**，通常无需手动干预。

## 通用约定

- 所有业务命令**默认输出 JSON**，便于解析。失败时 `success: false` 且退出码非 0。
- 名称类参数（仓库/客户/商品）用**中文名**即可，CLI 会自动解析成系统 ID。
- 解析不确定时先加 `--dry-run` 看名称→ID 解析结果，不真正执行。

## 销售（sales）

### 开销售出库单

```bash
gjp sales create \
  -w <仓库名> \              # 可选，默认第一个仓库
  -c <客户名> \              # 必填
  --items '<JSON明细>' \      # 必填
  [--memo 备注] \
  [--date YYYY-MM-DD] \       # 默认今天
  [--force]                   # 绕过库存不足等需确认的异常
```

`--items` 是商品数组，每项 `{name, qty, price}`：

```bash
gjp sales create -c 万达超市 \
  --items '[{"name":"可口可乐","qty":24,"price":3.5},{"name":"雪碧","qty":12,"price":3.5}]' \
  --memo "6月补货"
```

**输出**：
```json
{
  "success": true,
  "billNumber": "PXX-20260620-00010",
  "vchcode": "1904436181773954104",
  "total": 126.0,
  "needsConfirm": false,
  "exceptions": []
}
```

**异常处理**：
- `needsConfirm: true` + `exceptions` 含 `NEG_STOCK_ERROR` 表示库存不足等需用户确认的提示，单据已存草稿。
- 加 `--force` 可强制保存（设 needValidation=false）。**慎用**——会绕过业务校验。

**只解析不建单**（推荐先跑确认商品/客户名能匹配）：
```bash
gjp sales create -c 万达超市 --items '[{"name":"可口可乐","qty":1,"price":3.5}]' --dry-run
```

## 库存（stock）

> 待实现。后续会提供：`gjp stock query --warehouse <仓> [--keyword <商品>]`、`gjp stock list` 等。

## 采购（purchase）

> 待实现。结构与销售高度相似（vchtype=Purchase），用 inDetail。

## 报表（report）

> 待实现。进销存报表、利润报表等。

## 使用注意

- **不要随意建测试单**：每次 `sales create` 都会在真实系统产生单据。调试优先用 `--dry-run`。
- **金额**：明细 `price` 为不含税单价，单据总额由 CLI 自动汇总。
- **会话**：`gjp auth whoami` 可调用业务接口验证会话是否真的可用。

## 故障排查

| 现象 | 处理 |
|------|------|
| `无有效 session，且本地无凭据` | 先 `gjp auth login` |
| `未找到仓库/客户/商品 "X"` | 名称不匹配，用 `--dry-run` 看实际能匹配到什么 |
| `登录失败` | 检查公司名/用户名/密码；错误 ≥3 次会要求滑块验证码（CLI 暂不支持，需等冷却） |
| 命令未找到 `gjp` | CLI 未安装，见项目 README |
