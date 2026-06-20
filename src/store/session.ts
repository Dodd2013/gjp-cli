import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { SerializedCookieJar } from "tough-cookie";
import { SESSION_FILE, GJP_DIR } from "./paths.ts";
import { HttpClient } from "../http/cookieJar.ts";
import { decodeJwt, nowSec } from "../crypto/jwt.ts";

export interface SessionMeta {
  company: string;
  username: string;
  productId?: number;
  profileId?: string;
  employeeId?: string;
  /** JWT exp（秒）—— 会话过期判断依据 */
  expiresAt: number;
  /** 登录时间（秒） */
  loggedAt: number;
}

export interface SessionFile {
  meta: SessionMeta;
  jar: SerializedCookieJar;
  /** ngp-authorization JWT 原文（ngpkj 业务接口鉴权核心） */
  authorization?: string;
}

function ensureDir(): void {
  if (!existsSync(GJP_DIR)) mkdirSync(GJP_DIR, { recursive: true, mode: 0o700 });
}

export function saveSession(client: HttpClient, meta: Omit<SessionMeta, "expiresAt" | "loggedAt">, authorization?: string): Promise<SessionFile> {
  ensureDir();
  return client.serializeJar().then((jar) => {
    // 优先用 JWT exp；无则保守给 1 小时
    const expiresAt = authorization ? (decodeJwt(authorization).exp ?? nowSec() + 3600) : nowSec() + 3600;
    const file: SessionFile = {
      meta: { ...meta, expiresAt, loggedAt: nowSec() },
      jar,
      authorization,
    };
    writeFileSync(SESSION_FILE, JSON.stringify(file), { mode: 0o600 });
    return file;
  });
}

export function loadSessionFile(): SessionFile | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as SessionFile;
  } catch {
    return null;
  }
}

export function isSessionValid(file: SessionFile | null, skewSec = 60): boolean {
  if (!file) return false;
  return file.meta.expiresAt - nowSec() > skewSec;
}

export function deleteSession(): void {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}

/** 从 session 还原一个带历史 cookie 的 HttpClient */
export async function restoreClient(file: SessionFile): Promise<HttpClient> {
  return HttpClient.fromSerialized(file.jar, "https://ngpkj.wsgjp.com.cn");
}

/** 人类可读的剩余有效期 */
export function formatRemaining(file: SessionFile): string {
  const remain = file.meta.expiresAt - nowSec();
  if (remain <= 0) return "已过期";
  const h = Math.floor(remain / 3600);
  const m = Math.floor((remain % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
}
