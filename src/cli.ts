#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { login } from "./auth/login.ts";
import {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  credentialsPermission,
  type Credentials,
} from "./store/credentials.ts";
import {
  loadSessionFile,
  isSessionValid,
  deleteSession,
  formatRemaining,
  restoreClient,
} from "./store/session.ts";
import { readPassword } from "./prompt.ts";
import { createSale, type SaleItemInput } from "./modules/sales.ts";
import { createPurchase, type PurchaseItemInput } from "./modules/purchase.ts";
import { listProducts, getProduct, createProduct } from "./modules/product.ts";
import { listBtypes, getBtype, createBtype, setBtypeStopped, updateBtypeContact, type BtypeKind } from "./modules/customer.ts";

const NGPKJ = "https://ngpkj.wsgjp.com.cn";

function parseArg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback ?? process.env[`GJP_${name.toUpperCase()}`];
}

const authLogin = defineCommand({
  meta: { name: "login", description: "登录并保存会话" },
  args: {
    company: { type: "string", description: "公司名/账号", alias: "c" },
    user: { type: "string", description: "用户名", alias: "u" },
    password: { type: "string", description: "密码（建议留空交互输入）", alias: "p" },
    save: { type: "boolean", description: "凭据一并落盘（默认 true，便于自动刷新）", default: true },
    "no-save": { type: "boolean", description: "不保存凭据，仅保存本次会话" },
  },
  async run({ args }) {
    const company = (args.company as string) ?? parseArg("company");
    const username = (args.user as string) ?? parseArg("user");
    let password = (args.password as string) ?? parseArg("password");

    // 回退到已保存凭据
    if ((!company || !username) ) {
      const saved = loadCredentials();
      if (saved && !company) console.log(`ℹ️ 使用已保存凭据: 公司 ${saved.company}, 用户 ${saved.username}`);
    }

    const finalCompany = company ?? loadCredentials()?.company;
    const finalUser = username ?? loadCredentials()?.username;
    if (!finalCompany || !finalUser) {
      console.error("✗ 缺少公司名或用户名。用法: gjp auth login --company 01292178 --user 管理员");
      process.exit(1);
    }
    if (!password) password = await readPassword("密码: ");
    if (!password) {
      console.error("✗ 密码不能为空");
      process.exit(1);
    }

    console.log(`🔐 登录中（公司: ${finalCompany}, 用户: ${finalUser}）…`);
    const result = await login({ company: finalCompany, username: finalUser, password });
    if (!result.ok || !result.session) {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }

    const wantSave = args["no-save"] ? false : (args.save as boolean);
    if (wantSave) {
      saveCredentials({ company: finalCompany, username: finalUser, password });
      console.log(`💾 凭据已保存（权限 ${credentialsPermission()}）：~/.gjp/credentials.json`);
    }
    console.log(`✅ ${result.message}`);
    console.log(`   会话有效期: ${formatRemaining(result.session)}`);
    console.log(`   productId=${result.session.meta.productId} profileId=${result.session.meta.profileId}`);
  },
});

const authStatus = defineCommand({
  meta: { name: "status", description: "查看会话状态" },
  async run() {
    const file = loadSessionFile();
    if (!file) {
      console.log("⚪ 无本地会话。请先运行: gjp auth login");
      return;
    }
    const valid = isSessionValid(file);
    console.log(`${valid ? "✅ 会话有效" : "🔴 会话已过期"}`);
    console.log(`   公司: ${file.meta.company}`);
    console.log(`   用户: ${file.meta.username}`);
    console.log(`   登录时间: ${new Date(file.meta.loggedAt * 1000).toLocaleString("zh-CN")}`);
    console.log(`   过期时间: ${new Date(file.meta.expiresAt * 1000).toLocaleString("zh-CN")}`);
    console.log(`   剩余有效期: ${formatRemaining(file)}`);
    console.log(`   productId=${file.meta.productId} profileId=${file.meta.profileId}`);
  },
});

const authRefresh = defineCommand({
  meta: { name: "refresh", description: "强制重新登录" },
  async run() {
    const cred = loadCredentials();
    if (!cred) {
      console.error("✗ 本地无凭据，无法自动刷新。请带参数运行: gjp auth login");
      process.exit(1);
    }
    console.log("🔄 重新登录…");
    const result = await login(cred);
    if (!result.ok || !result.session) {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
    console.log(`✅ 刷新成功，有效期: ${formatRemaining(result.session)}`);
  },
});

const authLogout = defineCommand({
  meta: { name: "logout", description: "清除本地会话与凭据" },
  args: {
    keep: { type: "boolean", description: "仅清除会话，保留凭据" },
  },
  run({ args }) {
    deleteSession();
    console.log("🧹 已清除本地会话");
    if (!args.keep) {
      deleteCredentials();
      console.log("🧹 已清除本地凭据");
    }
  },
});

const authWhoami = defineCommand({
  meta: { name: "whoami", description: "用当前会话调用业务接口验证身份" },
  async run() {
    const file = loadSessionFile();
    if (!isSessionValid(file)) {
      console.error("✗ 无有效会话，请先登录");
      process.exit(1);
    }
    const client = await restoreClient(file!);
    const res = await client.postJson(
      `${NGPKJ}/jxc/recordsheet/accBusinessType/list`,
      { vchtypeEnum: "Sale", intVchtypeList: null, query: true },
      NGPKJ,
    );
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      console.log(`✅ 会话可用，HTTP ${res.status}, 业务类型 ${j.data?.length ?? 0} 条`);
    } catch {
      console.log(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  },
});

const authGroup = defineCommand({
  meta: { name: "auth", description: "鉴权与会话管理" },
  subCommands: {
    login: authLogin,
    status: authStatus,
    refresh: authRefresh,
    logout: authLogout,
    whoami: authWhoami,
  },
});

// ===== 销售模块 =====

const salesCreate = defineCommand({
  meta: { name: "create", description: "创建销售出库单" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    customer: { type: "string", description: "客户名（必填）", alias: "c" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":1,"price":9.2}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（忽略库存不足等需确认的异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.customer) {
      console.error("✗ 缺少客户名 --customer");
      process.exit(1);
    }
    if (!args.items) {
      console.error('✗ 缺少商品明细 --items，例: --items \'[{"name":"测试商品001","qty":1,"price":9.2}]\'');
      process.exit(1);
    }
    let items: SaleItemInput[];
    try {
      items = JSON.parse(args.items as string);
    } catch {
      console.error("✗ --items 不是合法 JSON");
      process.exit(1);
    }
    if (!Array.isArray(items) || items.length === 0) {
      console.error("✗ --items 必须是非空数组");
      process.exit(1);
    }

    if (args["dry-run"]) {
      const { JxcClient } = await import("./api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const c = await api.resolveCustomer(args.customer as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const s = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...s };
        }),
      );
      console.log(JSON.stringify({ warehouse: w, customer: c, items: resolved }, null, 2));
      return;
    }

    const result = await createSale(
      {
        warehouse: args.warehouse as string | undefined,
        customer: args.customer as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  },
});

const salesGroup = defineCommand({
  meta: { name: "sales", description: "销售模块" },
  subCommands: { create: salesCreate },
});

// ===== 采购模块 =====

const purchaseCreate = defineCommand({
  meta: { name: "create", description: "创建采购入库单" },
  args: {
    warehouse: { type: "string", description: "仓库名（默认第一个）", alias: "w" },
    supplier: { type: "string", description: "供应商名（必填）", alias: "s" },
    items: { type: "string", description: '商品明细 JSON，如 [{"name":"测试商品001","qty":10,"price":3.5}]', alias: "i" },
    memo: { type: "string", description: "备注" },
    summary: { type: "string", description: "摘要" },
    date: { type: "string", description: "单据日期 YYYY-MM-DD（默认今天）" },
    force: { type: "boolean", description: "强制保存（confirm:true，绕过「价格为0」等需确认异常）" },
    "dry-run": { type: "boolean", description: "仅解析名称→ID，不真正建单" },
  },
  async run({ args }) {
    if (!args.supplier) {
      console.error("✗ 缺少供应商名 --supplier");
      process.exit(1);
    }
    if (!args.items) {
      console.error('✗ 缺少商品明细 --items，例: --items \'[{"name":"测试商品001","qty":10,"price":3.5}]\'');
      process.exit(1);
    }
    let items: PurchaseItemInput[];
    try {
      items = JSON.parse(args.items as string);
    } catch {
      console.error("✗ --items 不是合法 JSON");
      process.exit(1);
    }
    if (!Array.isArray(items) || items.length === 0) {
      console.error("✗ --items 必须是非空数组");
      process.exit(1);
    }

    if (args["dry-run"]) {
      const { JxcClient } = await import("./api/client.ts");
      const api = new JxcClient();
      await api.init();
      const w = await api.resolveWarehouse((args.warehouse as string) ?? "");
      const s = await api.resolveSupplier(args.supplier as string);
      const resolved = await Promise.all(
        items.map(async (it) => {
          const p = await api.resolveProduct(it.name, w.id);
          const sk = await api.resolveSku(p.id);
          return { name: it.name, qty: it.qty, price: it.price, ptypeId: p.id, ...sk };
        }),
      );
      console.log(JSON.stringify({ warehouse: w, supplier: s, items: resolved }, null, 2));
      return;
    }

    const result = await createPurchase(
      {
        warehouse: args.warehouse as string | undefined,
        supplier: args.supplier as string,
        items,
        memo: args.memo as string | undefined,
        summary: args.summary as string | undefined,
        date: args.date as string | undefined,
      },
      { force: !!args.force },
    );

    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  },
});

const purchaseGroup = defineCommand({
  meta: { name: "purchase", description: "采购模块" },
  subCommands: { create: purchaseCreate },
});

// ===== 商品模块 =====

const productList = defineCommand({
  meta: { name: "list", description: "查询商品列表" },
  args: {
    keyword: { type: "string", description: "搜索关键字（商品名/编码）", alias: "k" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
  },
  async run({ args }) {
    const list = await listProducts((args.keyword as string) ?? "", Number(args.size ?? 50));
    console.log(JSON.stringify(list, null, 2));
  },
});

const productGet = defineCommand({
  meta: { name: "get", description: "按 ID 查商品详情" },
  args: { id: { type: "string", description: "商品 ID", required: true } },
  async run({ args }) {
    const info = await getProduct(args.id as string);
    console.log(JSON.stringify(info, null, 2));
  },
});

const productCreate = defineCommand({
  meta: { name: "create", description: "新建商品" },
  args: {
    name: { type: "string", description: "商品全名", alias: "n", required: true },
    code: { type: "string", description: "商品编号（需唯一）", alias: "c", required: true },
    unit: { type: "string", description: "单位，默认'个'", alias: "u" },
    cost: { type: "string", description: "成本价（进价）" },
    sale: { type: "string", description: "售价（批发价1）" },
    retail: { type: "string", description: "零售价" },
    standard: { type: "string", description: "规格" },
  },
  async run({ args }) {
    const result = await createProduct({
      name: args.name as string,
      code: args.code as string,
      unit: args.unit as string | undefined,
      costPrice: args.cost != null ? Number(args.cost) : undefined,
      salePrice: args.sale != null ? Number(args.sale) : undefined,
      retailPrice: args.retail != null ? Number(args.retail) : undefined,
      standard: args.standard as string | undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  },
});

const productGroup = defineCommand({
  meta: { name: "product", description: "商品模块" },
  subCommands: { list: productList, get: productGet, create: productCreate },
});

// ===== 往来单位（客户/供应商）模块 =====

function parseIds(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) throw new Error("not array");
      return arr.map(String);
    } catch {
      console.error("✗ --ids 若为 JSON 必须是字符串数组");
      process.exit(1);
    }
  }
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

const customerList = defineCommand({
  meta: { name: "list", description: "查询客户/供应商列表" },
  args: {
    keyword: { type: "string", description: "按名称/编号搜索", alias: "k" },
    type: { type: "string", description: "customer | supplier | all（默认 all）", alias: "t" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
    "include-stopped": { type: "boolean", description: "包含已停用的单位" },
  },
  async run({ args }) {
    const kind = (args.type as BtypeKind) ?? "all";
    if (!["customer", "supplier", "all"].includes(kind)) {
      console.error("✗ --type 只能是 customer | supplier | all");
      process.exit(1);
    }
    const list = await listBtypes(
      (args.keyword as string) ?? "",
      kind,
      Number(args.size ?? 50),
      !!args["include-stopped"],
    );
    console.log(JSON.stringify(list, null, 2));
  },
});

const customerGet = defineCommand({
  meta: { name: "get", description: "按 ID 查往来单位详情（应收/应付余额等）" },
  args: { id: { type: "string", description: "往来单位 ID", required: true } },
  async run({ args }) {
    const info = await getBtype(args.id as string);
    console.log(JSON.stringify(info, null, 2));
  },
});

const customerCreate = defineCommand({
  meta: { name: "create", description: "新建客户或供应商" },
  args: {
    name: { type: "string", description: "全名（必填）", alias: "n", required: true },
    type: { type: "string", description: "customer | supplier（必填）", alias: "t", required: true },
    code: { type: "string", description: "编号；不传则自动取 max+1", alias: "c" },
    shortname: { type: "string", description: "简称，默认取全名前 4 字", alias: "s" },
    category: { type: "string", description: "所属分类名（需已存在）" },
    contact: { type: "string", description: "联系人" },
    phone: { type: "string", description: "电话" },
    area: { type: "string", description: "地区，如「天津/天津市/和平区」" },
    address: { type: "string", description: "详细地址" },
    memo: { type: "string", description: "备注" },
  },
  async run({ args }) {
    const kind = args.type as "customer" | "supplier";
    if (!["customer", "supplier"].includes(kind)) {
      console.error("✗ --type 只能是 customer | supplier");
      process.exit(1);
    }
    const result = await createBtype({
      fullname: args.name as string,
      kind,
      usercode: args.code as string | undefined,
      shortname: args.shortname as string | undefined,
      category: args.category as string | undefined,
      person: args.contact as string | undefined,
      tel: args.phone as string | undefined,
      area: args.area as string | undefined,
      address: args.address as string | undefined,
      memo: args.memo as string | undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  },
});

const customerStop = defineCommand({
  meta: { name: "stop", description: "停用客户/供应商（支持多个 ID）" },
  args: { ids: { type: "string", description: "ID 列表，逗号分隔或 JSON 数组", required: true } },
  async run({ args }) {
    const ids = parseIds(args.ids as string);
    if (ids.length === 0) {
      console.error("✗ --ids 不能为空");
      process.exit(1);
    }
    console.log(JSON.stringify(await setBtypeStopped(ids, true), null, 2));
  },
});

const customerEnable = defineCommand({
  meta: { name: "enable", description: "启用客户/供应商（支持多个 ID）" },
  args: { ids: { type: "string", description: "ID 列表，逗号分隔或 JSON 数组", required: true } },
  async run({ args }) {
    const ids = parseIds(args.ids as string);
    if (ids.length === 0) {
      console.error("✗ --ids 不能为空");
      process.exit(1);
    }
    console.log(JSON.stringify(await setBtypeStopped(ids, false), null, 2));
  },
});

const customerContact = defineCommand({
  meta: { name: "contact", description: "更新已有客户/供应商的电话/联系人/地址" },
  args: {
    id: { type: "string", description: "往来单位 ID（必填）", required: true },
    phone: { type: "string", description: "电话" },
    contact: { type: "string", description: "联系人" },
    area: { type: "string", description: "地区，如「天津/天津市/和平区/劝业场街道」" },
    address: { type: "string", description: "详细地址" },
  },
  async run({ args }) {
    if (!args.phone && !args.contact && !args.area && !args.address) {
      console.error("✗ 至少指定 --phone/--contact/--area/--address 之一");
      process.exit(1);
    }
    const result = await updateBtypeContact(args.id as string, {
      phone: args.phone as string | undefined,
      contact: args.contact as string | undefined,
      area: args.area as string | undefined,
      address: args.address as string | undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  },
});

const customerGroup = defineCommand({
  meta: { name: "customer", description: "往来单位（客户/供应商）模块" },
  subCommands: {
    list: customerList,
    get: customerGet,
    create: customerCreate,
    contact: customerContact,
    stop: customerStop,
    enable: customerEnable,
  },
});

const main = defineCommand({
  meta: {
    name: "gjp",
    version: "0.1.0",
    description: "管家婆进销存 CLI — 纯 HTTP，AI 友好",
  },
  subCommands: {
    auth: authGroup,
    sales: salesGroup,
    purchase: purchaseGroup,
    product: productGroup,
    customer: customerGroup,
  },
});

runMain(main);
