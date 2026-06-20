---
name: gjp
description: 通过 gjp CLI 操作网上管家婆（wsgjp）进销存系统——开销售/采购单、查库存、管商品、管客户/供应商、单据中心查历史单据、查报表等。
  当用户提到「管家婆」「进销存」「开单/开销售单/开采购单」「查库存」「新增商品/建商品」「客户/供应商/往来单位」「查单据/单据中心/历史单据」「出入库」「gjp」等，需要在该系统里做操作时使用。
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

## 商品（product）

### 查商品列表
```bash
gjp product list [-k <关键字>] [-n <条数>]     # 默认 50 条
```

### 查商品详情
```bash
gjp product get --id <商品ID>
```

### 新建商品
```bash
gjp product create \
  -n <商品全名> -c <编号> \      # 必填；编号需唯一，重复报 5001002
  [-u 单位] [--cost 成本价] [--sale 售价] [--retail 零售价] [--standard 规格]
```
例：`gjp product create -n "可口可乐1L" -c KL001 -u 瓶 --cost 3 --sale 5 --standard "1L"`
输出：`{success, id, usercode, message}`。编号重复时 `success:false, message:"商品编号重复"`。

## 客户/供应商（customer）

往来单位（客户、供应商、其它）的新增、查询、停用/启用。

### 查列表
```bash
gjp customer list [-k <关键字>] [-t customer|supplier|all] [-n <条数>] [--include-stopped]
```
`-t customer` 只看客户，`-t supplier` 只看供应商，默认 `all`。

### 查详情（含应收/应付余额）
```bash
gjp customer get --id <往来单位ID>
```

### 新建客户/供应商
```bash
gjp customer create \
  -n <全名> -t <customer|supplier> \   # 必填
  [-c 编号]            # 不传则自动取 max+1
  [-s 简称] [--category 分类名] [--contact 联系人] [--phone 电话] \
  [--area 地区] [--address 详细地址] [--memo 备注]
```
例：
```bash
gjp customer create -n "万达超市" -t customer --phone 13800000000 --contact 王经理
gjp customer create -n "光明批发" -t supplier --contact 李总 --phone 13900000000
```
输出：`{success, id, usercode, message}`。

> 💡 `--phone`/`--contact`/`--area`/`--address`：电话/联系人/地址由 `customer create` 内部自动经 `deliverinfo/batchSave` 保存（会回填客户记录的电话字段），传入即生效。`--area` 格式「省/市/区/街道」。

### 更新已有客户的电话/地址
```bash
gjp customer contact --id <ID> [--phone ...] [--contact ...] [--area ...] [--address ...]
```
例：`gjp customer contact --id 1904... --phone 13800138000 --contact 王经理`
输出：`{success, deliverinfoId, message}`。

### 停用 / 启用
```bash
gjp customer stop   --ids <ID,ID,... 或 JSON数组>
gjp customer enable --ids <ID,ID,... 或 JSON数组>
```
输出：`{success, message:"已停用"|"已启用"}`。

**注意**：
- 新建往来单位会在真实系统产生数据，调试时优先用 `customer list` 确认是否已存在同名单位。
- 客户/供应商的 `priceLevel`、`accType` 等差异由 CLI 按 `-t` 自动处理，无需手填。
- 发货地址（deliverinfo）默认不写；往来单位本身建好即可用于开单。

## 库存（stock）

> 待实现。后续会提供：`gjp stock query --warehouse <仓> [--keyword <商品>]`、`gjp stock list` 等。

## 采购（purchase）

### 开采购入库单

```bash
gjp purchase create \
  -w <仓库名> \              # 可选，默认第一个仓库
  -s <供应商名> \             # 必填
  --items '<JSON明细>' \      # 必填
  [--memo 备注] \
  [--date YYYY-MM-DD] \       # 默认今天
  [--force]                   # confirm:true，绕过「价格为0」等需确认异常
```

`--items` 同销售，每项 `{name, qty, price}`（price 为采购单价）：

```bash
gjp purchase create -s 光明批发 \
  --items '[{"name":"可口可乐","qty":48,"price":2.8},{"name":"雪碧","qty":24,"price":2.8}]'
```

**输出**：与销售同结构 `{success, billNumber, vchcode, total, needsConfirm, exceptions}`，单据号前缀 `CR-`。

**异常处理**（与销售不同）：
- `needsConfirm: true` + `exceptions` 含 `COST_BATCH_ERROR`（价格为0）时，单据已存草稿；加 `--force` 置 `confirm:true` 重提即落库。
- 采购的 `--force` 机制是 `confirm:true`（销售是 `needValidation:false`，二者不同）。

**只解析不建单**：
```bash
gjp purchase create -s 光明批发 --items '[{"name":"可口可乐","qty":1,"price":2.8}]' --dry-run
```

### 删除采购入库单

```bash
gjp purchase delete --bill <CR-单号 或 vchcode> [--force] [--yes]
```

- **二次确认**：默认会列出单据（单号/供应商/金额/日期）并提示 `确认删除? (y/N)`；非交互环境（AI/脚本）须加 `--yes` 显式确认。
- **负库存保护**：若删除会导致库存为负（`NEG_STOCK_ERROR`），会打印受影响商品（当前库存 → 删除后）并要求 `--force` 才能继续；`--force` 还会再确认一次。
- 例：`gjp purchase delete --bill CR-20260620-00008 --yes`
- 输出：`{success, deleted, billNumber, vchcode}`（强制删时多 `forced:true`）。

> ⚠️ 删除是不可逆操作且影响库存/应付。仅能删已过账（postState=800）单据。草稿态单据需在网页端处理。

### 开采购退货单（货退回供应商）

采购入库单的**逆向流程**：参数结构与 `purchase create` 一致，但生成 `CT-` 退货单、扣减库存。

```bash
gjp purchase return \
  -w <仓库名> \              # 可选，默认第一个仓库
  -s <供应商名> \             # 必填
  --items '<JSON明细>' \      # 必填，每项 {name, qty, price}（price 为退货单价）
  [--memo 备注] \
  [--date YYYY-MM-DD] \       # 默认今天
  [--force]                   # confirm:true，绕过「价格为0」等需确认异常
```

```bash
gjp purchase return -s 光明批发 \
  --items '[{"name":"可口可乐","qty":2,"price":2.8}]'
```

**输出**：`{success, billNumber, vchcode, total, needsConfirm, exceptions}`，单据号前缀 `CT-`。

**异常处理**（与 `purchase create` 相同）：`needsConfirm:true` 且 `exceptions` 含 `COST_BATCH_ERROR`（价格为0）时，加 `--force` 置 `confirm:true` 重提即落库。

> ⚠️ 退货会扣减库存、产生应付红冲。优先 `--dry-run` 先核对解析出的商品/数量。CLI 暂无退货单删除命令，调试用的测试退货单需在网页端处理。

## 单据中心（bill）

跨单据类型查历史单据、查业务类型枚举。

### 查单据列表
```bash
gjp bill list \
  [--from YYYY-MM-DD] [--to YYYY-MM-DD] \   # 默认近 7 天
  [-t purchase|sale|stock|finance|all] \    # 默认 all
  [--party <对方单位名>] [--bill <单据号>] \  # 对方/精确单号过滤
  [-n <条数>]                                # 默认 20
```
例：
```bash
gjp bill list                       # 近 7 天所有单据
gjp bill list -t sale -n 10         # 仅销售单
gjp bill list --party 唱起一上       # 某客户的单据
gjp bill list --bill CR-20260620-00001   # 精确查一张（返回 vchcode，可衔接 purchase delete）
```
**输出**：`{total, list:[{billNumber, vchcode, vchtype, businessType, businessTypeName, billType, bfullname, currencyBillTotal, billDate, postTime, memo, summary}]}`。

### 查业务类型枚举（vchtype 字典）
```bash
gjp bill types [--all]    # 默认排除已停用；--all 含全部
```
**输出**：`[{vchtype, name, businessType, businessCode, businessTypeEnum, stoppedInVchtype}]`。用于查「某个 businessType 对应什么单据」「某类单据的 vchtype 码」。

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
