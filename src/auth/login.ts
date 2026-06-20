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

  if (parsed.code !== "200" || !parsed.data?.loginUrl) {
    return { ok: false, message: parsed.message ?? `登录失败 (code=${parsed.code})`, raw: parsed };
  }

  const data = parsed.data;

  // ④ GET loginUrl —— 建立 ngpkj 会话（服务端下发 ngp-authorization + ngp-router cookie）
  await client.request(data.loginUrl);

  // ⑤ 会话定型
  const after = await client.postJson(`${NGPKJ}/jxc/recordsheet/sys/afterLogin`, null, NGPKJ);
  const afterText = await after.text();
  try {
    const aj = JSON.parse(afterText);
    if (aj.code !== "200") {
      return { ok: false, message: `afterLogin 失败: ${afterText.slice(0, 200)}`, raw: parsed };
    }
  } catch {
    return { ok: false, message: `afterLogin 响应异常: ${afterText.slice(0, 200)}`, raw: parsed };
  }

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
