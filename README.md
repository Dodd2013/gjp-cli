# gjp-cli

> 通过命令行（以及 AI）操作网上管家婆云进销存系统。纯 TypeScript + Bun 实现，无浏览器依赖。

`gjp` 是一个第三方命令行工具，把[网上管家婆](https://www.mygjp.com.cn/)云进销存（`ngpkj.wsgjp.com.cn`）的 Web 接口封装成可脚本化、可被 AI 调用的 CLI。登录一次后会话本地持久化（5 小时有效，过期自动重登），所有业务命令默认输出 JSON。

---

## ✨ 特性

- 🔐 **纯 HTTP 登录鉴权**：复刻前端 RSA 加密 + 会话管理，无需 Playwright / 浏览器自动化
- 🤖 **AI 友好**：自带 Claude Code Skill，装上后 AI 可直接开单、查库存
- 📦 **会话持久化**：cookie/JWT 落盘，跨进程复用，过期自动重登
- 🧩 **按名称操作**：仓库/客户/商品直接用中文名，CLI 自动解析成系统 ID
- 📋 **JSON 输出**：所有业务命令默认输出结构化 JSON，便于脚本和 AI 解析

## 🧠 工作原理

登录流程通过逆向 `passport.mygjp.com.cn` 前端 JavaScript 还原：

1. 用项目内置的 RSA-1024 公钥（与前端硬编码一致）加密用户名/密码
2. `POST /api/ngpLogin` 拿到 `loginUrl`
3. GET `loginUrl` 换取会话 cookie（`ngp-authorization` JWT + `ngp-router`），有效期 5 小时
4. 会话存到 `~/.gjp/session.json`，后续所有 `/jxc/` 业务接口靠它鉴权

详见 [`docs/API.md`](docs/API.md)（业务接口文档）与 [`CLAUDE.md`](CLAUDE.md)（开发指南）。

## 📋 前置要求

- [Node.js](https://nodejs.org/) 18+ 运行时
- 一个网上管家婆云进销存账号（你自己公司的）

> 💡 仅在**开发/构建**本项目时才需要 [Bun](https://bun.sh/) 1.2+；日常使用 `gjp` 命令只需 Node.js。

## 🚀 安装

### 方式一：npm 全局安装（推荐）

```bash
npm install -g gjp
gjp --version   # 应输出 0.1.0
```

### 方式二：克隆仓库（开发 / 贡献）

```bash
git clone https://github.com/Dodd2013/gjp-cli.git gjp-cli
cd gjp-cli
bun install
bun run build            # 生成 dist/cli.js（Node bundle）
bun link                 # 注册全局命令 gjp（需 Bun）
```

> npm 安装的版本走 Node bundle（`dist/cli.js`）；克隆仓库开发可用 `bun run src/cli.ts` 直接跑源码。

### （可选）安装 Claude Code Skill

让 AI 能自动调用 `gjp` 操作进销存：

```bash
# npm 全局安装的用户：
ln -sf "$(npm root -g)/gjp/skill/gjp" ~/.claude/skills/gjp

# 克隆仓库的用户：
ln -sf "$(pwd)/skill/gjp" ~/.claude/skills/gjp
```

装完后，在任意 Claude Code 会话里说「用管家婆开张销售单给某某客户」，Claude 会自动触发 Skill 调用 `gjp sales create`。

## ⚡ 快速开始

```bash
# 登录（用你自己的账号；密码会掩码输入）
gjp auth login -c <公司名或手机号> -u <用户名>

# 检查会话状态
gjp auth status

# 开一张销售出库单（先 dry-run 确认商品/客户名能匹配）
gjp sales create -c 万达超市 \
  --items '[{"name":"可口可乐","qty":24,"price":3.5},{"name":"雪碧","qty":12,"price":3.5}]' \
  --dry-run

# 确认无误后真正建单
gjp sales create -c 万达超市 \
  --items '[{"name":"可口可乐","qty":24,"price":3.5}]' \
  --memo "6月补货"
```

输出示例：

```json
{
  "success": true,
  "billNumber": "PXX-20260620-00010",
  "vchcode": "1904436181773954104",
  "total": 84.0,
  "needsConfirm": false,
  "exceptions": []
}
```

## 📖 命令参考

### 鉴权 `gjp auth`

| 命令 | 说明 |
|------|------|
| `gjp auth login -c <公司> -u <用户>` | 登录并保存会话/凭据（密码交互输入） |
| `gjp auth status` | 查看会话状态与剩余有效期 |
| `gjp auth refresh` | 强制重新登录 |
| `gjp auth whoami` | 调业务接口验证会话可用 |
| `gjp auth logout` | 清除本地会话与凭据 |

也支持环境变量免交互：`GJP_COMPANY` / `GJP_USER` / `GJP_PASSWORD`。

### 销售 `gjp sales`

```bash
gjp sales create \
  -w <仓库名> \              # 可选，默认第一个仓库
  -c <客户名> \              # 必填
  --items '<JSON明细>' \      # 必填，[{name, qty, price}]
  [--memo 备注] \
  [--date YYYY-MM-DD] \       # 默认今天
  [--force] \                 # 绕过库存不足等需确认的异常
  [--dry-run]                 # 仅解析名称→ID，不建单
```

### 待实现

- 📦 库存盘点（`gjp stock ...`）
- 📊 报表（`gjp report ...`）

> 已实现：销售出库、采购入库/退货/删除、商品 CRUD、往来单位 CRUD、单据中心查询。各命令完整参数与 JSON 输出结构见 [`skill/gjp/SKILL.md`](skill/gjp/SKILL.md) 与 [`CLAUDE.md`](CLAUDE.md)。

## 🤖 给 AI 用（Skill）

本项目自带 [`skill/gjp/SKILL.md`](skill/gjp/SKILL.md)，安装后 Claude Code 会话可自动识别进销存操作意图并调用 `gjp`：

- 用户说「管家婆开单」「查库存」「进销存」等关键词时触发
- AI 会先 `gjp auth status` 检查会话，再执行对应命令
- 默认带 `--dry-run` 谨慎建单，避免在真实系统产生误操作

## 📁 项目结构

```
gjp-cli/
├── bin/gjp.js                     # 全局命令入口
├── src/
│   ├── crypto/                    # RSA 加密 + JWT 解码
│   ├── http/                      # fetch + cookie 会话管理
│   ├── auth/                      # 登录 + 会话复用
│   ├── store/                     # 凭据(0600) + session 持久化
│   ├── api/client.ts              # 业务 API 客户端 + 名称→ID 解析
│   ├── modules/                   # 业务模块（sales / purchase / ...）
│   │   ├── sales.ts
│   │   └── templates/             # HAR 提炼的单据模板
│   └── cli.ts                     # citty 命令入口
├── skill/gjp/SKILL.md             # Claude Code Skill（配套分发）
├── docs/
│   ├── API.md                     # 业务接口文档（逆向整理）
│   └── implementation-plan.html   # 方案网页
├── CLAUDE.md                      # 开发指南 + 工作方法论
└── README.md
```

## 🛠️ 扩展开发（贡献新模块）

本项目采用固定四步工作流，每接一个新业务（采购/库存/报表）都走一遍：

```
HAR 抓包 ─jq 提取─▶ docs/API.md ─封装─▶ src/modules/*.ts + cli.ts ─登记─▶ skill/gjp/SKILL.md
```

1. **HAR → API 文档**：用浏览器在系统里操作一遍并导出 HAR，用 [`CLAUDE.md`](CLAUDE.md) 里的标准 `jq` 命令提取接口，追加到 `docs/API.md`
2. **API → CLI**：业务模块统一用 `getAuthenticatedClient()` 取已认证 client，封装成 `gjp <module> <action>`
3. **CLI → Skill**：把新命令登记进 `skill/gjp/SKILL.md` 对应章节

完整方法论、关键经验（如单据明细行用 HAR 模板克隆、CONFIRM 异常处理）都写在 [`CLAUDE.md`](CLAUDE.md)。

## 🔒 安全

- 凭据明文存于 `~/.gjp/credentials.json`，权限 `0600`（仅当前用户可读），与 aws-cli / git credential 一致
- 会话存于 `~/.gjp/session.json`
- 也可用环境变量 `GJP_COMPANY` / `GJP_USER` / `GJP_PASSWORD` 完全避免落盘
- **不要**把 `~/.gjp/` 提交进 git

## ❓ 常见问题

**Q: 登录提示需要滑块验证码？**
A: 密码错误累计 ≥3 次会触发滑块。CLI 暂不支持自动过滑块，请等待一段时间（或去网页端登录一次重置错误计数）后重试。

**Q: 会话多久过期？**
A: 5 小时。过期后只要有保存的凭据，命令会自动重登，无需手动干预。

**Q: `--force` 是干什么的？**
A: 绕过库存不足等需用户确认的业务异常，强制保存单据。慎用——会跳过业务校验。

**Q: 报"未找到商品 X"？**
A: 名称未精确匹配。先用 `--dry-run` 看 CLI 实际能匹配到哪些商品，再调整名称。

## ⚠️ 免责声明

- 本项目是**第三方非官方**工具，与管家婆及其运营方（成都章鱼侠科技股份有限公司）**无任何关联或授权**。
- 接口通过分析公开的 Web 流量还原，仅供学习与研究使用。
- 工具使用**你自己的账号**操作**你自己的数据**，请确保你有合法权限，并遵守管家婆的服务条款。
- 使用本工具产生的任何后果（账号封禁、数据问题等）由使用者自行承担。
- 如官方提供正式开放 API，请优先使用官方接口。

## 📄 License

MIT（见 [LICENSE](LICENSE)）。使用前请阅读上方免责声明。
