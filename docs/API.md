# 管家婆进销存 API 接口文档

> 基于 `111.har` 抓包逆向整理。该 HAR 捕获的是一次**销售出库单创建**的完整流程。
> 所有业务接口位于 `https://ngpkj.wsgjp.com.cn/jxc/`，POST + JSON，靠 session cookie 鉴权。

---

## 0. 通用约定

### 0.1 鉴权

| 项 | 说明 |
|----|------|
| 鉴权方式 | Cookie（`ngp-authorization` JWT + `ngp-router`），HttpOnly |
| 获取方式 | 登录后 GET `loginUrl` 自动下发，见 [登录流程](#1-鉴权与会话-passportmygjpcomcn) |
| CLI 获取 | `getAuthenticatedClient()` 返回带会话的 `HttpClient` |

### 0.2 统一响应信封

所有业务接口返回：

```jsonc
{
  "code": "200",           // "200" 成功，其他为错误
  "message": "操作成功",
  "traceId": "93ae63e5383c80c2",
  "data": <具体数据或 null>
}
```

错误时 `data` 可能为 `null`，`message` 含错误描述。

### 0.3 关键枚举

**vchtype（单据类型）** — 贯穿几乎所有单据接口：

| vchtype | intVchtype | businessType | 含义 |
|---------|-----------|--------------|------|
| `Sale` | 2000 | `SaleNormal` / `SaleDistribution` | 销售出库 |
| `Buy` | 1000 | `Buy` | 采购入库（单据号前缀 `CR-`） |
| `GoodsTrans` | 3000 | `GoodsTrans` | 调拨/其它出入库 |
| `SaleReturn` | — | — | 销售退货 |
| `PurchaseReturn` | — | — | 采购退货 |

**billDeliverType（发货方式）**: `DELIVER_BY_LOGISTICS`（物流发货）等。

---

## 1. 鉴权与会话（passport.mygjp.com.cn）

> 已在 CLI 中实现，业务层无需关心，这里仅记录以便复现。

### 1.1 登录 `POST /api/ngpLogin`

**Host**: `passport.mygjp.com.cn`

```jsonc
{
  "userName": "<RSA(encodeURIComponent(用户名))>",   // 256 hex
  "password": "<RSA(密码)>",                         // 256 hex
  "companyName": "01292178",                         // 明文
  "validateCode": "",                                // 错误≥3次才需滑块
  "validateId": "",
  "deviceId": "", "ati": "", "pati": "",             // 指纹字段，留空即可
  "https": true,
  "loginType": null
}
```

**响应** `data` 关键字段：
- `loginUrl`: `https://ngpkj.wsgjp.com.cn/main.html?redirectKey=…&timestamp=…&sign=…` — **GET 它**换取会话 cookie
- `post`: 布尔。`false` 时直接 GET loginUrl；`true` 时需以表单 POST `arguments`
- `arguments.ngp-authorization`: JWT（5h 有效期）
- `arguments.ngp-router`: 路由 token
- `productId`: `88`（进销存产品）
- `profileId`: 账套 ID（如 `1265029598587183105`）
- `employeeId`: 员工 ID（如 `1265029598746566656`）

### 1.2 会话定型 `POST /jxc/recordsheet/sys/afterLogin`

GET `loginUrl` 后调用，空 body，返回 `{"code":"200","message":"操作成功","data":null}`。此后所有 `/jxc/` 接口可用。

---

## 2. 基础信息模块 `baseinfo`

### 2.1 仓库列表 `POST /jxc/baseinfo/ktype/pagelist` ★

```jsonc
{
  "pageSize": 200, "pageIndex": 1,
  "queryParams": {
    "filterkey": null, "filtervalue": null,
    "scategory": "0,2",        // 仓库类别
    "isshowclass": false, "isshowstop": false, "stoped": false,
    "stockStates": "0", "stockTypes": "0,1,2",
    "showadd": true, "selectedAddedInfo": true
  }
}
```

响应 `data.list[]`，每项含：`id`（仓库ID）、`fullname`/名称、`btypeId` 等。
HAR 样例：`默认仓库` → id `1265029598679457792`。

### 2.2 仓库流程信息 `POST /jxc/recordsheet/ktype/getKtypeProcessInfo`

```jsonc
{ "ktypeId": "1265029598679457792" }
```

返回 `scategory`、`deliverProcessType` 等。

### 2.3 往来单位（客户/供应商）列表 `POST /jxc/baseinfo/btype/list` ★

```jsonc
{
  "refresh": true,
  "queryParams": {
    "filterkey": "quick", "filtervalue": "<关键字>",
    "bcategory": 0, "stoped": false,
    "btypetype": "nofreight",       // 单位类型过滤
    "labelFieldList": [], "labelIdList": [],
    "containLine": false, "ignoreDeliveryinfo": true
  },
  "pageSize": 9, "pageIndex": 1
}
```

响应 `data.list[]`，含客户/供应商 id、名称、联系方式等。

### 2.4 员工/操作员详情 `POST /jxc/baseinfo/etype/getform`

请求体为**纯字符串**（员工 ID）：`"1265029598746566656"`
返回：`fullname`（如"管理员"）、`usercode`、`profileId` 等。

### 2.5 登录用户校验

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `POST /jxc/baseinfo/etype/loginuser/checkloginuserphone` | `{}` | 检查登录用户手机（返回 bool） |
| `POST /jxc/baseinfo/etype/overusercountcheck` | `{}` | 在线人数/超员检查（返回 bool） |

### 2.6 自定义字段 `POST /jxc/baseinfo/customFields/list`

```jsonc
{ "businessType": 1, "subType": 5001, "usedTypes": 2 }
```

返回 `masterCustomConfig` 等单据自定义字段配置。

### 2.7 商品单位字典 `POST /jxc/baseinfo/ptype/unit/ptypeiddic`

请求体为 ID 数组：`["1904374566186661183"]`
返回 `{ "<ptypeId>": [{ unitId, unitName, unitRate, barcode, ... }] }`。

### 2.8 其它基础接口

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `POST /baseinfo/basicinfo/class/list` | `{partypeid, typeids, basicname}` | 分类列表 |
| `POST /baseinfo/basicinfo/getLockScreenInfo` | `null` | 锁屏信息（lockMinute、locked） |
| `POST /baseinfo/basicinfo/getIsAutoUsercode` | `{queryType, basicInfoName}` | 是否自动编码 |
| `POST /baseinfo/basicinfo/getMaxUsercode` | `{filterStr, queryType, basicInfoName}` | 当前最大编码 |
| `POST /baseinfo/basicinfo/getUsercodeIncreaseRule` | `{queryType, basicInfoName}` | 编码递增规则 |
| `POST /baseinfo/btype/deliverinfo/getdefaulted` | `{btypeid, deliverytype}` | 默认发货信息 |
| `POST /baseinfo/ktype/deliverinfo/getList` | `{ktypeid, deliverytype}` | 仓库发货方式 |
| `POST /baseinfo/common/getEncryptSecretInfo` | `[{id, phone, mobile, secretId}]` | 联系方式解密（脱敏） |
| `POST /baseinfo/labelfield/baseInfoLabelValue/list` | `{enabled, labelFieldType}` | 标签值 |
| `POST /baseinfo/sysmodel/getApplicationCenterUrl` | `null` | 应用中心域名 |
| `POST /baseinfo/pubsystemlog/saveform` | `{body: "进入电脑端"}` | 行为埋点 |

---

## 3. 商品模块 `recordsheet/ptype`

### 3.1 商品列表 `POST /jxc/recordsheet/ptype/ptypelist` ★

```jsonc
{
  "btypeId": "1904385483982654672",     // 关联往来单位（影响价格）
  "ptypeList": [{ "ptypeId": "1904374566186661183" }]
}
```

返回商品详情：`id`、`fullname`（商品名）、`usercode`、`shortname`、`namepy`、`pcategory` 等。

### 3.2 商品基础列表（搜索） `POST /jxc/recordsheet/ptype/baselist` ★

```jsonc
{
  "pageSize": 100, "pageIndex": 1,
  "queryParams": {
    "filterkey": "quick", "filtervalue": "<搜索关键字>",
    "stoped": false,
    "btypeid": "1904385483982654672",
    "pcategories": [0,1,3,4,2],
    "ktypeId": "1265029598679457792",   // 仓库
    "showXcodes": true
  }
}
```

响应 `data.list[]`：`id`、`usercode`、`fullname`（商品名）。**用于按名称搜索商品。**

### 3.3 库存数量查询 `POST /jxc/recordsheet/ptype/getStockQty` ★★

```jsonc
{
  "ktypePointId": null, "ktypePointType": 0,
  "ptypeList": [{
    "ptypeId": "1904374566186661183",
    "ktypeId": "1265029598679457792",     // 仓库
    "skuId": "1904374574763619647",
    "batchenabled": false, "propenabled": false
  }],
  "allStockQuery": false                  // true=所有仓库合计
}
```

响应每项含：`stockQty`（可用库存）、`inventoryQty`（实物）、`saleQty`、`sendQty`（已发货待出）、`stockSubQty`。**库存查询核心接口。**

### 3.4 商品价格/成本

| 接口 | 用途 | 关键请求字段 |
|------|------|------------|
| `POST /ptype/getPtypePrice` | 取成本价 | `priceTypeEnum: "COST"` |
| `POST /ptype/getPtypePriceAndCost` | 取售价+成本 | `priceTypeEnum: "SALE"`，含 `strategyDataList` |
| `POST /ptype/getBatchPtypeSku` | 批量取 SKU | `{skuList:[{ptypeId, unitId}]}` |
| `POST /ptype/getBatchPtypeTierPrice` | 批量阶梯价 | `{ptypeList:[{ptypeId, unitId, skuId}]}` |
| `POST /ptype/getBindPtypePositionList` | 商品绑定库位 | `{bindPtypePositionList:[…]}` |
| `POST /basePtypeUnit/findFirstPtypeFullbarcodeBatch` | 首个条码批次 | `[ptypeId]` |

---

## 4. 单据核心模块 `recordsheet`

### 4.1 业务类型列表 `POST /jxc/recordsheet/accBusinessType/list` ★

```jsonc
{ "vchtypeEnum": "Sale", "intVchtypeList": null, "query": true }
```

响应 `data[]`：`{vchtype, name, businessType, businessCode, businessTypeEnum}`。
样例：`普通销售/SaleNormal`、`分销业务/SaleDistribution`。

### 4.2 按单号查单据 `POST /jxc/recordsheet/goodsBill/getBillByVchcode` ★

```jsonc
{
  "vchtype": "Sale",
  "businessType": "SaleNormal",
  "copyTypeEnum": "DEFAULT",
  "sourceVchtype": "Sale",
  "targetVchtype": "Sale"
}
```

> ⚠️ HAR 中未见显式 vchcode 入参（可能走 query string 或依赖单据号参数）。用于打开/复制单据。返回完整单据结构（同 submitBill 的入参结构）。

### 4.3 保存/提交单据 `POST /jxc/recordsheet/goodsBill/submitBill` ★★★

**核心写接口**。请求体是完整的单据对象（字段极多，以下为关键字段）：

```jsonc
{
  "profileId": "1265029598587183105",
  "employeeId": "1265029598746566656",
  "vchtype": "Sale",                 // 单据类型
  "businessType": "SaleNormal",      // 业务类型
  "intVchtype": 2000,
  "number": "PXX-20260620-00002",    // 单据号（见 4.5 生成）
  "displayNumber": "PXX-20260620-00002",
  "vchcode": "1904394924323478931",  // 单据唯一ID（新建时由前端或服务端给）
  "date": "2026-06-20T03:00:39.000Z",
  "ktypeId": "1265029598679457792",  // 仓库
  "kfullname": "默认仓库",
  "btypeId": "1904385483982654672",  // 客户/往来单位
  "bfullname": "唱起一上",
  "currencyBillTotal": 9.2,          // 单据总金额
  "billDeliverType": "DELIVER_BY_LOGISTICS",
  "source": "手工新增",
  "saveModel": "SAVE_NEW",           // SAVE_NEW 新建 / SAVE_UPDATE 修改
  "needValidation": true,
  "outDetail": [                     // 出库明细（销售单）
    {
      "ptypeId": "1904374566186661183",
      "skuId": "1904374574763619647",
      "unitId": "1904374574762571071",
      "pFullName": "测试商品001",
      "unitQty": 1,                  // 数量
      "currencyPrice": 9.2,          // 单价
      "currencyTotal": 9.2,          // 行金额
      "discount": 1,
      "currencyDisedPrice": 9.2,
      "currencyDisedTotal": 9.2,
      "ktypeId": "1265029598679457792"
    }
  ],
  "inDetail": [],                    // 入库明细（采购单用）
  "payment": [...]                   // 收付款信息
}
```

**响应**（注意异常处理）：
```jsonc
{
  "code": "200",
  "data": {
    "vchcode": "1904394924323478931",
    "billNumber": "PXX-20260620-00002",
    "resultType": "CONFIRM",         // CONFIRM=需用户确认的异常（如库存不足）；SUCCESS=成功
    "auditState": null,
    "exceptionInfo": [
      {
        "bizErrorCode": "NEG_STOCK_ERROR",   // 库存不足
        "resultType": "CONFIRM",
        "message": "下列商品库存数量不足..."
      }
    ]
  }
}
```

> **关键**：`resultType === "CONFIRM"` 表示单据已存草稿但有需确认的异常（库存不足等），需带确认标记重新提交。`SUCCESS` 表示完全成功。

### 4.4 单据号生成 `POST /jxc/recordsheet/billNumber/updateBillNumber` ★

```jsonc
{
  "changeType": 4,
  "businessType": "SaleNormal",
  "intVchtype": 2000,
  "date": "2026-06-20 11:00:39",
  "profileId": "1265029598587183105",
  "number": "PXX-20260620-00002",
  "streamNumber": "2"
}
```

响应：`{ vchtypeNumber: "PXX-20260620-00002", number: "2", numberDate }`。
**保存单据前需先调用此接口生成单据号。**

`POST /billNumber/backBillNumber` — 退回/回收单据号（放弃保存时调用）。

### 4.5 单据审核与配置

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `POST /billAudit/checkAuditEnable` | `{vchtype, vchcode, businessType}` | 查询是否可审核（auditEnable） |
| `POST /billConfig/getBillStrategyConfigNoPower` | `{showType: "saleTab"}` | 单据价格策略 |
| `POST /billsetting/getSwitchList` | `{vchtypes: ["Sale"]}` | 单据功能开关 |
| `POST /billMark/list` | `"Sale"`（纯字符串） | 单据标记（如"以销定采""改价"） |
| `POST /billCore/getBillPaymentDate/` | `{date, btypeId}` | 应收应付日期 |
| `POST /orderBill/getOrderOccupyAdvanceTotal` | `{btypeId, vchcode}` | 订单占用预收款 |

### 4.6 单据配置/赠品

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `POST /customConfig/list` | `{subType: "2000"}` | 单据字段配置 |
| `POST /giftType/list` | `{}` | 赠品类型（普通赠品/陈列赠品…） |

---

## 5. 业务流程示例：创建销售出库单

该 HAR 的完整操作序列（按时间）：

```
1. accBusinessType/list          → 确定业务类型 SaleNormal
2. ptype/baselist                → 搜索商品"测试商品001"
3. ptype/getBatchPtypeSku        → 取商品 SKU/单位
4. ptype/getStockQty             → 查库存（此时返回 stockQty=0）
5. ptype/getPtypePriceAndCost    → 取售价/成本
6. btype/list                    → 选客户"唱起一上"
7. billNumber/updateBillNumber   → 生成单据号 PXX-20260620-00002
8. goodsBill/submitBill          → 保存单据（保存草稿）
   └ 返回 NEG_STOCK_ERROR → resultType: CONFIRM（库存不足，需确认）
9. （用户确认/关闭） billNumber/backBillNumber → 退回单据号
```

**CLI 化建议命令**：

```bash
gjp sales create \
  --warehouse 默认仓库 \
  --customer 唱起一上 \
  --items '[{"name":"测试商品001","qty":1,"price":9.2}]'

# 内部依次调用步骤 2-8，自动处理 CONFIRM 异常
```

---

## 6. 尚未覆盖（需更多 HAR 样例）

| 业务 | 需要的操作 | 预期接口 |
|------|-----------|---------|
| ~~采购入库~~ | ~~新建采购单~~ | ✅ 已实现（见 §9，vchtype=Buy） |
| 库存盘点 | 盘点单增删改 | `recordsheet/stocktake/*` |
| 库存查询列表 | 多商品/多仓库汇总 | `recordsheet/report/*` |
| 财务收付款 | 收款单/付款单 | `finance/*` |
| 报表 | 进销存报表、利润报表 | `report/*` |
| 单据列表查询 | 按条件查历史单据 | `goodsBill/list`（待确认） |
| 单据删除/红冲 | 删除、退货 | `goodsBill/delete`、红字单 |

**每个新 HAR 样例可补全一个模块的完整接口。**

---

## 附：已识别接口汇总

```
baseinfo/          basicinfo/class·list·save, basicinfo/getExact, basicinfo/getIsAutoUsercode,
                   basicinfo/getLockScreenInfo, basicinfo/getMaxUsercode,
                   basicinfo/getNewRowIndex, basicinfo/getUsercodeIncreaseRule,
                   basicinfo/setUsercodeIncreaseRule,
                   btype/list·save·batchStoped·batchUpdateBtypeLocation·checkBtypePhoneIsRepeat,
                   btype/deliverinfo·getdefaulted·batchSave·pageList,
                   common/getEncryptSecretInfo, common/businessLog/pageList,
                   customFields/list, etype/getform·getlist,
                   etype/loginuser/checkloginuserphone, etype/overusercountcheck,
                   ktype/deliverinfo/getList, ktype/pagelist,
                   labelfield/baseInfoLabelValue/list,
                   ptype/save·get·unitsku/childpagelist, ptype/unit/ptypeiddic,
                   pubsystemlog/saveform, sysmodel/getApplicationCenterUrl

recordsheet/       accBusinessType/list, basePtypeUnit/findFirstPtypeFullbarcodeBatch,
                   billAudit/checkAuditEnable, billConfig/getBillStrategyConfigNoPower,
                   billCore/getBillPaymentDate, billMark/list, billNumber/back·updateBillNumber,
                   billsetting/getSwitchList, customConfig/list, giftType/list,
                   goodsBill/getBillByVchcode·submitBill, ktype/getKtypeProcessInfo,
                   orderBill/getOrderOccupyAdvanceTotal,
                   ptype/baselist·ptypelist·getBatchPtypeSku·getBatchPtypeTierPrice·
                         getBindPtypePositionList·getPtypePrice·getPtypePriceAndCost·getStockQty,
                   sys/afterLogin
```

> 模块映射：`auth`（鉴权）、`sales`（销售单）、`purchase`（采购单）、`product`（商品）、`customer`（往来单位/客户/供应商）已在 CLI 实现。

---

## 7. 商品管理模块 `baseinfo/ptype`（来自 商品.har）

该 HAR 捕获**新增商品**流程。核心写接口 `ptype/save`，查接口 `ptype/get` / `ptype/unitsku/childpagelist`。

### 7.1 新建/修改商品 `POST /jxc/baseinfo/ptype/save` ★★★

请求体（精简，61 字段模板见 `src/modules/templates/product-save.json`）：
```jsonc
{
  "id": 0,                       // 0=新建，已有id=修改
  "fullname": "CLI测试商品A",
  "shortname": "CLI测",
  "usercode": "CLITEST001",      // 编号，需唯一；重复报 code 5001002
  "ptypeType": "3",              // 3=普通商品
  "costPrice": 10,
  "standard": "1L",
  "units": [{ "unitName": "个", "unitRate": 1, "buyPrice": 10, "preprice1": 15, "retailPrice": 0 }],
  "priceList": [{ "unitCode": 1, "buyPrice": 10, "preprice1": 15, "retailPrice": 0 }],
  "iniGoodsstockList": [],       // 初始库存，新建时留空
  "initGoodsStock": { "batchList": [] }
}
```
响应：成功 `code:200` + `data.id`；编号重复 `code:5001002 message:"商品编号重复"`。

### 7.2 查商品详情 `POST /jxc/baseinfo/ptype/get` ★

请求体为**纯字符串 ID**：`"1904554224660294712"`
返回：`{id, fullname, usercode, shortname, ptypeType, costPrice, standard, ...}`。

### 7.3 商品/SKU 列表 `POST /jxc/baseinfo/ptype/unitsku/childpagelist` ★

```jsonc
{ "refresh": true,
  "queryParams": {
    "filterkey": "quick", "filtervalue": "<关键字>",
    "pcategories": [0,1,3,4], "stoped": 0, "skuStoped": 0, "ptypeStoped": 0,
    "partypeid": null, "ktypeId": null, "showSaleFormula": false
  },
  "pageSize": 50, "pageIndex": 1 }
```
响应 `data.list[]`（树形：父行含 ptypeId，叶子 SKU 行字段较稀疏，需按 ptypeId 关联）。

### 7.4 辅助接口

| 接口 | 用途 |
|------|------|
| `basicinfo/getMaxUsercode`(Ptype) | 取当前最大编号（生成新编号用） |
| `basicinfo/getIsAutoUsercode`(Ptype) | 是否自动编号 |
| `basicinfo/getNewRowIndex`(Ptype) | 新行 ID |
| `brandtype/list` | 品牌列表 |
| `labelfield/ptypelabelvalue/list` | 商品标签 |
| `prop/propvalue/propiddic` | 商品属性 |
| `common/businessLog/pageList`(Ptype) | 商品操作日志 |

---

## 8. 往来单位模块（客户/供应商）`baseinfo/btype`

该 HAR 捕获**新增客户、新增供应商、停用/启用**的完整流程。

**核心类别枚举**（`bcategorys` / `bcategory` / `accType` 三者联动）：

| 取值 | 含义 |
|------|------|
| `0` | 客户 |
| `1` | 供应商 |
| `3` | 其它往来单位（仅用于列表过滤 `queryBcategoryList`） |

### 8.1 往来单位列表 `POST /jxc/baseinfo/btype/list` ★

```jsonc
{
  "refresh": true,
  "queryParams": {
    "filterkey": "quick",            // 有 filtervalue 时用 quick，无则 ""
    "filtervalue": "<关键字>",
    "partypeid": "00000",            // 分类节点
    "btypetype": "nofreight",
    "priceLevel": null,
    "stoped": false,                 // false=仅启用，null=含停用
    "hasClass": true,
    "queryBcategoryList": [0],       // [0]=客户 [1]=供应商 [0,1,3]=全部
    "ignoreDeliveryinfo": true
  },
  "pageSize": 21, "pageIndex": 1,
  "sorts": null, "orders": null, "first": 0, "count": 21
}
```

响应 `data.list[]`（每项约 130 字段），关键字段：
`id`、`usercode`(编号)、`fullname`(名称)、`shortname`、`bcategorys`/`accType`(类别)、
`tel`、`person`(联系人)、`area`、`stoped`、`arTotal`(应收余额)、`apTotal`(应付余额)、
`priceLevel`、`etypeid`/`efullname`(业务员)、`createTime`。`data.total` 为总数（字符串）。

> 注：2.3 节描述的是销售单据内嵌的简化查询；此节为往来单位管理页的完整列表，字段更全。

### 8.1b 往来单位详情 `POST /jxc/baseinfo/btype/get` ★

请求体为**纯字符串 ID**：`"1904628733748474975"`
返回该单位的完整记录（同 save 入参结构 + `memo`/`btypeInitData` 等），含已回填的 `tel`/`person`、`memo`、`priceLevel`、`etypeid` 等。**按 ID 取详情用此接口**（比 list 过滤更准、字段更全）。

### 8.2 新建/修改往来单位 `POST /jxc/baseinfo/btype/save` ★★★

**核心写接口**。请求体（精简，模板见 `src/modules/templates/btype-save.json`）：

```jsonc
{
  "fullname": "测试客户1",          // 全名
  "shortname": "测试客户",
  "usercode": "3",                  // 编号，需唯一
  "bcategorys": [0],                // [0]=客户 [1]=供应商
  "bcategory": 0,                   // 同上
  "accType": 0,                     // 同上（0=客户 1=供应商）
  "priceLevel": "1",                // 客户用"1"，供应商用 0
  "etypeid": "1265029598746566656", // 业务员 ID
  "efullname": "管理员",
  "parid": "1904593935937342239",   // 所属分类节点 ID（无则 null）
  "parfullname": "客户和供应商分类1",
  "partypeid": "00004",             // 分类 typeid（无则 "00000"）
  "tel": "19906868955",
  "person": "",                     // 联系人
  "area": "天津/天津市/和平区/劝业场街道",
  "registerAddr": "...",
  "rowindex": "1904594571589924159",// 由 getNewRowIndex 取（见 8.6）
  "customField": { "customHead01": "", /* ...customHead11 */ },
  /* 其余金额/折扣/税率字段默认 0 */
  "frontRequest": true
}
```

**客户 vs 供应商差异**：

| 字段 | 客户 | 供应商 |
|------|------|--------|
| `bcategorys` / `bcategory` / `accType` | `[0]` / `0` / `0` | `[1]` / `1` / `1` |
| `priceLevel` | `"1"`（字符串） | `0`（数字） |
| `initArTotal` / `initApTotal` | `0` / `"0"` | `"0"` / `0` |

响应：成功 `code:200` + `data` = 新 btype ID（字符串）。

> 💡 **电话/联系人/地址不在本接口保存**：`btype/save` 的 `tel`/`person`/`phone` 入参**不会持久化**（list 回显 null）。这些字段由紧随其后的 **`deliverinfo/batchSave`** 保存（见 8.4），成功后服务端**回填** `btype.tel`/`btype.person`。即浏览器建客户时 tel 能存，是因为它 save 后又调了 deliverinfo；只调 save 不调 deliverinfo，tel 就是 null。`fullname`/`usercode`/类别/`memo` 在 `btype/save` 直接生效。


### 8.3 停用/启用 `POST /jxc/baseinfo/btype/batchStoped` ★

```jsonc
{ "ids": ["1904594571582221368"], "stoped": true, "freighted": false }
```

`stoped: true` 停用，`false` 启用。响应 `data: null`。

### 8.4 发货信息（电话/联系人/地址的真正落点）★

> **重要**：客户/供应商的电话、联系人、地址**经此接口保存**，而非 `btype/save`。`batchSave` 成功后服务端会**回填 `btype.tel`/`btype.person`**，故 list 才能显示电话。`customer create --phone/--contact/--area/--address` 与 `customer contact` 都走这里。

| 接口 | 请求体 | 响应 |
|------|--------|------|
| `POST /btype/deliverinfo/batchSave` | `[{btypeId, receiverPeople, receiverTelephone, receiverCellphone, receiverZipcode, popupArea, receiverAddress, province, city, district, street, deliveryTypeList:[0,2], companyAddress:true, defaulted:true, modified:true, deliverytype:null}]` | `data: {"0": "<deliverId>"}` |
| `POST /btype/deliverinfo/pageList` | `{queryParams:{btypeid}}` | `data.list[]` 含 `receiverTelephone`/`receiverPeople`/地址等 |

`batchSave` 入参是**数组**（可一次多条）。`popupArea` 为完整地区串（如「天津/天津市/和平区/劝业场街道」），`province`/`city`/`district`/`street` 为其拆分。**更新**已有客户的联系方式时：先 `pageList` 取出已存在的行，提交时带上其 `id`/`deliveryinfoId` + `dynamicButtons`/`popupArea` + `modified:true`，服务端**原地覆盖**（deliverinfo 行数不变，实测保持 1 行），并回填 `btype.tel`/`person`。响应 `data` 形如 `{"0":"<id>"}`，该 id 每次可能不同（服务端重发句柄），不代表新增行。

### 8.5 手机号查重 `POST /jxc/baseinfo/btype/checkBtypePhoneIsRepeat`

```jsonc
{ "phone": "19906868955" }
```

响应 `data: true/false`（是否已存在）。

### 8.6 编码与行号辅助接口（basicname=Btype）

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `POST /basicinfo/getNewRowIndex` | `{stargetId, basicName:"Btype"}` | 取新 rowindex（`stargetId`=任意已存在 btype id） |
| `POST /basicinfo/getMaxUsercode` | `{filterStr:"", queryType:"Usercode", basicInfoName:"Btype"}` | 当前最大编号，+1 推新号 |
| `POST /basicinfo/getIsAutoUsercode` | `{queryType:"IsAutoUsercode", basicInfoName:"Btype"}` | 是否自动编码（`"1"`/`"0"`） |
| `POST /basicinfo/getUsercodeIncreaseRule` | `{queryType:"UsercodeIncreaseRule", basicInfoName:"Btype"}` | 编码递增规则 |
| `POST /basicinfo/setUsercodeIncreaseRule` | `{queryType:"UsercodeIncreaseRule", basicInfoName:"Btype", filterStr:"1"}` | 设置递增规则 |

### 8.7 往来单位分类 `POST /jxc/baseinfo/basicinfo/class/*` ★

| 接口 | 请求体 | 用途 |
|------|--------|------|
| `class/list` | `{partypeid:null, typeids:null, basicname:"Btype"}` | 分类树 |
| `class/save` | `{basicname:"Btype", fullname:"客户和供应商分类1", partypeid:"00000"}` | 新增分类 |

`class/save` 响应：`data.treeNodeDto.{typeid, id, fullname, partypeid}`。

### 8.8 操作日志 `POST /jxc/baseinfo/common/businessLog/pageList`

```jsonc
{ "refresh": true,
  "queryParams": { "basicName": "Btype", "objectId": "<btypeId>" },
  "pageSize": 200, "pageIndex": 1 }
```

返回该往来单位的操作记录（创建/修改/停用等）。

### 8.9 业务流程示例：新建客户

```
1. basicinfo/class/list(Btype)       → 取分类树（供选择 parid）
2. customFields/list(subType:5002)    → 自定义字段配置
3. getMaxUsercode/getIsAutoUsercode   → 推算编号
4. labelfield/baseInfoLabelValue/list(btype) → 标签
5. (可选) class/save                  → 新建分类
6. getNewRowIndex(stargetId)          → 取 rowindex
7. (可选) checkBtypePhoneIsRepeat     → 手机号查重
8. btype/save                         → ★ 新建，返回新 id
9. pubsystemlog/saveform              → 行为埋点（可跳过）
10. btype/deliverinfo/batchSave       → 发货信息（可选）
11. btype/list                        → 刷新列表
```

停用/启用：`batchStoped({ids, stoped:true/false})`。

---

## 9. 采购入库单模块（来自 采购入库单.har）

与销售出库单（§4）**高度同构**，复用 `goodsBill/submitBill`。差异：

| 项 | 销售（Sale） | 采购（Buy） |
|----|------------|------------|
| `vchtype` / `businessType` | `Sale` / `SaleNormal` | `Buy` / `Buy` |
| `intVchtype` | 2000 | 1000 |
| 单据号前缀 | `PXX-` | `CR-` |
| 明细字段 | `outDetail` | `inDetail` |
| btype | 客户（`resolveCustomer`） | 供应商（`resolveSupplier`，`bcategory:1`） |
| 业务类型查询 | `accBusinessType/list {vchtypeEnum:"Sale"}` | `{vchtypeEnum:"Buy"}` |
| 模板 | `getBillByVchcode{vchtype:"Sale",...}` | `{vchtype:"Buy",...}` |

### 9.1 采购单结构 `POST /jxc/recordsheet/goodsBill/submitBill` ★★★

关键字段（与销售相同的信封，仅列差异点）：

```jsonc
{
  "vchtype": "Buy", "businessType": "Buy", "intVchtype": 1000,
  "number": "CR-20260620-00003",
  "ktypeId": "1265029598679457792",      // 仓库
  "btypeId": "1904594932357963155",      // 供应商
  "bfullname": "供应商1111",
  "currencyBillTotal": "30",
  "inDetail": [ /* 入库明细，196 字段/行，模板见 purchase-indetail-line.json */ ],
  "outDetail": [],
  "payment": [{ "afullname":"现金", "atypeId":"...", "currencyAtypeTotal":30 }],  // 付款账户+金额
  "saveModel": "SAVE_NEW",
  "needValidation": true,
  "confirm": false                       // ★ 见 9.2
}
```

`inDetail` 每行关键字段：`ptypeId`/`skuId`/`unitId`/`pFullName`/`unitQty`/`currencyPrice`(采购价)/`currencyCost`(成本)/`currencyTotal`/`currencyDisedPrice`/`ktypeId`。与 `outDetail` 共享约 192 字段，差异仅在库位字段（`inPosition*` vs `outPosition*`）等。

### 9.2 CONFIRM 异常处理（关键差异）★

采购单的需确认异常（如 `COST_BATCH_ERROR`「下列商品价格为0」）**不靠 `needValidation:false`**，而是在 submitBill body 里置 **`confirm: true`** 重提：

| 提交 | `confirm` | 响应 resultType |
|------|----------|----------------|
| 第1次 | `false` | `CONFIRM`（exceptionInfo: COST_BATCH_ERROR 价格为0） |
| 第2次 | `true` | `SUCCESS` |

> 即明细行可保持不变（含 0 价），仅 `confirm:false→true` 重提即落库。CLI 的 `gjp purchase create --force` 即置 `confirm:true`。（对比：销售 `--force` 是 `needValidation:false` + `failedSaveUnconfirmed:true` + `allowZeroQty:true`。）

### 9.3 业务流程示例：创建采购入库单

```
1. accBusinessType/list {vchtypeEnum:"Buy"}   → 业务类型 Buy
2. goodsBill/getBillByVchcode {vchtype:"Buy",copyTypeEnum:DEFAULT}  → 取模板(含 vchcode+number+payment)
3. btype/list {bcategory:1}                   → 选供应商
4. ktype/pagelist                              → 选仓库
5. billNumber/updateBillNumber                 → 生成单据号 CR-...
6. ptype/getBatchPtypeSku + getPtypePriceAndCost + getStockQty  → 每个商品取SKU/价格/库存
7. goodsBill/submitBill (confirm:false)        → 保存；COST_BATCH_ERROR → CONFIRM
8. goodsBill/submitBill (confirm:true)         → 确认落库 → SUCCESS
```

### 9.4 删除采购单 `POST /jxc/recordsheet/billCore/deleteBill` ★★★

```jsonc
{
  "vchcode": "1904694987912656191",     // 单据 ID
  "vchtype": "Buy", "businessType": "Buy",
  "billDate": "2026-06-20T12:42:51.000+00:00",  // 单据日期（必填，从 list 取）
  "billPostState": 800,                         // = 单据 postState（已过账=800）
  "confirm": false                              // 负库存强制删时置 true
}
```

**两种结果**（与 submitBill 的 confirm 机制同源）：

| 情形 | 响应 `data` | 含义 |
|------|------------|------|
| 正常删除 | `{success:true, result:null}` | 已删除 |
| 删后库存<0 | `{success:false, result:"ALLOW", errorDetail:[{bizErrorCode:"NEG_STOCK_ERROR", resultType:"CONFIRM", detailList:[{pfullname, stockQty, unitQty, ...}]}]}` | 需确认；带 `confirm:true` 重提即删 |

> `confirm:true` 允许负库存删除（同 create 的 `--force`）。CLI `gjp purchase delete`：先无 confirm 删 → 若 `NEG_STOCK_ERROR` 且带 `--force`，再 `confirm:true` 重提。

**billDate / billPostState 来源**：用 `POST /jxc/recordsheet/billCore/list` 查历史单据取。
```jsonc
{ "queryParams": { "postStateList":[800], "startTime":"...","endTime":"...",
   "saleOrbuy":1, "execQueryPage":"BuyBillQuery", "vchtypes":[1000,1100,1200],
   "conformType":0,"postState":"","invoiceType":0,"paymentType":0,"redbillState":-1,
   "sourceNumber":"","settleAccountVisible":false }, "pageSize":200, "pageIndex":1 }
```
返回 `data.list[]`，每项含 `vchcode`/`billNumber`(CR-...)/`billDate`/`postState`/`bfullname`/`currencyBillTotal`。
> ⚠️ `postStateList` 只接受**单个**值（多值返回空）。`800`=已过账。删单只针对已过账单据。

### 9.5 业务流程示例：删除采购单（负库存场景）

```
1. billCore/list {postStateList:[800]}  → 按单号/vchcode 找到 billDate + postState
2. billCore/deleteBill (confirm:false)   → 删后库存<0 → NEG_STOCK_ERROR / CONFIRM
3. (用户确认负库存影响) billCore/deleteBill (confirm:true) → SUCCESS 落库删除
```



