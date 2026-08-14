import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { rsaEncrypt } from "../crypto/rsa.ts";
import { HttpClient } from "../http/cookieJar.ts";
import { saveSession, type SessionFile } from "../store/session.ts";

const PASSPORT = "https://passport.mygjp.com.cn";
const NGPKJ = "https://ngpkj.wsgjp.com.cn";

export interface LoginParams {
  company: string;
  username: string;
  password: string;
}

export interface LoginResult {
  ok: boolean;
  message: string;
  /** 登录成功时附带持久化后的 session */
  session?: SessionFile;
  /** 错误次数（≥3 触发滑块验证码） */
  raw?: unknown;
}

interface LoginUserEntry {
  companyName?: string;
  /** 产品账套 ID（接口原始字段名即为 produtId） */
  produtId?: number;
  productName?: string;
  /** 选择账套所需的临时票据 */
  sign?: string;
}

interface LoginResponseData {
  loginUrl?: string;
  post?: boolean;
  arguments?: Record<string, string>;
  productId?: number;
  profileId?: string;
  employeeId?: string;
  crmProductId?: number;
  userName?: string;
  companyName?: string;
  /** 同一账号下存在多个产品账套时返回 */
  loginUsers?: LoginUserEntry[];
}

/**
 * 读取用户固定的账套偏好（~/.gjp/product-id），与 GJP_PRODUCT_ID 环境变量二选一。
 */
function loadPreferredProductId(): number | null {
  if (process.env.GJP_PRODUCT_ID) return parseInt(process.env.GJP_PRODUCT_ID, 10);
  try {
    const raw = readFileSync(join(homedir(), ".gjp", "product-id"), "utf-8").trim();
    if (raw) return parseInt(raw, 10);
  } catch { /* ignore */ }
  return null;
}

/** 记录本次实际登录的 API 域名（loginUrl 所在 host），供后续业务调用使用 */
function saveApiBase(loginUrl: string): void {
  try {
    const origin = new URL(loginUrl).origin;
    mkdirSync(join(homedir(), ".gjp"), { recursive: true });
    writeFileSync(join(homedir(), ".gjp", "api-base"), origin);
  } catch { /* ignore */ }
}

/**
 * 完整登录流程（纯 HTTP，空指纹，已验证可用）：
 * 1. 加密凭据（RSA-1024）
 * 2. POST /api/ngpLogin
 * 3. GET loginUrl 换取 ngpkj 会话 cookie（ngp-authorization JWT + ngp-router）
 * 4. POST /jxc/recordsheet/sys/afterLogin 定型会话
 * 5. 持久化 session
 */
export async function login(params: LoginParams, client = new HttpClient()): Promise<LoginResult> {
  const { company, username, password } = params;

  // ① 加密
  const userNameEnc = rsaEncrypt(encodeURIComponent(username));
  const passwordEnc = rsaEncrypt(password);

  // ② 预热（拿 acw_tc 等基础 cookie）
  await client.request(`${PASSPORT}/erp/ngploginNew`);

  // ③ 核心登录 —— 指纹字段留空（已验证可行）
  const loginBody = {
    userName: userNameEnc,
    password: passwordEnc,
    companyName: company,
    validateCode: "",
    validateId: "",
    deviceId: "",
    ati: "",
    pati: "",
    https: true,
    loginType: null,
  };

  const loginRes = await client.postJson(`${PASSPORT}/api/ngpLogin`, loginBody, PASSPORT);
  const loginText = await loginRes.text();

  let parsed: { code?: string; message?: string; data?: LoginResponseData };
  try {
    parsed = JSON.parse(loginText);
  } catch {
    return { ok: false, message: `登录响应解析失败 (HTTP ${loginRes.status}): ${loginText.slice(0, 200)}` };
  }

  if (parsed.code !== "200") {
    return { ok: false, message: parsed.message ?? `登录失败 (code=${parsed.code})`, raw: parsed };
  }

  let data = parsed.data;

  // 多账套场景：ngpLogin 不直接返回 loginUrl，而是返回 loginUsers 列表，
  // 需要用选中条目的 sign 调 /api/loginByProfileId 二次登录换取 loginUrl。
  if (!data?.loginUrl && Array.isArray(data?.loginUsers) && data.loginUsers.length > 0) {
    const users = data.loginUsers;
    const wanted = loadPreferredProductId();
    const chosen = (wanted && users.find((u) => u.produtId === wanted)) || users[0];
    if (users.length > 1) {
      const others = users
        .filter((u) => u !== chosen)
        .map((u) => `${u.productName} (produtId=${u.produtId})`)
        .join("; ");
      console.warn(
        `ℹ️ 该账号有 ${users.length} 个产品账套，已选择: ${chosen.productName} (produtId=${chosen.produtId})。` +
          `其他: ${others}。可通过环境变量 GJP_PRODUCT_ID 或 ~/.gjp/product-id 指定`,
      );
    }

    const r2 = await client.postJson(
      `${PASSPORT}/api/loginByProfileId`,
      {
        token: chosen.sign,
        mobile: "",
        companyName: chosen.companyName,
        userName: null,
        productId: parseInt(String(chosen.produtId), 10),
        validateCode: NaN,
        deviceId: "",
        https: true,
        ati: "",
        pati: "",
        wi: null,
      },
      PASSPORT,
    );
    const t2 = await r2.text();
    let j2: { code?: string; message?: string; data?: LoginResponseData };
    try {
      j2 = JSON.parse(t2);
    } catch {
      return { ok: false, message: `loginByProfileId 响应解析失败 (HTTP ${r2.status}): ${t2.slice(0, 200)}`, raw: parsed };
    }
    if (j2.code !== "200" || !j2.data?.loginUrl) {
      return { ok: false, message: j2.message ?? `loginByProfileId 失败 (code=${j2.code})`, raw: j2 };
    }
    data = j2.data;
  }

  if (!data?.loginUrl) {
    return { ok: false, message: parsed.message ?? `登录失败 (code=${parsed.code})`, raw: parsed };
  }

  // ④ GET loginUrl —— 建立 ngpkj 会话（服务端下发 ngp-authorization + ngp-router cookie）
  await client.request(data.loginUrl);

  // ⑤ 会话定型（必须在 loginUrl 实际域名上调用，跨域调用会被 302 到登录页）
  const apiBase = new URL(data.loginUrl).origin;
  const after = await client.postJson(`${apiBase}/jxc/recordsheet/sys/afterLogin`, null, apiBase);
  const afterText = await after.text();
  try {
    const aj = JSON.parse(afterText);
    if (aj.code !== "200") {
      return { ok: false, message: `afterLogin 失败: ${afterText.slice(0, 200)}`, raw: parsed };
    }
  } catch {
    return { ok: false, message: `afterLogin 响应异常: ${afterText.slice(0, 200)}`, raw: parsed };
  }

  // ⑤.5 记录实际 API 域名（部分账套部署在独立集群，如 ngpd5kj.wsgjp.com.cn）
  saveApiBase(data.loginUrl);

  // ⑥ 持久化 session（取 arguments.ngp-authorization 作为有效期依据 + 备份）
  const authorization = data.arguments?.["ngp-authorization"];
  const session = await saveSession(client, {
    company,
    username,
    productId: data.productId,
    profileId: data.profileId,
    employeeId: data.employeeId,
  }, authorization);

  return {
    ok: true,
    message: "登录成功",
    session,
    raw: parsed,
  };
}

/**
 * 取一个已认证的 HttpClient：优先复用本地 session，过期则自动重登。
 * 业务模块统一通过此函数获取 client。
 */
export async function getAuthenticatedClient(): Promise<{
  client: HttpClient;
  session: SessionFile;
  refreshed: boolean;
}> {
  const { loadSessionFile, isSessionValid, restoreClient } = await import("../store/session.ts");
  const { loadCredentials } = await import("../store/credentials.ts");

  const existing = loadSessionFile();
  if (isSessionValid(existing)) {
    return { client: await restoreClient(existing!), session: existing!, refreshed: false };
  }

  // session 失效 → 用本地凭据重登
  const cred = loadCredentials();
  if (!cred) {
    throw new Error("无有效 session，且本地无凭据。请先运行: gjp auth login");
  }
  const result = await login(cred);
  if (!result.ok || !result.session) {
    throw new Error(`自动重登失败: ${result.message}`);
  }
  return { client: await restoreClient(result.session), session: result.session, refreshed: true };
}
