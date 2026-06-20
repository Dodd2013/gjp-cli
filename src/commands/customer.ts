/**
 * 往来单位（客户/供应商）模块命令：list / get / create / contact / stop / enable。
 */
import { defineCommand } from "citty";
import {
  listBtypes,
  getBtype,
  createBtype,
  setBtypeStopped,
  updateBtypeContact,
  type BtypeKind,
} from "../modules/customer.ts";
import { output, die, parseIds } from "./shared.ts";

const customerList = defineCommand({
  meta: { name: "list", description: "查询客户/供应商列表" },
  args: {
    keyword: { type: "string", description: "按名称/编号搜索", alias: "k" },
    type: { type: "string", description: "customer | supplier | all（默认 all）", alias: "t" },
    size: { type: "string", description: "返回条数，默认 50", alias: "n" },
    "include-stopped": { type: "boolean", description: "包含已停用的单位" },
  },
  async run({ args }) {
    const kind = (args.type as BtypeKind) ?? "all";
    if (!["customer", "supplier", "all"].includes(kind)) {
      die("--type 只能是 customer | supplier | all");
    }
    const list = await listBtypes(
      (args.keyword as string) ?? "",
      kind,
      Number(args.size ?? 50),
      !!args["include-stopped"],
    );
    output(list);
  },
});

const customerGet = defineCommand({
  meta: { name: "get", description: "按 ID 查往来单位详情（应收/应付余额等）" },
  args: { id: { type: "string", description: "往来单位 ID", required: true } },
  async run({ args }) {
    const info = await getBtype(args.id as string);
    output(info);
  },
});

const customerCreate = defineCommand({
  meta: { name: "create", description: "新建客户或供应商" },
  args: {
    name: { type: "string", description: "全名（必填）", alias: "n", required: true },
    type: { type: "string", description: "customer | supplier（必填）", alias: "t", required: true },
    code: { type: "string", description: "编号；不传则自动取 max+1", alias: "c" },
    shortname: { type: "string", description: "简称，默认取全名前 4 字", alias: "s" },
    category: { type: "string", description: "所属分类名（需已存在）" },
    contact: { type: "string", description: "联系人" },
    phone: { type: "string", description: "电话" },
    area: { type: "string", description: "地区，如「天津/天津市/和平区」" },
    address: { type: "string", description: "详细地址" },
    memo: { type: "string", description: "备注" },
  },
  async run({ args }) {
    const kind = args.type as "customer" | "supplier";
    if (!["customer", "supplier"].includes(kind)) die("--type 只能是 customer | supplier");
    const result = await createBtype({
      fullname: args.name as string,
      kind,
      usercode: args.code as string | undefined,
      shortname: args.shortname as string | undefined,
      category: args.category as string | undefined,
      person: args.contact as string | undefined,
      tel: args.phone as string | undefined,
      area: args.area as string | undefined,
      address: args.address as string | undefined,
      memo: args.memo as string | undefined,
    });
    output(result);
    if (!result.success) process.exit(1);
  },
});

const customerStop = defineCommand({
  meta: { name: "stop", description: "停用客户/供应商（支持多个 ID）" },
  args: { ids: { type: "string", description: "ID 列表，逗号分隔或 JSON 数组", required: true } },
  async run({ args }) {
    const ids = parseIds(args.ids as string);
    if (ids.length === 0) die("--ids 不能为空");
    output(await setBtypeStopped(ids, true));
  },
});

const customerEnable = defineCommand({
  meta: { name: "enable", description: "启用客户/供应商（支持多个 ID）" },
  args: { ids: { type: "string", description: "ID 列表，逗号分隔或 JSON 数组", required: true } },
  async run({ args }) {
    const ids = parseIds(args.ids as string);
    if (ids.length === 0) die("--ids 不能为空");
    output(await setBtypeStopped(ids, false));
  },
});

const customerContact = defineCommand({
  meta: { name: "contact", description: "更新已有客户/供应商的电话/联系人/地址" },
  args: {
    id: { type: "string", description: "往来单位 ID（必填）", required: true },
    phone: { type: "string", description: "电话" },
    contact: { type: "string", description: "联系人" },
    area: { type: "string", description: "地区，如「天津/天津市/和平区/劝业场街道」" },
    address: { type: "string", description: "详细地址" },
  },
  async run({ args }) {
    if (!args.phone && !args.contact && !args.area && !args.address) {
      die("至少指定 --phone/--contact/--area/--address 之一");
    }
    const result = await updateBtypeContact(args.id as string, {
      phone: args.phone as string | undefined,
      contact: args.contact as string | undefined,
      area: args.area as string | undefined,
      address: args.address as string | undefined,
    });
    output(result);
    if (!result.success) process.exit(1);
  },
});

export const customerGroup = defineCommand({
  meta: { name: "customer", description: "往来单位（客户/供应商）模块" },
  subCommands: {
    list: customerList,
    get: customerGet,
    create: customerCreate,
    contact: customerContact,
    stop: customerStop,
    enable: customerEnable,
  },
});
