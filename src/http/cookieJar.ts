import { CookieJar, type SerializedCookieJar } from "tough-cookie";

/**
 * HTTP 客户端：封装 fetch + tough-cookie 会话管理 + 手动重定向（保住每跳的 Set-Cookie）。
 * Bun 的 fetch 默认不维护 cookie，且自动重定向会丢失 Set-Cookie，故手动处理。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export class HttpClient {
  readonly jar: CookieJar;
  readonly defaultOrigin: string;

  constructor(opts: { jar?: CookieJar; defaultOrigin?: string } = {}) {
    this.jar = opts.jar ?? new CookieJar();
    this.defaultOrigin = opts.defaultOrigin ?? "https://passport.mygjp.com.cn";
  }

  /** 序列化整个 cookie jar，供 session 落盘 */
  async serializeJar(): Promise<SerializedCookieJar> {
    return new Promise((resolve, reject) => {
      this.jar.serialize((err, data) => (err ? reject(err) : resolve(data as SerializedCookieJar)));
    });
  }

  /** 从序列化数据恢复一个 HttpClient（带历史 cookie） */
  static async fromSerialized(
    data: SerializedCookieJar,
    defaultOrigin = "https://passport.mygjp.com.cn",
  ): Promise<HttpClient> {
    const jar = await CookieJar.deserialize(data);
    return new HttpClient({ jar, defaultOrigin });
  }

  /** 读取某 URL 当前应携带的 Cookie 头 */
  private async cookieHeader(url: string): Promise<string> {
    return (await this.jar.getCookieString(url)) || "";
  }

  /** 从响应写入 Set-Cookie */
  private async storeCookies(url: string, res: Response): Promise<void> {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
      await this.jar.setCookie(c, url);
    }
  }

  async request(
    url: string,
    opts: {
      method?: "GET" | "POST";
      body?: unknown;
      headers?: Record<string, string>;
      origin?: string;
    } = {},
  ): Promise<Response> {
    const { method = "GET", body, headers = {}, origin } = opts;
    const cookie = await this.cookieHeader(url);

    const finalHeaders: Record<string, string> = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9",
      Accept: "*/*",
      Cookie: cookie,
      ...headers,
    };

    let res = await fetch(url, {
      method,
      headers: finalHeaders,
      body:
        body !== undefined
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined,
      redirect: "manual", // 手动跟跳，逐跳存 cookie
    });

    await this.storeCookies(url, res);

    // 手动跟随 302/301，最多 8 跳，全程携带并保存 cookie
    let hops = 0;
    while ([301, 302, 303, 307, 308].includes(res.status) && hops < 8) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, url).href;
      const c2 = await this.cookieHeader(next);
      res = await fetch(next, {
        method: "GET",
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", Accept: "*/*", Cookie: c2 },
        redirect: "manual",
      });
      await this.storeCookies(next, res);
      hops++;
    }

    return res;
  }

  async postJson(url: string, body: unknown, origin?: string): Promise<Response> {
    return this.request(url, {
      method: "POST",
      body,
      origin,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(origin ? { Origin: origin, Referer: origin + "/" } : {}),
      },
    });
  }

  /** 调试用：打印当前 jar 中所有 cookie */
  async dumpCookies(): Promise<void> {
    const store = (this.jar as unknown as { getAllCookies: () => Promise<unknown[]> })
      .store ? (this.jar as unknown as { store: { getAllCookies: (cb: (err: unknown, c: unknown[]) => void) => void } }).store : null;
  }
}
