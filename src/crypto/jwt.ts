/** 轻量 JWT 解码（仅取 payload，不做签名校验 —— 我们信任服务端响应，只需读 exp） */

export interface JwtPayload {
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = typeof Buffer !== "undefined"
    ? Buffer.from(b64, "base64").toString("binary")
    : atob(b64);
  // 转 utf8（profile 字段含转义中文）
  return decodeURIComponent(escape(bin));
}

export function decodeJwt(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return {};
  }
}

/** 秒级时间戳。Date.now() 在 Bun/Node 运行时可用（非 workflow 沙箱）。 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
