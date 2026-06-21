/**
 * 业务 API 客户端层：封装 /jxc 调用 + 名称→ID 解析。
 * 所有业务模块通过此层访问系统，不直接碰 HttpClient/会话。
 */
import { getAuthenticatedClient } from "../auth/login.ts";

const NGPKJ = "https://ngpkj.wsgjp.com.cn";
const jxc = (p: string) => `${NGPKJ}/jxc/${p}`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ResolvedProduct {
  ptypeId: string;
  skuId: string;
  unitId: string;
  fullname: string;
  usercode: string;
  shortname: string;
}

export class JxcClient {
  private client!: Awaited<ReturnType<typeof getAuthenticatedClient>>["client"];
  private session!: Awaited<ReturnType<typeof getAuthenticatedClient>>["session"];

  /** 懒加载已认证 client（自动复用/刷新会话） */
  async init(): Promise<void> {
    const { client, session } = await getAuthenticatedClient();
    this.client = client;
    this.session = session;
  }

  get profileId(): string {
    return this.session.meta.profileId!;
  }
  get employeeId(): string {
    return this.session.meta.employeeId!;
  }

  /** 通用 POST，校验 code==="200"，返回 data */
  async call<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.client.postJson(jxc(path), body, NGPKJ);
    const text = await res.text();
    let json: { code?: string; message?: string; traceId?: string; data?: T };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(`响应非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, "PARSE_ERROR");
    }
    if (json.code !== "200") {
      throw new ApiError(json.message ?? `接口失败 code=${json.code}`, json.code ?? "UNKNOWN", json.traceId);
    }
    return json.data as T;
  }

  /** 与 call 类似，但返回完整响应（含 exceptionInfo/resultType），供写接口判断 */
  async callRaw(path: string, body: unknown) {
    const res = await this.client.postJson(jxc(path), body, NGPKJ);
    const text = await res.text();
    const json = JSON.parse(text);
    return { status: res.status, json };
  }

  // ===== 名称 → ID 解析 =====

  /** 仓库名 → {id, name} */
  async resolveWarehouse(name: string): Promise<{ id: string; name: string }> {
    const data = await this.call<{ list: { id: string; fullname?: string; name?: string }[] }>(
      "baseinfo/ktype/pagelist",
      {
        pageSize: 200, pageIndex: 1,
        queryParams: { scategory: "0,2", isshowclass: false, isshowstop: false, stoped: false, stockStates: "0", stockTypes: "0,1,2", showadd: true, selectedAddedInfo: true },
      },
    );
    const list = data.list ?? [];
    const hit = name ? list.find((k) => (k.fullname ?? k.name) === name) : undefined;
    const picked = hit ?? list[0];
    if (!picked) throw new ApiError(`未找到仓库${name ? `"${name}"` : ""}`, "NOT_FOUND");
    return { id: picked.id, name: picked.fullname ?? picked.name ?? "" };
  }

  /** 客户/供应商名 → {id, name} */
  async resolveCustomer(name: string): Promise<{ id: string; name: string }> {
    const data = await this.call<{ list: { id: string; fullname?: string; name?: string }[] }>(
      "baseinfo/btype/list",
      {
        refresh: true,
        queryParams: { filterkey: "quick", filtervalue: name, bcategory: 0, stoped: false, btypetype: "nofreight", labelFieldList: [], labelIdList: [], containLine: false, ignoreDeliveryinfo: true },
        pageSize: 20, pageIndex: 1,
      },
    );
    const list = data.list ?? [];
    const exact = list.find((b) => (b.fullname ?? b.name) === name);
    const picked = exact ?? list[0];
    if (!picked) throw new ApiError(`未找到客户"${name}"`, "NOT_FOUND");
    return { id: picked.id, name: picked.fullname ?? picked.name ?? "" };
  }

  /** 供应商名 → {id, name}（bcategory:1 过滤供应商） */
  async resolveSupplier(name: string): Promise<{ id: string; name: string }> {
    const data = await this.call<{ list: { id: string; fullname?: string; name?: string }[] }>(
      "baseinfo/btype/list",
      {
        refresh: true,
        queryParams: { filterkey: "quick", filtervalue: name, bcategory: 1, cooperationType: "null", stoped: false, btypetype: "nofreight", labelFieldList: [], labelIdList: [], containLine: false, ignoreDeliveryinfo: true },
        pageSize: 20, pageIndex: 1,
      },
    );
    const list = data.list ?? [];
    const exact = list.find((b) => (b.fullname ?? b.name) === name);
    const picked = exact ?? list[0];
    if (!picked) throw new ApiError(`未找到供应商"${name}"`, "NOT_FOUND");
    return { id: picked.id, name: picked.fullname ?? picked.name ?? "" };
  }

  /** 往来单位名 → {id, name}（不限客户/供应商，单据中心按对方查用） */
  async resolveBtype(name: string): Promise<{ id: string; name: string }> {
    const data = await this.call<{ list: { id: string; fullname?: string; name?: string }[] }>(
      "baseinfo/btype/list",
      {
        refresh: true,
        queryParams: { filterkey: "quick", filtervalue: name, partypeid: "00000", btypetype: "nofreight", priceLevel: null, stoped: null, hasClass: true, queryBcategoryList: [0, 1, 3], ignoreDeliveryinfo: true },
        pageSize: 20, pageIndex: 1,
      },
    );
    const list = data.list ?? [];
    const exact = list.find((b) => (b.fullname ?? b.name) === name);
    const picked = exact ?? list[0];
    if (!picked) throw new ApiError(`未找到往来单位"${name}"`, "NOT_FOUND");
    return { id: picked.id, name: picked.fullname ?? picked.name ?? "" };
  }

  /** 商品名 → ptypeId（在指定仓库范围内搜索） */
  async resolveProduct(name: string, warehouseId?: string): Promise<{ id: string; fullname: string; usercode: string }> {
    const data = await this.call<{ list: { id: string; fullname: string; usercode: string; shortname?: string }[] }>(
      "recordsheet/ptype/baselist",
      {
        pageSize: 50, pageIndex: 1,
        queryParams: { filterkey: "quick", filtervalue: name, stoped: false, ktypeId: warehouseId, pcategories: [0, 1, 3, 4, 2], showXcodes: true },
      },
    );
    const list = data.list ?? [];
    const exact = list.find((p) => p.fullname === name);
    const picked = exact ?? list[0];
    if (!picked) throw new ApiError(`未找到商品"${name}"`, "NOT_FOUND");
    return picked;
  }

  /** 资金账户名（现金/银行存款…）→ {id, fullname, usercode}（走 baseinfo/atype/pagelist） */
  async resolveAccount(name: string): Promise<{ id: string; fullname: string; usercode: string }> {
    const data = await this.call<{ list: { id: string; fullname: string; usercode: string }[] }>(
      "baseinfo/atype/pagelist",
      {
        refresh: true,
        queryParams: { currentPage: 1, filterKey: "quick", filterValue: name, showClass: false, stoped: false, typeId: null, parTypeId: "00001" },
        pageSize: 50, pageIndex: 1,
      },
    );
    const list = data.list ?? [];
    const exact = list.find((a) => a.fullname === name);
    const picked = exact ?? list[0];
    if (!picked) throw new ApiError(`未找到资金账户"${name}"`, "NOT_FOUND");
    return { id: picked.id, fullname: picked.fullname, usercode: picked.usercode };
  }

  /** 商品 → {skuId, unitId}（先取单位再取 SKU） */
  async resolveSku(ptypeId: string): Promise<{ skuId: string; unitId: string }> {
    const unitsData = await this.call<Record<string, { id: string; unitName: string }[]>>(
      "baseinfo/ptype/unit/ptypeiddic",
      [ptypeId],
    );
    const unit = (unitsData[ptypeId] ?? [])[0];
    if (!unit) throw new ApiError(`商品 ${ptypeId} 无单位信息`, "NOT_FOUND");

    const skuData = await this.call<{ id: string; unitId: string }[]>(
      "recordsheet/ptype/getBatchPtypeSku",
      { skuList: [{ ptypeId, unitId: unit.id }] },
    );
    const sku = (Array.isArray(skuData) ? skuData : [skuData])[0];
    if (!sku?.id) throw new ApiError(`商品 ${ptypeId} 无 SKU 信息`, "NOT_FOUND");
    return { skuId: sku.id, unitId: unit.id };
  }
}
