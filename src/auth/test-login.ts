/**
 * P0 验证：用真实账号测试登录，先试 Tier ① 空指纹。
 * 目标：确认 fingerprint 字段是否必须，拿到会话 cookie。
 */
import { rsaEncrypt } from "../crypto/rsa.ts";
import { HttpClient } from "../http/cookieJar.ts";

const COMPANY = "01292178";
const USERNAME = "管理员";
const PASSWORD = "wzlg25@1";

const PASSPORT = "https://passport.mygjp.com.cn";
const NGPKJ = "https://ngpkj.wsgjp.com.cn";

function log(emoji: string, msg: string) {
  console.log(`${emoji} ${msg}`);
}

async function dumpJar(client: HttpClient, urls: string[]) {
  for (const u of urls) {
    const cs = await client.jar.getCookies(u);
    if (cs.length) {
      console.log(`   [cookies ${new URL(u).host}]`);
      for (const c of cs) {
        const v = String(c).length > 60 ? String(c).slice(0, 60) + "…" : String(c);
        console.log(`     ${v}`);
      }
    }
  }
}

async function main() {
  const client = new HttpClient();

  // ① 加密凭据
  log("🔐", "加密凭据…");
  const userNameEnc = rsaEncrypt(encodeURIComponent(USERNAME));
  const passwordEnc = rsaEncrypt(PASSWORD);
  log("✓", `userName 密文 ${userNameEnc.length} hex, password 密文 ${passwordEnc.length} hex`);

  // ② 预热：GET 登录页（拿初始 cookie，如 _ati）
  log("🌐", "预热登录页 passport.mygjp.com.cn/erp/ngploginNew …");
  const preWarm = await client.request(`${PASSPORT}/erp/ngploginNew`, {});
  log("  ", `预热响应 ${preWarm.status}`);
  await dumpJar(client, [PASSPORT, `${PASSPORT}/erp/ngploginNew`]);

  // ③ 核心登录 —— Tier ① 指纹全留空
  log("🚀", "POST /api/ngpLogin（Tier①空指纹）…");
  const loginBody = {
    userName: userNameEnc,
    password: passwordEnc,
    companyName: COMPANY,
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
  log("📥", `登录响应 HTTP ${loginRes.status}`);
  console.log("   响应头:");
  loginRes.headers.forEach((v, k) => {
    if (k.toLowerCase().startsWith("set-cookie") || k.toLowerCase() === "location" || k.toLowerCase() === "content-type")
      console.log(`     ${k}: ${v.slice(0, 100)}`);
  });
  console.log("   响应体:");
  try {
    const j = JSON.parse(loginText);
    console.log("   " + JSON.stringify(j, null, 2).split("\n").join("\n   ").slice(0, 2000));
  } catch {
    console.log("   " + loginText.slice(0, 800));
  }

  await dumpJar(client, [PASSPORT]);

  // ④ 解析登录响应，取 loginUrl（前端 redirect() 在 post=false 时直接 GET 它建立会话）
  const loginJson = JSON.parse(loginText);
  const data = loginJson?.data ?? {};
  const loginUrl: string = data.loginUrl ?? "";
  log("📋", `code=${loginJson.code} post=${data.post} productId=${data.productId} profileId=${data.profileId}`);

  if (loginUrl) {
    log("🔀", `GET loginUrl 建立 ngpkj 会话: ${loginUrl.slice(0, 95)}…`);
    const redir = await client.request(loginUrl, {});
    log("  ", `跳转响应最终 ${redir.status}`);
    await dumpJar(client, [NGPKJ, `${NGPKJ}/main.html`]);

    // 注：logininfo/encodedLoginInfo cookie 是前端 UI 展示用，含原始 JSON 会污染请求头，且 API 鉴权不需要，故跳过。
    // 会话已由 ngp-authorization + ngp-router cookie 建立。

    log("🧩", "POST /jxc/recordsheet/sys/afterLogin …");
    const after = await client.postJson(`${NGPKJ}/jxc/recordsheet/sys/afterLogin`, null, NGPKJ);
    const afterText = await after.text();
    log("📥", `afterLogin HTTP ${after.status}: ${afterText.slice(0, 200)}`);
    await dumpJar(client, [NGPKJ]);

    // ⑤ 探针：调真实业务接口验证会话是否生效
    log("🔎", "探针: POST /jxc/recordsheet/accBusinessType/list …");
    const probe = await client.postJson(
      `${NGPKJ}/jxc/recordsheet/accBusinessType/list`,
      { vchtypeEnum: "Sale", intVchtypeList: null, query: true },
      NGPKJ,
    );
    const probeText = await probe.text();
    log("📥", `探针 HTTP ${probe.status}: ${probeText.slice(0, 400)}`);
  }

  log("🏁", "P0 验证完成");
}

main().catch((e) => {
  console.error("💥 异常:", e);
  process.exit(1);
});
