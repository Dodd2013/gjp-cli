import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { CREDENTIALS_FILE, GJP_DIR } from "./paths.ts";

export interface Credentials {
  company: string;
  username: string;
  password: string;
  /** 记录是否用户授权本地保存（首次 login 时 --save 置位） */
  savedAt?: number;
}

/**
 * 凭据落盘（0600 权限，仅当前用户可读）。
 * 安全说明：与 aws-cli（~/.aws/credentials）、kubectl、git credential 等本地 CLI 一致。
 * 如需更高安全：用环境变量 GJP_COMPANY / GJP_USER / GJP_PASSWORD，则不落盘。
 */
function ensureDir(): void {
  if (!existsSync(GJP_DIR)) mkdirSync(GJP_DIR, { recursive: true, mode: 0o700 });
}

export function saveCredentials(cred: Credentials): void {
  ensureDir();
  const payload: Credentials = { ...cred, savedAt: Math.floor(Date.now() / 1000) };
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600); // 显式收紧，防止 umask 不严
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) {
    // 回退：环境变量
    const { GJP_COMPANY, GJP_USER, GJP_PASSWORD } = process.env;
    if (GJP_COMPANY && GJP_USER && GJP_PASSWORD) {
      return { company: GJP_COMPANY, username: GJP_USER, password: GJP_PASSWORD };
    }
    return null;
  }
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function deleteCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) unlinkSync(CREDENTIALS_FILE);
}

/** 校验凭据文件权限是否为 0600（诊断用） */
export function credentialsPermission(): string {
  if (!existsSync(CREDENTIALS_FILE)) return "absent";
  const mode = statSync(CREDENTIALS_FILE).mode & 0o777;
  return mode.toString(8).padStart(3, "0");
}
