/**
 * 往来单位模块（客户/供应商）：查询、新建、停用/启用。
 * 流程见 docs/API.md「往来单位（客户/供应商）」节。
 *
 * 关键事实（来自 客户、供应商.har）：
 * - bcategorys/bcategory/accType 三者联动：[0]/0/0=客户，[1]/1/1=供应商。
 * - btype/save 需要 rowindex，由 basicinfo/getNewRowIndex 取（stargetId 取任意已存在 btype id）。
 * - usercode（编号）需唯一；未传时用 getMaxUsercode+1 推算。
 * - btype/list 用 queryBcategoryList 过滤单位类别：[0]=客户 [1]=供应商 [3]=其它。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JxcClient, ApiError } from "../api/client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const btypeTemplate = JSON.parse(
  readFileSync(join(__dirname, "templates", "btype-save.json"), "utf-8"),
) as Record<string, unknown>;

export type BtypeKind = "customer" | "supplier" | "all";

/** bcategory 索引：0=客户 1=供应商 3=其它 */
const CATEGORY_INDEX = { customer: 0, supplier: 1 } as const;

export interface CreateBtypeInput {
  /** 全名（必填） */
  fullname: string;
  /** customer 或 supplier */
  kind: "customer" | "supplier";
  /** 编号；不传则自动取 max+1 */
  usercode?: string;
  /** 简称，默认取 fullname 前 4 字 */
  shortname?: string;
  /** 所属分类名（不传则归到根分类） */
  category?: string;
  /** 联系人 */
  person?: string;
  /** 电话 */
  tel?: string;
  /** 地区，如「天津/天津市/和平区/劝业场街道」 */
  area?: string;
  /** 详细地址 */
  address?: string;
  /** 备注 */
  memo?: string;
}

export interface BtypeSummary {
  id: string;
  usercode: string;
  fullname: string;
  shortname: string;
  /** 客户 / 供应商 / 其它 */
  type: string;
  tel: string;
  person: string;
  area: string;
  stoped: boolean;
  /** 应收余额 */
  arTotal: number;
  /** 应付余额 */
  apTotal: number;
  priceLevel: number;
  etypeid: string;
  efullname: string;
  createTime: string;
  memo: string;
}

interface RawBtype {
  id: string;
  usercode: string;
  fullname: string;
  shortname?: string;
  bcategorys?: number[];
  accType?: number;
  tel?: string | null;
  person?: string | null;
  area?: string | null;
  registerAddr?: string | null;
  stoped?: boolean;
  arTotal?: number;
  apTotal?: number;
  priceLevel?: number;
  etypeid?: string;
  efullname?: string;
  createTime?: string;
  memo?: string | null;
}

/** 把服务端原始记录压缩成稳定摘要（AI 友好） */
function summarize(b: RawBtype): BtypeSummary {
  const cats = b.bcategorys ?? [];
  const type = cats.includes(0)
    ? "客户"
    : cats.includes(1)
      ? "供应商"
      : "其它";
  return {
    id: b.id,
    usercode: b.usercode,
    fullname: b.fullname,
    shortname: b.shortname ?? b.fullname,
    type,
    tel: b.tel ?? "",
    person: b.person ?? "",
    area: b.area ?? "",
    stoped: !!b.stoped,
    arTotal: Number(b.arTotal ?? 0),
    apTotal: Number(b.apTotal ?? 0),
    priceLevel: Number(b.priceLevel ?? 0),
    etypeid: b.etypeid ?? "",
    efullname: b.efullname ?? "",
    createTime: b.createTime ?? "",
    memo: b.memo ?? "",
  };
}

/** queryBcategoryList 由 kind 推导 */
function categoryList(kind: BtypeKind): number[] {
  if (kind === "customer") return [0];
  if (kind === "supplier") return [1];
  return [0, 1, 3];
}

/** 联系方式/地址输入（经 deliverinfo/batchSave 保存，会回填 btype.tel/person） */
export interface BtypeContactInput {
  /** 电话 → receiverTelephone */
  phone?: string;
  /** 联系人 → receiverPeople */
  contact?: string;
  /** 地区「省/市/区/街道」→ popupArea + province/city/district/street */
  area?: string;
  /** 详细地址 → receiverAddress */
  address?: string;
}

/** 把「省/市/区/街道」拆成结构化地区字段 */
function parseArea(area: string): {
  popupArea: string;
  province: string;
  city: string;
  district: string;
  street: string;
} {
  const parts = (area ?? "").split("/").map((s) => s.trim());
  return {
    popupArea: area ?? "",
    province: parts[0] ?? "",
    city: parts[1] ?? "",
    district: parts[2] ?? "",
    street: parts[3] ?? "",
  };
}

/**
 * 保存/更新往来单位的发货联系方式（电话/联系人/地址）。
 * 关键：电话与地址**不**经 btype/save 持久化，而是经此接口；成功后服务端回填 btype.tel/person。
 * 更新场景会先取已有 deliverinfo 行保留其 id。
 */
async function saveDeliverinfo(
  api: JxcClient,
  btypeId: string,
  c: BtypeContactInput,
): Promise<string | undefined> {
  // 取已有 deliverinfo 行（更新时保留 id；新建时无）
  const existing = await api.call<{ list: Record<string, unknown>[] }>(
    "baseinfo/btype/deliverinfo/pageList",
    { queryParams: { btypeid: btypeId } },
  );
  const prev = (existing.list ?? [])[0];
  const area = parseArea(c.area ?? "");

  // 更新：展开已有行（保留 id/deliveryinfoId，原地覆盖）；新建：prev 为空。
  // dynamicButtons/popupArea 在两种场景都带上（与 HAR 一致）。
  const item: Record<string, unknown> = {
    ...(prev ?? {}),
    dynamicButtons: "公司地址=bicon-kucun,增加行=aicon-zengjia",
    defaulted: prev?.defaulted ?? true,
    defaultedSender: prev?.defaultedSender ?? false,
    companyAddress: prev?.companyAddress ?? true,
    deliveryTypeList: prev?.deliveryTypeList ?? [0, 2],
    deliverytype: prev?.deliverytype ?? null,
    btypeId,
    receiverPeople: c.contact ?? (prev?.receiverPeople as string) ?? "",
    receiverTelephone: c.phone ?? (prev?.receiverTelephone as string) ?? "",
    receiverCellphone: prev?.receiverCellphone ?? "",
    receiverZipcode: prev?.receiverZipcode ?? "",
    popupArea: c.area != null ? area.popupArea : (prev?.popupArea as string) ?? "",
    receiverAddress: c.address ?? (prev?.receiverAddress as string) ?? "",
    province: c.area != null ? area.province : (prev?.province as string) ?? "",
    city: c.area != null ? area.city : (prev?.city as string) ?? "",
    district: c.area != null ? area.district : (prev?.district as string) ?? "",
    street: c.area != null ? area.street : (prev?.street as string) ?? "",
    modified: true,
  };

  const data = await api.call<Record<string, string>>("baseinfo/btype/deliverinfo/batchSave", [item]);
  // 响应 data 形如 {"0": "<deliverId>"}
  return data ? (Object.values(data)[0] as string) : undefined;
}

/** 查客户/供应商列表 */
export async function listBtypes(
  keyword = "",
  kind: BtypeKind = "all",
  pageSize = 50,
  includeStopped = false,
): Promise<BtypeSummary[]> {
  const api = new JxcClient();
  await api.init();
  const data = await api.call<{ list: RawBtype[]; total: string }>(
    "baseinfo/btype/list",
    {
      refresh: true,
      queryParams: {
        filterkey: keyword ? "quick" : "",
        filtervalue: keyword,
        partypeid: "00000",
        btypetype: "nofreight",
        priceLevel: null,
        stoped: includeStopped ? null : false,
        hasClass: true,
        queryBcategoryList: categoryList(kind),
        ignoreDeliveryinfo: true,
      },
      pageSize,
      pageIndex: 1,
      sorts: null,
      orders: null,
      first: 0,
      count: pageSize,
    },
  );
  return (data.list ?? []).map(summarize);
}

/** 按 ID 查往来单位详情（btype/get，入参为纯字符串 ID；返回含 tel/memo 等完整字段） */
export async function getBtype(id: string): Promise<BtypeSummary> {
  const api = new JxcClient();
  await api.init();
  const data = await api.call<RawBtype>("baseinfo/btype/get", id);
  if (!data?.id) throw new ApiError(`未找到往来单位 id="${id}"`, "NOT_FOUND");
  return summarize(data);
}

/** 取一个已存在 btype id 作为 getNewRowIndex 的 stargetId（rowindex 排序锚点） */
async function pickStargetId(api: JxcClient): Promise<string> {
  const data = await api.call<{ list: { id: string }[] }>("baseinfo/btype/list", {
    refresh: true,
    queryParams: {
      filterkey: "",
      filtervalue: "",
      partypeid: "00000",
      btypetype: "nofreight",
      priceLevel: null,
      stoped: null,
      hasClass: true,
      queryBcategoryList: [0, 1, 3],
      ignoreDeliveryinfo: true,
    },
    pageSize: 1,
    pageIndex: 1,
    first: 0,
    count: 1,
  });
  return (data.list ?? [])[0]?.id ?? "0";
}

/** 解析分类名 → {parid, parfullname, partypeid} */
async function resolveCategory(
  api: JxcClient,
  name: string,
): Promise<{ parid: string; parfullname: string; partypeid: string }> {
  const tree = await api.call<{ treeNodeDto?: unknown; list?: { typeid: string; fullname: string; id: string }[] }>(
    "baseinfo/basicinfo/class/list",
    { partypeid: null, typeids: null, basicname: "Btype" },
  );
  // class/list 返回结构可能是 {treeNodeDto/list}；线性化收集所有节点
  const nodes: { typeid: string; fullname: string; id: string }[] = [];
  const stack: unknown[] = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if (typeof obj.typeid === "string" && typeof obj.fullname === "string") {
        nodes.push({ typeid: obj.typeid, fullname: obj.fullname, id: String(obj.id ?? "") });
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) stack.push(...v);
        else if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  const hit = nodes.find((c) => c.fullname === name);
  if (!hit) throw new ApiError(`未找到往来单位分类"${name}"`, "NOT_FOUND");
  return { parid: hit.id, parfullname: hit.fullname, partypeid: hit.typeid };
}

/** 新建客户/供应商 */
export async function createBtype(
  input: CreateBtypeInput,
): Promise<{ success: boolean; id?: string; usercode?: string; message?: string; raw?: unknown }> {
  const api = new JxcClient();
  await api.init();

  // 1. 编号：未传则 max+1
  let usercode = input.usercode;
  if (!usercode) {
    const max = await api.call<string>("baseinfo/basicinfo/getMaxUsercode", {
      filterStr: "",
      queryType: "Usercode",
      basicInfoName: "Btype",
    });
    const next = Number(max ?? 0) + 1;
    usercode = String(next);
  }

  // 2. 分类
  const cat = input.category ? await resolveCategory(api, input.category) : null;

  // 3. rowindex
  const stargetId = await pickStargetId(api);
  const rowindex = await api.call<string>("baseinfo/basicinfo/getNewRowIndex", {
    stargetId,
    basicName: "Btype",
  });

  // 4. 类别相关字段
  const isSupplier = input.kind === "supplier";
  const bcat = isSupplier ? CATEGORY_INDEX.supplier : CATEGORY_INDEX.customer;

  // 5. 克隆模板，覆盖动态字段
  const payload = JSON.parse(JSON.stringify(btypeTemplate)) as Record<string, unknown>;
  payload.fullname = input.fullname;
  payload.shortname = input.shortname ?? input.fullname.slice(0, 4);
  payload.namepy = ""; // 服务端生成拼音
  payload.usercode = usercode;
  payload.bcategorys = [bcat];
  payload.bcategory = bcat;
  payload.accType = bcat;
  payload.priceLevel = isSupplier ? 0 : "1";
  payload.etypeid = api.employeeId;
  payload.efullname = ""; // 业务员姓名，空值由服务端容错
  payload.tel = input.tel ?? "";
  payload.person = input.person ?? "";
  payload.area = input.area ?? "";
  payload.registerAddr = input.address ?? input.area ?? "";
  payload.memo = input.memo ?? "";
  payload.rowindex = rowindex ?? "0";
  payload.partypeid = cat?.partypeid ?? "00000";
  payload.parid = cat?.parid ?? null;
  payload.parfullname = cat?.parfullname ?? "";

  // 6. 提交（保留完整响应以区分错误码）
  const res = await api.client.postJson(
    "https://ngpkj.wsgjp.com.cn/jxc/baseinfo/btype/save",
    payload,
    "https://ngpkj.wsgjp.com.cn",
  );
  const json = (await res.json()) as { code?: string; message?: string; data?: unknown };
  const ok = json.code === "200";
  const id = typeof json.data === "string" ? json.data : undefined;

  // 7. 电话/联系人/地址经 deliverinfo 保存（会回填 btype.tel/person）
  let deliverinfoId: string | undefined;
  const hasContact = !!(input.tel || input.person || input.area || input.address);
  if (ok && id && hasContact) {
    try {
      deliverinfoId = await saveDeliverinfo(api, id, {
        phone: input.tel,
        contact: input.person,
        area: input.area,
        address: input.address,
      });
    } catch (e) {
      // 联系方式保存失败不影响客户本体（已建好），把错误带回去
      return {
        success: true,
        id,
        usercode,
        message: `客户已创建，但联系方式保存失败：${e instanceof Error ? e.message : String(e)}`,
        raw: json.data,
      };
    }
  }

  return {
    success: ok,
    id,
    usercode,
    deliverinfoId,
    message: ok ? "创建成功" : json.message,
    raw: json.data,
  };
}

/** 更新已有往来单位的联系方式/地址（电话/联系人/地址经 deliverinfo 保存，回填 btype.tel/person） */
export async function updateBtypeContact(
  id: string,
  contact: BtypeContactInput,
): Promise<{ success: boolean; deliverinfoId?: string; message?: string }> {
  const api = new JxcClient();
  await api.init();
  const deliverinfoId = await saveDeliverinfo(api, id, contact);
  return { success: true, deliverinfoId, message: "联系方式已更新" };
}

/** 批量停用/启用 */
export async function setBtypeStopped(
  ids: string[],
  stoped: boolean,
): Promise<{ success: boolean; message?: string }> {
  const api = new JxcClient();
  await api.init();
  await api.call("baseinfo/btype/batchStoped", { ids, stoped, freighted: false });
  return { success: true, message: stoped ? "已停用" : "已启用" };
}
