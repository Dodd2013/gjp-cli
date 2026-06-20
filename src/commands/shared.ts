/**
 * CLI 命令层共享工具：统一输出、报错退出、参数解析。
 * 所有 commands/*.ts 通过这里消除重复样板。
 */

/** 统一 JSON 输出（业务命令默认输出格式） */
export function output(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

/** 报错并退出：die("缺少客户名 --customer") → `✗ 缺少客户名 --customer` + exit(1) */
export function die(msg: string, code = 1): never {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

/** 解析 --items JSON 为非空数组；缺失/非法/空数组直接 die */
export function parseItems<T>(raw: string | undefined, label = "--items"): T[] {
  if (!raw) die(`缺少商品明细 ${label}`);
  let items: T[];
  try {
    items = JSON.parse(raw);
  } catch {
    die(`${label} 不是合法 JSON`);
  }
  if (!Array.isArray(items) || items.length === 0) {
    die(`${label} 必须是非空数组`);
  }
  return items;
}

/** 解析 ID 列表：逗号分隔 或 JSON 字符串数组 */
export function parseIds(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) throw new Error("not array");
      return arr.map(String);
    } catch {
      die("--ids 若为 JSON 必须是字符串数组");
    }
  }
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 命令行参数解析，回退到 GJP_<NAME> 环境变量 */
export function parseArg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback ?? process.env[`GJP_${name.toUpperCase()}`];
}
