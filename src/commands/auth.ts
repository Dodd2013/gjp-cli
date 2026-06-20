/**
 * 鉴权与会话管理命令：login / status / refresh / logout / whoami。
 */
import { defineCommand } from "citty";
import { login } from "../auth/login.ts";
import {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  credentialsPermission,
} from "../store/credentials.ts";
import {
  loadSessionFile,
  isSessionValid,
  deleteSession,
  formatRemaining,
  restoreClient,
} from "../store/session.ts";
import { readPassword } from "../prompt.ts";
import { die, parseArg } from "./shared.ts";

const NGPKJ = "https://ngpkj.wsgjp.com.cn";

export const authLogin = defineCommand({
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
    if (!company || !username) {
      const saved = loadCredentials();
      if (saved && !company) console.log(`ℹ️ 使用已保存凭据: 公司 ${saved.company}, 用户 ${saved.username}`);
    }

    const finalCompany = company ?? loadCredentials()?.company;
    const finalUser = username ?? loadCredentials()?.username;
    if (!finalCompany || !finalUser) {
      die("缺少公司名或用户名。用法: gjp auth login --company 01292178 --user 管理员");
    }
    if (!password) password = await readPassword("密码: ");
    if (!password) die("密码不能为空");

    console.log(`🔐 登录中（公司: ${finalCompany}, 用户: ${finalUser}）…`);
    const result = await login({ company: finalCompany, username: finalUser, password });
    if (!result.ok || !result.session) die(result.message);

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

export const authStatus = defineCommand({
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

export const authRefresh = defineCommand({
  meta: { name: "refresh", description: "强制重新登录" },
  async run() {
    const cred = loadCredentials();
    if (!cred) die("本地无凭据，无法自动刷新。请带参数运行: gjp auth login");
    console.log("🔄 重新登录…");
    const result = await login(cred);
    if (!result.ok || !result.session) die(result.message);
    console.log(`✅ 刷新成功，有效期: ${formatRemaining(result.session)}`);
  },
});

export const authLogout = defineCommand({
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

export const authWhoami = defineCommand({
  meta: { name: "whoami", description: "用当前会话调用业务接口验证身份" },
  async run() {
    const file = loadSessionFile();
    if (!isSessionValid(file)) die("无有效会话，请先登录");
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

export const authGroup = defineCommand({
  meta: { name: "auth", description: "鉴权与会话管理" },
  subCommands: {
    login: authLogin,
    status: authStatus,
    refresh: authRefresh,
    logout: authLogout,
    whoami: authWhoami,
  },
});
