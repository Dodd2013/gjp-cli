/**
 * 商品模块：查询商品、新建商品。
 * 流程见 docs/API.md「商品管理」节。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JxcClient } from "../api/client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const productTemplate = JSON.parse(
  readFileSync(join(__dirname, "templates", "product-save.json"), "utf-8"),
) as Record<string, unknown>;

export interface CreateProductInput {
  /** 商品全名 */
  name: string;
  /** 商品编号（系统内编码，需唯一；重复会报 5001002） */
  code: string;
  /** 单位名，如"个"/"箱"/"张"，默认"个" */
  unit?: string;
  /** 成本价（进价），默认 0 */
  costPrice?: number;
  /** 售价（批发价1 / preprice1），默认 0 */
  salePrice?: number;
  /** 零售价，默认 0 */
  retailPrice?: number;
  /** 规格 */
  standard?: string;
  /** 简称，默认取 name 前 4 字 */
  shortname?: string;
}

export interface ProductInfo {
  id: string;
  usercode: string;
  fullname: string;
  shortname: string;
  ptypeType: string;
  costPrice: number;
  standard: string;
}

/** 按关键字查商品列表 */
export async function listProducts(keyword = "", pageSize = 50): Promise<unknown[]> {
  const api = new JxcClient();
  await api.init();
  const data = await api.call<{ list: unknown[]; total: string }>(
    "baseinfo/ptype/unitsku/childpagelist",
    {
      refresh: true,
      queryParams: {
        currentPage: 1,
        filterkey: keyword ? "quick" : null,
        filtervalue: keyword,
        fullbarcode: null, xcode: null, existedFullbarcode: null, unitCode: null,
        stoped: 0, ktypeId: null, partypeid: null, lefttypeid: null,
        pcategories: [0, 1, 3, 4], skuStoped: 0, ptypeStoped: 0,
        showSaleFormula: false, onlyUseEnabled: null,
      },
      pageSize,
      pageIndex: 1,
    },
  );
  return data.list ?? [];
}

/** 按 ID 查商品详情 */
export async function getProduct(id: string): Promise<ProductInfo> {
  const api = new JxcClient();
  await api.init();
  return api.call<ProductInfo>("baseinfo/ptype/get", id);
}

/** 新建商品 */
export async function createProduct(input: CreateProductInput): Promise<{ success: boolean; id?: string; usercode?: string; message?: string; raw?: unknown }> {
  const api = new JxcClient();
  await api.init();

  const unit = input.unit ?? "个";
  const costPrice = input.costPrice ?? 0;
  const salePrice = input.salePrice ?? 0;
  const retailPrice = input.retailPrice ?? 0;

  // 克隆模板，覆盖动态字段
  const payload = JSON.parse(JSON.stringify(productTemplate)) as Record<string, unknown>;
  payload.id = 0;
  payload.fullname = input.name;
  payload.invoiceFullname = input.name;
  payload.shortname = input.shortname ?? input.name.slice(0, 4);
  payload.usercode = input.code;
  payload.namepy = ""; // 服务端会生成拼音，留空
  payload.standard = input.standard ?? "";
  payload.costPrice = costPrice;
  payload.ptypeType = "3"; // 3=普通商品

  // 单位 + 价格（units / priceList 两处都要同步）
  const unitObj = { ...(payload.units as unknown[])[0] as Record<string, unknown> };
  unitObj.unitName = unit;
  unitObj.buyPrice = costPrice;
  unitObj.preprice1 = salePrice;
  unitObj.retailPrice = retailPrice;
  (payload.units as unknown[])[0] = unitObj;

  const priceObj = { ...(payload.priceList as unknown[])[0] as Record<string, unknown> };
  priceObj.buyPrice = costPrice;
  priceObj.preprice1 = salePrice;
  priceObj.retailPrice = retailPrice;
  (payload.priceList as unknown[])[0] = priceObj;

  // 新建商品不带初始库存
  payload.iniGoodsstockList = [];
  payload.initGoodsStock = { batchList: [] };

  // 提交。ptype/save 错误用 code 区分（如 5001002 编号重复），callRaw 保留完整响应
  const res = await api.client.postJson(
    "https://ngpkj.wsgjp.com.cn/jxc/baseinfo/ptype/save",
    payload,
    "https://ngpkj.wsgjp.com.cn",
  );
  const json = await res.json();
  const ok = json.code === "200";
  return {
    success: ok,
    id: json.data?.id,
    usercode: json.data?.usercode,
    message: ok ? "创建成功" : json.message,
    raw: json.data,
  };
}
