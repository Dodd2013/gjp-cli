# CLAUDE.md — 管家婆进销存 CLI 项目

> 本文件是本项目的持久化工作指南。新会话开始时优先阅读此文件。

## 项目目标

把网上管家婆云进销存（`ngpkj.wsgjp.com.cn`）接入 Claude Code：构建一个 TS+Bun 的 CLI，能登录鉴权并执行进销存业务操作（采购/销售/库存/报表等），最终供 AI 调用。

## 技术栈

- **运行时**：Bun 1.2（全局命令 `gjp` 已软链到 `/usr/local/bin/gjp`）
- **语言**：TypeScript（严格，无编译，`bun run` 直接执行 .ts）
- **CLI 框架**：citty
- **HTTP/会话**：原生 `fetch` + tough-cookie（手动跟随重定向以保住 Set-Cookie）
- **加密**：原生 BigInt（RSA-1024），无外部加密库

## 已确立的核心事实（无需重新推导）

1. **登录不需要设备指纹**：`deviceId/ati/pati` 留空即可登录。纯 HTTP，无浏览器依赖。
2. **加密**：RSA-1024，`e=0x10001`，模数硬编码在前端 `passport.mygjp.com.cn/js/RSA.js`。用户名先 `encodeURIComponent` 再加密，密码直接加密，companyName 明文。实现见 `src/crypto/rsa.ts`。
3. **鉴权链**：`POST /api/ngpLogin` → 取 `data.loginUrl` GET 它 → 服务端下发 `ngp-authorization`(JWT) + `ngp-router` cookie → `POST /jxc/recordsheet/sys/afterLogin`。会话 5h 有效。所有 `/jxc/` 接口靠这两个 cookie 鉴权。
4. **统一响应信封**：`{code:"200", message, traceId, data}`。`code!=="200"` 即错误。
5. **业务接口**：全部 `POST https://ngpkj.wsgjp.com.cn/jxc/...`，JSON body，靠 session cookie。已识别的 41 个接口见 `docs/API.md`。

## 目录结构

```
gjp-cli/
├── src/
│   ├── crypto/        rsa.ts(RSA加密) · jwt.ts(解码exp)
│   ├── http/          cookieJar.ts(fetch+会话+序列化)
│   ├── auth/          login.ts(登录+getAuthenticatedClient) · test-login.ts(参考)
│   ├── store/         paths.ts · credentials.ts(0600) · session.ts(持久化+过期检测)
│   ├── modules/       ← 业务模块（按 HAR 逐步新增）：stock.ts purchase.ts sales.ts ...
│   ├── cli.ts         ← citty 入口，命令挂这里
│   └── prompt.ts      掩码密码输入
├── docs/
│   ├── API.md         ← 所有业务接口文档（HAR 提炼，持续扩充）
│   └── implementation-plan.html  方案网页
├── bin/gjp.js         ← 全局命令入口
└── CLAUDE.md          本文件
```

## 工作方法论（核心）

用户提供 HAR → 转成 API 文档 → 转成 CLI 命令 → 登记进 Skill。每个新业务模块走这三步：

### 步骤 1：HAR → API 文档

把 HAR 文件（用户从浏览器导出）解析出业务接口，追加到 `docs/API.md`。

**提取接口的标准命令**（jq，去重 + 请求体 + 响应体样本）：

```bash
cat <HAR文件> | jq -r '
  [ .log.entries[]
    | select(.request.url | contains("ngpkj.wsgjp.com.cn/jxc/"))
    | select(.request.method == "POST")
    | select(.request.postData.text != null)
    | { url: (.request.url | split("?")[0]), body: .request.postData.text,
        resp: (.response.content.text // ""), status: .response.status }
  ]
  | group_by(.url)[]
  | .[0]
  | "## " + .url + "\nHTTP: " + (.status|tostring)
    + "\nREQ:  " + .body
    + "\nRESP: " + (if .resp == "" then "(HAR未捕获)" else (.resp | .[0:400]) end) + "\n"
'
```

**注意点**：
- HAR 可能含 `passport.mygjp.com.cn`（鉴权）和 `ngpkj.wsgjp.com.cn/jxc/`（业务）两类，业务接口才是目标。
- Chrome 导出 HAR 会**剥离 Cookie/Set-Cookie 头**（安全），故接口看似无 token 仍 200，属正常。
- 同一接口在 HAR 里可能多次出现（如多次加密），用 `group_by(.url)` 去重。
- 响应体有时 `content.text` 为 null（响应未存），标注 `(HAR未捕获)`。

**文档写作规范**（保持 `docs/API.md` 风格）：
- 按**业务模块**分组（baseinfo / recordsheet / 商品 / 单据 / 财务…）。
- 高价值接口标 `★`（查/增/改的核心），超核心标 `★★★`（写接口）。
- 请求体给**精简版**（只留关键字段，去掉埋点/UI 字段如 `fee[]`、`__rowIndex` 等）。
- 请求体若是纯字符串（非 JSON）要特别说明（如 `etype/getform` 入参是员工ID字符串）。
- 记录关键枚举（vchtype、businessType、resultType）。
- **记录业务时序**：用户实际操作是几步，接口调用顺序如何（见 API.md 第 5 节示例）。

### 步骤 2：API 文档 → CLI 命令

把文档里的接口封装成 `gjp <module> <action>` 命令。

**业务模块统一通过 `getAuthenticatedClient()` 获取已认证 client**（自动复用 session，过期自动重登）：

```typescript
import { getAuthenticatedClient } from "../auth/login.ts";

export async function doSomething() {
  const { client, session } = await getAuthenticatedClient();
  const res = await client.postJson(
    "https://ngpkj.wsgjp.com.cn/jxc/<module>/<action>",
    { /* 请求体，来自 API.md */ },
    "https://ngpkj.wsgjp.com.cn",
  );
  const j = await res.json();
  if (j.code !== "200") throw new Error(j.message);
  return j.data;
}
```

**命令注册**：在 `src/cli.ts` 的 `main.subCommands` 下加 `<module>` 子命令组，挂 action 命令。

**输出约定**：业务命令**默认输出 JSON**（便于 AI 解析）。人类可读信息用 `--human` 或单独命令。

**写接口的异常处理**：保存类接口可能返回 `resultType: "CONFIRM"`（如 `NEG_STOCK_ERROR` 库存不足），需带确认标记重提。封装时先返回异常让调用方决策，或支持 `--force` 自动确认。

### 步骤 3：CLI 命令 → Skill

本项目是**开源项目，Skill 作为 CLI 的配套产物**一起分发：用户装上 CLI 后，把项目内的 Skill 软链到自己的 `~/.claude/skills/`，任意会话的 Claude 即可调用 `gjp`。

**Skill 位置**：项目内 `skill/gjp/SKILL.md`（随 git 版本化，对用户可见）。

**用户安装 Skill**（写进 README）：
```bash
ln -sf "$(pwd)/skill/gjp" ~/.claude/skills/gjp
```

**Skill 内容要点**：
- `description`（frontmatter）：写清触发场景——用户要做进销存（管家婆/销售/采购/库存/报表/开单）操作时触发。
- **通用版**：不写任何特定账号/测试数据，任何用户装上即用。
- 前置条件：需先 `gjp auth login`（用 `gjp auth status` 检查）。
- 每个模块一段：命令、参数、JSON 输出结构、示例、异常处理。
- 关键提醒：不要随意建测试单（优先 `--dry-run`）；`--force` 会绕过业务校验慎用。
- **每完成一个 CLI 模块就追加对应章节**（保持与新命令同步，否则 Skill 会过时）。未实现的模块写 `> 待实现` 占位。

## 关键约束（来自用户全局规则）

- **不可变**：用展开运算符创建新对象，不原地修改。
- **小文件**：单文件 200-400 行，<800 行。
- **错误处理**：显式处理，不静默吞错。`code!=="200"` 要抛出含 message 的错误。
- **输入校验**：CLI 入参在边界处校验（公司/用户/ID 非空等）。
- **无硬编码密钥**：会话/凭据走 `~/.gjp/`（0600），不进代码。测试账号仅用于验证，不落库进 git。

## 常用命令

```bash
# 跑某个 ts 文件
bun run src/<path>.ts

# CLI（全局已装，任意目录可用）
gjp auth login -c <公司> -u <用户>           # 密码会交互输入
gjp auth status
gjp auth refresh
gjp auth whoami                              # 验证会话+业务接口可用

# 测试
bun test

# 方案文档本地预览
cd docs && python3 -m http.server 8848      # http://localhost:8848/implementation-plan.html
```

## 当前进度（2026-06-20）

- ✅ 鉴权全链路（登录/会话持久化/自动刷新/全局命令）—— 已用真实账号验证
- ✅ `docs/API.md`（已识别接口，含销售出库单/商品/往来单位完整流程）
- ✅ **业务命令 `sales create`** —— 已实测建单成功（单/多商品、--force 绕过库存、总金额计算）
- ✅ **业务命令 `product list/get/create`** —— 已实测（查商品、建商品 CLITEST001 成功，重复编号正确报 5001002）
  - 关键经验：明细行结构复杂（199字段），用 HAR 真实行做模板（`src/modules/templates/`）克隆+覆盖动态字段最稳；手工构造会缺字段导致"明细为空"
  - 新单据初始化：`getBillByVchcode`(copyTypeEnum:DEFAULT) 返回含 vchcode+number 的完整模板，不需单独调 billNumber
  - CONFIRM 异常：`--force` 置 needValidation:false + failedSaveUnconfirmed:true + allowZeroQty:true 可绕过（如 NEG_STOCK_ERROR）
- ✅ **业务命令 `customer list/get/create/contact/stop/enable`**（来自 `客户、供应商.har`）—— **全部实测通过**（建客户/供应商含电话地址、更新联系方式、批量停用、搜索均验过，已清理测试数据）
  - 类别三联动：`bcategorys`/`bcategory`/`accType` = `[0]`/`0`/`0`=客户，`[1]`/`1`/`1`=供应商；`priceLevel` 客户 `"1"`、供应商 `0`
  - 新建需 `rowindex`：`basicinfo/getNewRowIndex({stargetId=任意已存在 btype id, basicName:"Btype"})`，编号未传时 `getMaxUsercode+1`
  - 模板：`src/modules/templates/btype-save.json`（克隆客户 save 体的约 50 字段）
  - 🔑 **电话/联系人/地址经 `deliverinfo/batchSave` 保存（不是 btype/save！）**：`btype/save` 的 tel/person/phone 入参不持久化；浏览器是 save 后再调 deliverinfo，由它回填 btype.tel/person。`customer create --phone/--contact/--area/--address` 和 `customer contact` 都已接入 deliverinfo。`fullname`/编号/类别/`memo` 在 btype/save 直接生效。
  - **详情查 `btype/get`**（入参纯字符串 id）：`customer get` 用它，返回含 tel/memo 等完整字段（比 list 过滤准）。
  - **`customer contact` 原地更新**：先 pageList 取行，带 `id`/`deliveryinfoId` + `dynamicButtons`/`popupArea` + `modified:true` 提交，行数不变（实测保持 1 行）并回填 btype.tel/person。响应 `{"0":id}` 的 id 每次可能变，不代表新增行。
  - 教训：排查新接口字段「存不进去」时，先看 HAR 里 save 前后的**配套调用**（本例 deliverinfo），别急于归因风控/加密——之前因此误判过 TLS 指纹并白做了一轮排查。
  - `btype/save` 成功只返回新 id 字符串
- ✅ **业务命令 `purchase create`**（来自 `采购入库单.har`）—— **全部实测通过**（happy path 建单 + price=0 的 CONFIRM 检测 + `--force`(confirm:true) 落库均验过）
  - vchtype/businessType = **`Buy`**（不是 Purchase！），intVchtype 1000，单据号前缀 `CR-`，明细用 `inDetail`（非 outDetail），btype=供应商（`resolveSupplier` bcategory:1）
  - 与销售同构：`getBillByVchcode{vchtype:"Buy"}` 取模板（含 payment 付款账户），填 inDetail → submitBill
  - 🔑 **CONFIRM 机制不同**：采购的需确认异常（如 `COST_BATCH_ERROR 价格为0`）靠 body 里 **`confirm:true`** 重提解除（销售是 `needValidation:false`+`failedSaveUnconfirmed`+`allowZeroQty`）。`--force` 即置 confirm:true，明细可不变
  - 模板：`src/modules/templates/purchase-indetail-line.json`（196 字段，与 outDetail 共享约 192 字段，差异在 in/outPosition 库位字段）
- ⬜ 待补 HAR 样例：库存盘点 / 报表 / 财务 / 单据列表查询

## 安全说明

凭据当前明文存 `~/.gjp/credentials.json`（0600），与 aws-cli 一致。后续可升级 macOS Keychain 加密。
