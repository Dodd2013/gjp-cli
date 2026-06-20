/**
 * 管家婆登录 RSA 加密 — 纯 TS 实现（移植自 passport.mygjp.com.cn/js/RSA.js）
 * 公钥硬编码在前端，已逐行逆向。Bun 1.2 实跑验证通过。
 */

const EXPONENT = 0x10001n;
const MODULUS = BigInt(
  "0x9A568982EE4BF010C38B5195A6F2DC7D66D5E6C02098CF25044CDD031AC08C65" +
    "69D7063BB8959CB3FCB5AF572DE355AFA684AF7187948744E673275B494F394AF" +
    "7F158841CA8B63BF65F185883F8D773A57ED731EDCD1AF2E0E57CD45F5F3CB4EB" +
    "DD38F4A267E5ED02E7B44B93EDFFDADBDC8368019CD496BEC735BAF9E57125",
);

const DIGIT_SIZE = 128; // 1024-bit key → 128 字节/块
const CHUNK_SIZE = DIGIT_SIZE - 11; // 单块明文上限 117 字节

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

function toFixedHex(value: bigint, hexDigits: number): string {
  let hex = value.toString(16);
  while (hex.length < hexDigits) hex = "0" + hex;
  return hex;
}

/** 等价 RSA.js encryptedString(key, s)。用户名需先 encodeURIComponent，密码直接传入。 */
export function rsaEncrypt(plaintext: string): string {
  const chars = Array.from(plaintext).map((c) => c.charCodeAt(0));
  const blocks: string[] = [];

  for (let i = 0; i < chars.length; i += CHUNK_SIZE) {
    const msgLength = Math.min(CHUNK_SIZE, chars.length - i);
    const b = new Array<number>(DIGIT_SIZE).fill(0);

    for (let x = 0; x < msgLength; x++) {
      b[x] = chars[i + msgLength - 1 - x];
    }
    b[msgLength] = 0;
    const paddedSize = Math.max(8, DIGIT_SIZE - 3 - msgLength);
    for (let x = 0; x < paddedSize; x++) {
      b[msgLength + 1 + x] = Math.floor(Math.random() * 254) + 1;
    }
    b[DIGIT_SIZE - 2] = 2;
    b[DIGIT_SIZE - 1] = 0;

    let block = 0n;
    for (let k = 0; k < DIGIT_SIZE; k += 2) {
      const word = BigInt(b[k] + (b[k + 1] << 8));
      block += word << BigInt(k * 8);
    }

    const crypt = modPow(block, EXPONENT, MODULUS);
    blocks.push(toFixedHex(crypt, 256));
  }

  return blocks.join(" ");
}

export const RSA_PUBLIC = { exponent: "010001", modulus: MODULUS.toString(16) };
