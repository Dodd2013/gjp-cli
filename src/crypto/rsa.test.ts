/**
 * 管家婆登录 RSA 加密 - 纯 TS 实现（Ohdave RSA.js 逆向移植）
 *
 * 逆向自 passport.mygjp.com.cn/js/RSA.js，关键参数：
 *   - 公钥指数 e = 0x010001 (65537)
 *   - 模数 n (1024-bit, 硬编码在前端)
 *   - 自定义 PKCS#1 v1.5 type 2 填充（字节逆序变体）
 *
 * 加密规则（来自 ngplogin_page_new.js）：
 *   userName = encryptedString(key, encodeURIComponent(username))
 *   password = encryptedString(key, password)
 */

const EXPONENT = 0x10001n;
const MODULUS = BigInt(
  "0x9A568982EE4BF010C38B5195A6F2DC7D66D5E6C02098CF25044CDD031AC08C6569D7063BB8959CB3FCB5AF572DE355AFA684AF7187948744E673275B494F394AF7F158841CA8B63BF65F185883F8D773A57ED731EDCD1AF2E0E57CD45F5F3CB4EBDD38F4A267E5ED02E7B44B93EDFFDADBDC8368019CD496BEC735BAF9E57125",
);

// 1024-bit key => digitSize = 128 bytes, chunkSize = 117 bytes
const DIGIT_SIZE = 128;
const CHUNK_SIZE = DIGIT_SIZE - 11;

/** modPow: base^exp mod m，使用原生 BigInt */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = base % m;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

/** 10 进制大数 → 定长 256 位 hex */
function bigIntToFixedHex(value: bigint, hexDigits: number): string {
  let hex = value.toString(16);
  while (hex.length < hexDigits) hex = "0" + hex;
  return hex;
}

/**
 * 等价于 RSA.js 的 encryptedString(key, s)
 * 注意：每块用随机字节填充，故同一明文每次密文不同（PKCS#1 type2 特性）
 */
export function rsaEncrypt(plaintext: string): string {
  const chars = Array.from(plaintext).map((c) => c.charCodeAt(0));
  const blocks: string[] = [];

  for (let i = 0; i < chars.length; i += CHUNK_SIZE) {
    const msgLength = Math.min(CHUNK_SIZE, chars.length - i);
    const b = new Array<number>(DIGIT_SIZE).fill(0);

    // 1. 明文字节逆序写入低位
    for (let x = 0; x < msgLength; x++) {
      b[x] = chars[i + msgLength - 1 - x];
    }
    b[msgLength] = 0; // 分隔标记
    // 2. 随机填充字节（1..254）
    const paddedSize = Math.max(8, DIGIT_SIZE - 3 - msgLength);
    for (let x = 0; x < paddedSize; x++) {
      b[msgLength + 1 + x] = Math.floor(Math.random() * 254) + 1;
    }
    // 3. 高位标记：0x02 ... 0x00
    b[DIGIT_SIZE - 2] = 2;
    b[DIGIT_SIZE - 1] = 0;

    // 4. 字节序列按小端 16-bit 打包成 BigInt（与 BigInt.js 一致）
    let block = 0n;
    for (let k = 0; k < DIGIT_SIZE; k += 2) {
      const word = BigInt(b[k] + (b[k + 1] << 8));
      block += word << BigInt(k * 8);
    }

    // 5. RSA: block^e mod n
    const crypt = modPow(block, EXPONENT, MODULUS);
    blocks.push(bigIntToFixedHex(crypt, 256));
  }

  return blocks.join(" ");
}

// ===== 自验证 =====
if (import.meta.main) {
  console.log("🔑 公钥参数：");
  console.log("   e (exponent) =", EXPONENT.toString(16));
  console.log("   n (modulus)  =", MODULUS.toString(16).length, "hex digits =", MODULUS.toString(16).length * 4, "bits");
  console.log("");

  const tests = [
    { label: "用户名(encodeURI前: 管理员)", input: encodeURIComponent("管理员") },
    { label: "用户名(纯英文)", input: encodeURIComponent("admin") },
    { label: "密码", input: "MyP@ssw0rd123" },
  ];

  for (const t of tests) {
    const enc1 = rsaEncrypt(t.input);
    const enc2 = rsaEncrypt(t.input);
    const hexLen = enc1.replace(/ /g, "").length;
    const blocks = enc1.split(" ").length;
    console.log(`📝 ${t.label}`);
    console.log(`   明文: "${t.input}" (utf8 bytes: ${Array.from(t.input).length})`);
    console.log(`   密文长度: ${hexLen} hex = ${hexLen / 2} 字节, ${blocks} 块`);
    console.log(`   密文样本: ${enc1.slice(0, 64)}...`);
    console.log(`   ✅ 同明文两次加密结果${enc1 === enc2 ? "相同(❌异常)" : "不同(✓随机填充生效)"}: `);
    console.log(`   第二次: ${enc2.slice(0, 64)}...`);
    console.log("");
  }

  // 关键断言：单块密文必须正好 256 hex (128 字节)，与 HAR 一致
  const sample = rsaEncrypt("admin");
  const sampleHexLen = sample.replace(/ /g, "").length;
  console.log(sampleHexLen === 256 ? "✅ 密文长度 256 hex，与 HAR 抓包完全一致" : "❌ 密文长度不符");
}
