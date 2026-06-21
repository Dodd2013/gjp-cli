/**
 * 库存模块：库存状况查询 + 明细库存分布。
 *
 * - listStockStatus: `analysiscloud/inventorySituation/list`（按商品汇总库存：现存量/可销量/可发量/成本/售价总额）
 * - listStockPosition: `analysiscloud/inventoryBatch/listInventoryPosition`（按商品+库位拆分的明细分布）
 * - listWarehouses: `baseinfo/ktype/pagelist`（仓库列表，库存查询前选仓库用）
 *
 * 注意：库存查询的 queryParams 用 `ktypeIdss`（双 s，仓库 ID 数组）过滤仓库。
 */
import { JxcClient } from "../api/client.ts";

/** 数值字段容错：服务端常返回 0E-8 这种极小浮点或 null，统一归零并保留两位 */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(4) : 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 库存状况（按商品汇总） */
export interface StockStatusItem {
  /** 商品 ID */
  ptypeId: string;
  /** 商品全名 */
  fullname: string;
  /** 简称 */
  shortname: string;
  /** 编号 */
  usercode: string;
  /** 单位 */
  unitName: string;
  /** 规格 */
  standard: string;
  /** 条码 */
  barcode: string;
  /** 现存量（可用库存） */
  qty: number;
  /** 实物库存（含在途/锁定等） */
  stockQty: number;
  /** 可销售量 */
  saleableQty: number;
  /** 可发货量 */
  sendableQty: number;
  /** 在途/待入库量 */
  transQty: number;
  /** 成本总额（预估） */
  costTotal: number;
  /** 售价总额（预估） */
  prepriceTotal: number;
  /** 是否停用 */
  stoped: boolean;
}

interface RawStockStatus {
  ptypeId: string;
  pFullname: string;
  shortname: string;
  usercode: string;
  unitName: string;
  standard: string;
  fullbarcode: string;
  qty: number;
  stockQty: number;
  saleableQty: number;
  sendableQty: number;
  inventoryTransQty: number;
  estimatedCostTotal: number;
  prepriceTotal: number;
  stoped: boolean;
}

function summarizeStatus(s: RawStockStatus): StockStatusItem {
  return {
    ptypeId: str(s.ptypeId),
    fullname: str(s.pFullname),
    shortname: str(s.shortname),
    usercode: str(s.usercode),
    unitName: str(s.unitName),
    standard: str(s.standard),
    barcode: str(s.fullbarcode),
    qty: num(s.qty),
    stockQty: num(s.stockQty),
    saleableQty: num(s.saleableQty),
    sendableQty: num(s.sendableQty),
    transQty: num(s.inventoryTransQty),
    costTotal: num(s.estimatedCostTotal),
    prepriceTotal: num(s.prepriceTotal),
    stoped: !!s.stoped,
  };
}

export interface ListStockOpts {
  /** 商品关键字（名称/编号/条码） */
  keyword?: string;
  /** 仓库名（不传=全部仓库） */
  warehouse?: string;
  /** 是否包含零库存商品，默认 false */
  includeZero?: boolean;
  /** 返回条数，默认 50 */
  pageSize?: number;
}

/** 库存状况查询：按商品汇总 */
export async function listStockStatus(opts: ListStockOpts = {}): Promise<{ total: string; list: StockStatusItem[] }> {
  const api = new JxcClient();
  await api.init();

  let ktypeIdss: string[] | null = null;
  if (opts.warehouse) {
    const w = await api.resolveWarehouse(opts.warehouse);
    ktypeIdss = [w.id];
  }

  const data = await api.call<{ total: string; list: RawStockStatus[] }>(
    "analysiscloud/inventorySituation/list",
    {
      refresh: true,
      queryParams: {
        stockMode: 2,
        selectType: 0,
        bigData: false,
        filter: null,
        isPC: "true",
        batchno: null,
        filterKey: opts.keyword ? "quick" : "quick",
        filterValue: opts.keyword ?? "",
        ptypeIds: null,
        ktypeIdss,
        ptypeShowZeroQtyFilter: opts.includeZero ? 1 : 0,
        showDefaultStock: 0,
        costModeFilter: -1,
        unitQuery: 2,
        ptypeFilterType: 0,
        showSkuStop: -1,
        inventoryType: "qualityInventory",
        positionVisible: false,
        partypeid: null,
      },
      pageSize: opts.pageSize ?? 50,
      pageIndex: 1,
      sorts: null,
      orders: null,
    },
  );

  return {
    total: str(data.total),
    list: (data.list ?? []).map(summarizeStatus),
  };
}

/** 明细库存分布（按商品 + 库位拆分） */
export interface StockPositionItem {
  ptypeId: string;
  fullname: string;
  shortname: string;
  usercode: string;
  unitName: string;
  /** 仓库全名 */
  warehouse: string;
  /** 批次号（启用批次管理时） */
  batchNo: string;
  /** 库位 */
  position: string;
  /** 该库位实物库存 */
  stockQty: number;
  /** 可用库存 */
  qty: number;
  /** 成本总额 */
  costTotal: number;
}

interface RawStockPosition {
  ptypeId: string;
  pFullname: string;
  shortname: string;
  usercode: string;
  unitName: string;
  kfullname: string;
  ktypeFullname: string;
  batchno: string;
  position: string;
  stockQty: number;
  qty: number;
  estimatedCostTotal: number;
}

function summarizePosition(s: RawStockPosition): StockPositionItem {
  return {
    ptypeId: str(s.ptypeId),
    fullname: str(s.pFullname),
    shortname: str(s.shortname),
    usercode: str(s.usercode),
    unitName: str(s.unitName),
    warehouse: str(s.kfullname ?? s.ktypeFullname),
    batchNo: str(s.batchno),
    position: str(s.position),
    stockQty: num(s.stockQty),
    qty: num(s.qty),
    costTotal: num(s.estimatedCostTotal),
  };
}

/** 明细库存分布查询：按商品 + 库位拆分 */
export async function listStockPosition(opts: ListStockOpts = {}): Promise<{ total: string; list: StockPositionItem[] }> {
  const api = new JxcClient();
  await api.init();

  let ktypeIdss: string[] | null = null;
  if (opts.warehouse) {
    const w = await api.resolveWarehouse(opts.warehouse);
    ktypeIdss = [w.id];
  }

  const data = await api.call<{ total: string; list: RawStockPosition[] }>(
    "analysiscloud/inventoryBatch/listInventoryPosition",
    {
      refresh: true,
      queryParams: {
        stockMode: 2,
        bigData: false,
        filter: null,
        selectType: null,
        isPC: "true",
        batchno: null,
        filterKey: "quick",
        filterValue: opts.keyword ?? "",
        batchPtypeIds: null,
        ktypeIdss,
        ptypeFilterType: 0,
        showDefaultStock: 0,
        costModeFilter: -1,
        unitQuery: 2,
        skuId: 0,
        btypeId: null,
        outKtypePointId: null,
        partypeid: null,
      },
      pageSize: opts.pageSize ?? 50,
      pageIndex: 1,
      sorts: null,
      orders: null,
    },
  );

  return {
    total: str(data.total),
    list: (data.list ?? []).map(summarizePosition),
  };
}

/** 仓库列表（库存查询前选仓库用） */
export async function listWarehouses(): Promise<{ id: string; fullname: string; usercode: string }[]> {
  const api = new JxcClient();
  await api.init();
  const data = await api.call<{ list: { id: string; fullname?: string; usercode?: string; name?: string }[] }>(
    "baseinfo/ktype/pagelist",
    {
      queryParams: {
        scategory: "0,2",
        isshowclass: false,
        isshowstop: false,
        stoped: false,
        stockStates: "0",
        stockTypes: "0,1,2",
        showadd: true,
        selectedAddedInfo: true,
      },
      pageSize: 200,
      pageIndex: 1,
    },
  );
  return (data.list ?? []).map((k) => ({
    id: k.id,
    fullname: k.fullname ?? k.name ?? "",
    usercode: k.usercode ?? "",
  }));
}
