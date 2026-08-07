# RESTful API 接口文档

> 本文档根据 `amiba_digital_assistant/routes/` 目录下的路由代码整理，列出所有 RESTful API 接口、请求参数与响应格式。
>
> **基础路径**：`http://localhost:3000`（或环境变量 `PORT` 指定）
>
> **认证方式**：除 `/api/auth/login` 和 `/api/health` 外，所有接口需在请求头中携带 JWT Token：
> ```
> Authorization: Bearer <token>
> ```
> Token 有效期 7 天，通过 `/api/auth/login` 获取。

---

## 目录

- [1. 认证与用户管理](#1-认证与用户管理-auth)
- [2. 健康检查](#2-健康检查-health)
- [3. 收支流水](#3-收支流水-transactions)
- [4. 支出项细分](#4-支出项细分-expense-items)
- [5. 收支类型](#5-收支类型-expense-types)
- [6. 商品管理](#6-商品管理-products)
- [7. 客户管理](#7-客户管理-customers)
- [8. 库存管理](#8-库存管理-inventory)
- [9. 合同管理](#9-合同管理-contracts)
- [10. 服务目录](#10-服务目录-services)
- [11. 员工管理](#11-员工管理-employees)
- [12. 月度工时](#12-月度工时-workhours)
- [13. 工资管理](#13-工资管理-salaries)
- [14. 账号设置](#14-账号设置-settings)
- [15. 商品分类预设](#15-商品分类预设-categories)
- [16. 示例数据重置](#16-示例数据重置-init)
- [17. 合同候选推荐](#17-合同候选推荐-contracts-suggest)
- [18. 商品分析](#18-商品分析-analysis)
- [19. 驾驶舱聚合](#19-驾驶舱聚合-analysis-cockpit)
- [20. 客户分析聚合](#20-客户分析聚合-analysis-customer)
- [21. 商品分析聚合](#21-商品分析聚合-analysis-product)
- [22. 合同分析聚合](#22-合同分析聚合-analysis-contract)
- [23. 费用分析聚合](#23-费用分析聚合-analysis-expense)
- [24. 阿米巴核算聚合](#24-阿米巴核算聚合-analysis-amoeba)
- [25. 汇率查询](#25-汇率查询-exchange)
- [26. AI 对话](#26-ai-对话-ai)

---

## 1. 认证与用户管理 (auth)

### POST /api/auth/login

用户登录，返回 JWT Token。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |

**成功响应** (200)：
```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "系统管理员",
    "company_name": "系统默认企业",
    "role": "admin"
  }
}
```

**错误响应**：
- 400: `{"error": "请输入用户名和密码"}`
- 401: `{"error": "用户名或密码错误"}`

---

### GET /api/auth/me

获取当前登录用户信息（需认证）。

**请求参数**：无

**成功响应** (200)：
```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "系统管理员",
    "company_name": "系统默认企业",
    "role": "admin",
    "iat": 1753957200,
    "exp": 1754562000
  }
}
```

---

### PUT /api/auth/password

修改当前登录用户密码（需认证）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `oldPassword` | string | 是 | 原密码 |
| `newPassword` | string | 是 | 新密码，至少 6 位 |

**成功响应** (200)：
```json
{ "success": true, "message": "密码修改成功" }
```

**错误响应**：
- 400: `{"error": "请输入原密码和新密码"}` / `{"error": "新密码至少 6 位"}` / `{"error": "原密码错误"}`

---

### GET /api/users

获取所有用户列表（需认证 + 超级管理员 `admin`）。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "username": "admin",
    "display_name": "系统管理员",
    "company_name": "系统默认企业",
    "created_at": "2026-01-01T00:00:00.000Z"
  }
]
```

**错误响应**：
- 403: `{"error": "权限不足，仅系统管理员可管理账号"}`

---

### POST /api/users

创建新用户（需认证 + 超级管理员 `admin`）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码，至少 6 位 |
| `display_name` | string | 否 | 显示名，默认等于 username |
| `company_name` | string | 是 | 企业名称 |

**成功响应** (200)：
```json
{
  "id": 3,
  "username": "newuser",
  "display_name": "新用户",
  "company_name": "某某服装公司",
  "role": "admin"
}
```

**错误响应**：
- 400: `{"error": "用户名和密码必填"}` / `{"error": "密码至少 6 位"}` / `{"error": "企业名称必填"}` / `{"error": "用户名已存在"}`

> 创建账号后会自动调用 `seedForUser(newId, 'sample')` 生成少量示例数据。

---

### PUT /api/users/:id

修改用户信息（需认证 + 超级管理员）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 用户 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `display_name` | string | 否 | 新的显示名 |
| `company_name` | string | 否 | 新的企业名称（不能为空字符串） |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "企业名称不能为空"}`
- 404: `{"error": "用户不存在"}`

---

### PUT /api/users/:id/password

重置指定用户密码（需认证 + 超级管理员）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 用户 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `newPassword` | string | 是 | 新密码，至少 6 位 |

**成功响应** (200)：
```json
{ "success": true, "message": "密码重置成功" }
```

**错误响应**：
- 400: `{"error": "新密码至少 6 位"}`
- 404: `{"error": "用户不存在"}`

---

### DELETE /api/users/:id

删除用户（需认证 + 超级管理员，不能删除自己）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 用户 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "不能删除当前登录用户"}`
- 404: `{"error": "用户不存在"}`

---

## 2. 健康检查 (health)

### GET /api/health

服务健康检查（无需认证）。

**请求参数**：无

**成功响应** (200)：
```json
{
  "status": "ok",
  "time": "2026-07-31T12:00:00.000Z",
  "db": {
    "ready": true,
    "error": null
  }
}
```

- `status`：`ok` 数据库就绪 / `degraded` 数据库异常 / `starting` 初始化中
- `db.ready`：数据库是否可用
- `db.error`：数据库错误信息

---

## 3. 收支流水 (transactions)

### GET /api/transactions

获取收支流水列表（按日期 + ID 倒序，支持筛选）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `unit` | string | 否 | 归属部门筛选（如"生产部"），值为"全部单元"时不筛选 |
| `type` | string | 否 | 收支类型筛选（如"销售收入"） |
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD） |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD） |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "amount": 1280,
    "type": "销售收入",
    "unit": "全公司",
    "customer_id": 1,
    "product_id": null,
    "date": "2026-07-29",
    "note": "面料订单尾款",
    "category": "",
    "contract_id": 1,
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z",
    "customer_name": "张三面料厂",
    "product_name": null,
    "contract_display_name": "2026-07-29-张三面料厂-纯棉T恤",
    "contract_direction": "sale"
  }
]
```

> `contract_display_name` 与 `contract_direction` 为服务端注入的合同拼接名与方向。

---

### POST /api/transactions

新增收支流水。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `amount` | number | 是 | 金额（正数=收入，负数=支出） |
| `type` | string | 是 | 收支类型（如"销售收入"/"材料采购"/"杂费支出"） |
| `date` | string | 是 | 发生日期（YYYY-MM-DD） |
| `unit` | string | 否 | 归属部门，默认"全公司" |
| `customer_id` | number | 否 | 关联客户 ID |
| `product_id` | number | 否 | 关联商品 ID |
| `note` | string | 否 | 备注 |
| `category` | string | 否 | 支出项细分（如"染色费"/"培训费"） |
| `contract_id` | number | 否 | 关联合同 ID |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "缺少必要字段（金额/类型/日期）"}` / `{"error": "客户不存在或无权访问"}` / `{"error": "商品不存在或无权访问"}` / `{"error": "合同不存在或无权访问"}`

> 客户/商品/合同会校验归属，仅允许引用当前账号自己的数据。

---

### PUT /api/transactions/:id

编辑收支流水。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 流水记录 ID |

**请求参数** (JSON Body)：同 POST，所有字段均可选，未传字段保留原值。

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "记录不存在"}`

---

### DELETE /api/transactions/:id

删除收支流水。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 流水记录 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "记录不存在"}`

---

## 4. 支出项细分 (expense-items)

支出项细分，分 `processing`（委托加工类别）和 `misc`（杂费类别），供收支流水录入时联动选择。

### GET /api/expense-items

获取当前账号的支出项细分列表。

**请求参数**：无

**成功响应** (200)：
```json
[
  { "id": 1, "kind": "processing", "name": "染色费", "note": "" },
  { "id": 2, "kind": "misc", "name": "培训费", "note": "" }
]
```

---

### POST /api/expense-items

新增支出项细分。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | string | 是 | 类别：`processing` / `misc` |
| `name` | string | 是 | 细分名称 |
| `note` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "id": 3 }
```

**错误响应**：
- 400: `{"error": "缺少必要字段（类型/名称）"}` / `{"error": "该类别已存在"}`

---

### PUT /api/expense-items/:id

编辑支出项细分。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 支出项 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 细分名称 |
| `note` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "名称必填"}` / `{"error": "该类别已存在"}`
- 404: `{"error": "类别不存在"}`

---

### DELETE /api/expense-items/:id

删除支出项细分。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 支出项 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "类别不存在"}`

---

## 5. 收支类型 (expense-types)

可配置的收支（费用）类型，定义录入时是否需关联客户/商品及细分联动规则。

### GET /api/expense-types

获取收支类型列表。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `direction` | string | 否 | 方向筛选：`income` / `expense` |
| `enabled` | string | 否 | 启用状态筛选：`"true"` 仅启用项 |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "name": "销售收入",
    "direction": "income",
    "link_customer": true,
    "link_product": true,
    "link_cat": "",
    "enabled": true
  },
  {
    "id": 2,
    "name": "材料采购",
    "direction": "expense",
    "link_customer": true,
    "link_product": true,
    "link_cat": "",
    "enabled": true
  },
  {
    "id": 3,
    "name": "委托加工",
    "direction": "expense",
    "link_customer": true,
    "link_product": false,
    "link_cat": "processing",
    "enabled": true
  }
]
```

> 结果按 `direction, id` 排序。

---

### POST /api/expense-types

新增收支类型。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 类型名称 |
| `direction` | string | 是 | 方向：`income` / `expense` |
| `link_customer` | boolean | 否 | 是否关联客户，默认 true |
| `link_product` | boolean | 否 | 是否关联商品，默认 true |
| `link_cat` | string | 否 | 细分联动：`""` / `processing` / `misc` |

**成功响应** (200)：
```json
{ "id": 4 }
```

**错误响应**：
- 400: `{"error": "类型名称必填"}` / `{"error": "方向必须是 income 或 expense"}` / `{"error": "该方向下已存在同名类型"}`

---

### PUT /api/expense-types/:id

编辑收支类型。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 收支类型 ID |

**请求参数** (JSON Body)：所有字段可选。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 类型名称 |
| `direction` | string | 否 | 方向 |
| `link_customer` | boolean | 否 | 是否关联客户 |
| `link_product` | boolean | 否 | 是否关联商品 |
| `link_cat` | string | 否 | 细分联动 |
| `enabled` | boolean | 否 | 是否启用 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "类型名称必填"}` / `{"error": "该方向下已存在同名类型"}`
- 404: `{"error": "类型不存在"}`

---

### DELETE /api/expense-types/:id

删除收支类型。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 收支类型 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "类型不存在"}`

---

## 6. 商品管理 (products)

### GET /api/products

获取商品列表（含库存数量）。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "name": "纯棉T恤",
    "brand": "棉尚",
    "unit": "件",
    "category1": "上衣",
    "category2": "短袖",
    "purchase_price": 25,
    "sale_price": 69,
    "notes": "",
    "warning_threshold": 0,
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z",
    "stock": 320
  }
]
```

> `stock` 为 LEFT JOIN `inventory` 实时计算的库存数量。

---

### POST /api/products

新增商品（同时创建库存记录）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 商品名称 |
| `category1` | string | 是 | 一级分类 |
| `brand` | string | 否 | 品牌 |
| `unit` | string | 否 | 单位，默认"件" |
| `category2` | string | 否 | 二级分类 |
| `purchase_price` | number | 否 | 采购单价，默认 0 |
| `sale_price` | number | 否 | 销售单价，默认 0 |
| `notes` | string | 否 | 备注 |
| `warning_threshold` | number | 否 | 库存预警阈值，默认 0 |
| `initial_stock` | number | 否 | 初始库存数量，默认 0 |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "缺少必要字段（名称/一级分类）"}`

---

### PUT /api/products/:id

编辑商品。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 商品 ID |

**请求参数** (JSON Body)：所有字段可选，未传字段保留原值。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 商品名称 |
| `brand` | string | 否 | 品牌 |
| `unit` | string | 否 | 单位 |
| `category1` | string | 否 | 一级分类 |
| `category2` | string | 否 | 二级分类 |
| `purchase_price` | number | 否 | 采购单价 |
| `sale_price` | number | 否 | 销售单价 |
| `notes` | string | 否 | 备注 |
| `warning_threshold` | number | 否 | 库存预警阈值 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "商品不存在"}`

---

### DELETE /api/products/:id

删除商品。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 商品 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "商品不存在"}`

---

## 7. 客户管理 (customers)

### GET /api/customers

获取客户列表。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "name": "张三面料厂",
    "type": "公司",
    "contact": "138-0000-0001",
    "address": "绍兴柯桥",
    "notes": "",
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z"
  }
]
```

---

### GET /api/customers/summary

获取客户汇总（应收款 + 最近交易日）。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "receivable": 12000,
    "last_transaction_date": "2026-07-29"
  }
]
```

> `receivable` 按销售合同金额 - 已收收入实时计算；`last_transaction_date` 取该客户最近一笔流水日期。

---

### POST /api/customers

新增客户。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 客户名称 |
| `type` | string | 是 | 客户类型（如"个人"/"公司"） |
| `contact` | string | 否 | 联系方式 |
| `address` | string | 否 | 地址 |
| `notes` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "客户名称必填"}` / `{"error": "客户类型必选"}`

---

### PUT /api/customers/:id

编辑客户。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 客户 ID |

**请求参数** (JSON Body)：所有字段可选，未传字段保留原值。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 客户名称 |
| `type` | string | 否 | 客户类型 |
| `contact` | string | 否 | 联系方式 |
| `address` | string | 否 | 地址 |
| `notes` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "客户不存在"}`

---

### DELETE /api/customers/:id

删除客户。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 客户 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "客户不存在"}`

---

## 8. 库存管理 (inventory)

### GET /api/inventory

获取库存列表（关联商品信息）。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "product_id": 1,
    "quantity": 320,
    "avg_price": 25,
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z",
    "updated_at": "2026-07-30T10:00:00.000Z",
    "product_name": "纯棉T恤",
    "category1": "上衣",
    "category2": "短袖",
    "purchase_price": 25,
    "sale_price": 69
  }
]
```

---

### POST /api/inventory

新增或更新库存（同一商品 upsert）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `product_id` | number | 是 | 商品 ID |
| `quantity` | number | 是 | 库存数量 |
| `avg_price` | number | 否 | 平均价格，默认 0 |

**成功响应** (200)：
```json
{ "id": 1 }
```
或（更新已有记录时）：
```json
{ "id": 1, "updated": true }
```

**错误响应**：
- 400: `{"error": "请选择商品"}` / `{"error": "缺少库存数量"}`
- 404: `{"error": "商品不存在"}`

---

### PUT /api/inventory/:id

编辑库存。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 库存记录 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `quantity` | number | 是 | 库存数量 |
| `avg_price` | number | 否 | 平均价格 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "缺少库存数量"}`
- 404: `{"error": "库存记录不存在"}`

---

### DELETE /api/inventory/:id

删除库存记录。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 库存记录 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "库存记录不存在"}`

---

## 9. 合同管理 (contracts)

### GET /api/contracts

获取合同列表（含商品明细 + 服务费明细 + 拼接合同名）。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "contract_no": "",
    "customer_id": 1,
    "amount": 7150,
    "status": "进行中",
    "start_date": "2026-07-03",
    "end_date": "2026-08-20",
    "note": "",
    "date": "2026-07-03",
    "direction": "sale",
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z",
    "customer_name": "张三面料厂",
    "display_name": "2026-07-03-张三面料厂-纯棉T恤等",
    "items": [
      {
        "id": 1,
        "contract_id": 1,
        "product_id": 1,
        "quantity": 100,
        "actual_price": 69,
        "amount": 6900,
        "owner_id": 1,
        "product_name": "纯棉T恤"
      }
    ],
    "services": [
      {
        "id": 1,
        "contract_id": 1,
        "service_id": 1,
        "service_name": "染色服务",
        "amount": 250,
        "owner_id": 1
      }
    ]
  }
]
```

> `display_name` 格式：`日期-客户名-首商品/服务[等]`；`amount` 为明细聚合金额。

---

### POST /api/contracts

新增合同（含商品明细 + 服务费明细）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `customer_id` | number | 是 | 客户 ID |
| `date` | string | 否 | 签订日期（YYYY-MM-DD），默认取 `start_date` |
| `direction` | string | 否 | 方向：`sale` 销售（默认）/ `purchase` 采购 |
| `status` | string | 否 | 状态，默认"进行中" |
| `start_date` | string | 否 | 起始日期 |
| `end_date` | string | 否 | 结束日期 |
| `note` | string | 否 | 备注 |
| `items` | array | 否 | 商品明细数组 |
| `items[].product_id` | number | 是 | 商品 ID |
| `items[].quantity` | number | 是 | 数量 |
| `items[].actual_price` | number | 是 | 实际单价 |
| `services` | array | 否 | 服务费明细数组 |
| `services[].service_id` | number | 否 | 服务 ID（与 `service_name` 二选一） |
| `services[].service_name` | string | 否 | 服务名称（手动填写时使用） |
| `services[].amount` | number | 是 | 服务费金额 |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "请选择客户"}` / `{"error": "客户不存在或无权访问"}`

> 商品/服务会校验归属，跳过非本账号数据；合同金额由明细聚合后自动写入。

---

### PUT /api/contracts/:id

编辑合同（全量替换明细：先删后插）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 合同 ID |

**请求参数** (JSON Body)：基础字段同 POST，所有字段可选。`items` 和 `services` 传数组则全量替换。

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "客户不存在或无权访问"}`
- 404: `{"error": "合同不存在"}`

---

### DELETE /api/contracts/:id

删除合同。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 合同 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "合同不存在"}`

---

## 10. 服务目录 (services)

合同服务费明细可选用的服务项目，每个账号独立维护。

### GET /api/services

获取服务列表（支持名称搜索）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `q` | string | 否 | 服务名称模糊搜索（ILIKE） |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "name": "染色服务",
    "reference_cost": 2.5,
    "note": "按米计费的染色加工"
  }
]
```

---

### POST /api/services

新增服务。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 服务名称 |
| `reference_cost` | number | 否 | 参考成本价，默认 0 |
| `note` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "服务名称必填"}` / `{"error": "该服务已存在"}`

---

### PUT /api/services/:id

编辑服务。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 服务 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 服务名称 |
| `reference_cost` | number | 否 | 参考成本价 |
| `note` | string | 否 | 备注 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "服务名称必填"}` / `{"error": "该服务已存在"}`
- 404: `{"error": "服务不存在"}`

---

### DELETE /api/services/:id

删除服务。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 服务 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "服务不存在"}`

---

## 11. 员工管理 (employees)

### GET /api/employees

获取员工列表。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "name": "张师傅",
    "position": "裁剪工",
    "hourly_rate": 35,
    "join_date": "2024-03-01",
    "status": "active",
    "leave_date": "",
    "owner_id": 1,
    "created_at": "2026-07-28T12:00:00.000Z"
  }
]
```

---

### POST /api/employees

新增员工（同时写入一条"入职"状态变更历史）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 姓名 |
| `position` | string | 否 | 岗位 |
| `hourly_rate` | number | 是 | 时薪（必须 > 0） |
| `join_date` | string | 否 | 入职日期（YYYY-MM-DD） |
| `status` | string | 否 | 状态，默认 `active` |
| `leave_date` | string | 否 | 离职日期（仅 status=`left` 时填写） |

**成功响应** (200)：
```json
{ "id": 2 }
```

**错误响应**：
- 400: `{"error": "姓名必填"}` / `{"error": "时薪必须大于 0"}`

---

### PUT /api/employees/:id

编辑员工基础信息（不改变在职状态，状态变更请用 PATCH）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 员工 ID |

**请求参数** (JSON Body)：所有字段可选。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 姓名 |
| `position` | string | 否 | 岗位 |
| `hourly_rate` | number | 否 | 时薪 |
| `join_date` | string | 否 | 入职日期 |
| `leave_date` | string | 否 | 离职日期 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "员工不存在"}`

> 若 `position`/`hourly_rate`/`join_date` 有变更，会同步刷新最近一条在职状态历史的快照。

---

### PATCH /api/employees/:id/status

标记离职或复职（软状态切换，保留历史数据）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 员工 ID |

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | 是 | 目标状态：`active` 复职 / `left` 离职 |
| `leave_date` | string | 否 | 离职日期（status=`left` 时使用，YYYY-MM-DD） |
| `changed_date` | string | 否 | 变更登记日期（默认取 `leave_date` 或当天） |
| `note` | string | 否 | 备注 |
| `position` | string | 否 | 变更后岗位快照 |
| `hourly_rate` | number | 否 | 变更后时薪快照 |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "status 必须是 active 或 left"}`
- 404: `{"error": "员工不存在"}`

> 变更会自动写入 `employee_status_history`，`change_type` 由旧状态推导（active→left 为"离职"；left→active 为"复职"）。

---

### GET /api/employees/:id/status-history

获取指定员工的状态变更历史（按日期升序）。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 员工 ID |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "employee_id": 1,
    "status": "active",
    "change_type": "入职",
    "position": "裁剪工",
    "hourly_rate": 35,
    "changed_date": "2024-03-01",
    "note": "新增入职",
    "created_at": "2026-07-28T12:00:00.000Z"
  }
]
```

---

### GET /api/employee-status-history-all

获取当前账号所有员工的状态变更历史（前端缓存一次性拉取）。

**请求参数**：无

**成功响应** (200)：格式同 `GET /api/employees/:id/status-history`，按 `employee_id, changed_date, id` 排序。

---

### DELETE /api/employees/:id

删除员工。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 员工 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "员工不存在"}`

---

## 12. 月度工时 (workhours)

### GET /api/workhours

获取月度工时列表。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `month` | string | 否 | 月份筛选（YYYY-MM） |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "employee_id": 1,
    "hours": 80,
    "month": "2026-07",
    "owner_id": 1,
    "employee_name": "张师傅",
    "hourly_rate": 35
  }
]
```

---

### POST /api/workhours

录入或更新月度工时（upsert：同一员工同一月份仅一条）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `employee_id` | number | 是 | 员工 ID |
| `hours` | number | 是 | 工时数（必须 >= 0） |
| `month` | string | 是 | 月份（YYYY-MM） |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 400: `{"error": "员工、工时、月份必填"}` / `{"error": "工时必须为有效正数"}`
- 404: `{"error": "员工不存在"}`

---

### DELETE /api/workhours/:id

删除工时记录。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 工时记录 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "工时记录不存在"}`

---

## 13. 工资管理 (salaries)

### GET /api/salaries

获取工资记录列表。

**请求参数**：无

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "employee_id": 1,
    "amount": 2800,
    "month": "2026-07",
    "owner_id": 1
  }
]
```

---

### POST /api/salaries

新增工资记录。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `employee_id` | number | 否 | 员工 ID |
| `amount` | number | 否 | 工资金额，默认 0 |
| `month` | string | 否 | 月份（YYYY-MM） |

**成功响应** (200)：
```json
{ "id": 1 }
```

**错误响应**：
- 404: `{"error": "员工不存在"}`

---

### DELETE /api/salaries/:id

删除工资记录。

**路径参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | number | 工资记录 ID |

**成功响应** (200)：
```json
{ "success": true }
```

**错误响应**：
- 404: `{"error": "工资记录不存在"}`

---

## 14. 账号设置 (settings)

### GET /api/settings

获取当前账号的所有设置（键值对）。

**请求参数**：无

**成功响应** (200)：
```json
{
  "amoeba_enabled": "true",
  "currency": "¥",
  "export_format": "csv",
  "units": "[\"全公司\",\"销售部\",\"生产部\",\"行政部\"]"
}
```

---

### PUT /api/settings

更新账号设置（支持批量，upsert）。

**请求参数** (JSON Body)：键值对对象，value 为对象时自动 JSON.stringify。

**成功响应** (200)：
```json
{ "success": true }
```

---

## 15. 商品分类预设 (categories)

### GET /api/categories

获取当前账号的商品分类列表（含服装行业默认预设 + 用户自定义）。

**请求参数**：无

**成功响应** (200)：
```json
[
  { "id": 1, "level1": "上衣", "level2": "短袖", "owner_id": 1 },
  { "id": 2, "level1": "上衣", "level2": "长袖", "owner_id": 1 },
  { "id": 3, "level1": "成品面料", "level2": "", "owner_id": 1 }
]
```

> 分类为只读接口，增删改操作不在当前路由范围内。

---

## 16. 示例数据重置 (init)

### POST /api/init/sample

清空当前账号所有业务数据并重新生成完整示例（admin/editor 同款完整数据）。

**请求参数**：无

**成功响应** (200)：
```json
{ "success": true, "message": "示例数据已重置" }
```

> 重置操作按顺序清空以下表：`transactions` → `work_hours` → `salaries` → `contracts` → `services` → `inventory` → `products` → `customers` → `employees` → `categories` → `settings`，然后调用 `seedForUser(uid, 'full')` 重新生成。

---

## 17. 合同候选推荐 (contracts-suggest)

### GET /api/contracts/suggest

推荐合同用于收支流水一键关联。支持按方向、客户筛选，按日期相近度排序。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `direction` | string | 否 | 方向筛选：`sale` / `purchase` |
| `customer_id` | number | 否 | 客户 ID 筛选 |
| `date` | string | 否 | 参考日期，结果按与该日期的接近度排序 |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "display_name": "2026-07-03-张三面料厂-纯棉T恤等",
    "date": "2026-07-03",
    "direction": "sale",
    "customer_name": "张三面料厂"
  }
]
```

> `display_name` 格式：`日期-客户名-首商品/服务[等]`。

---

## 18. 商品分析 (analysis)

### GET /api/analysis/product-sales

销售类商品分析（基于 `transactions.type='销售收入' AND amount>0` 聚合）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：
```json
{
  "total_sale": 12000,
  "total_cost": 8500,
  "total_qty": 100,
  "avg_gm": 0.2917,
  "by_qty": [
    { "product_id": 1, "product_name": "纯棉T恤", "total_qty": 100, "total_amount": 6900 }
  ],
  "by_amount": [
    {
      "product_id": 1,
      "product_name": "纯棉T恤",
      "total_amount": 6900,
      "cost": 2500,
      "gm": 0.6377
    }
  ],
  "price_change": [
    { "product_name": "纯棉T恤", "change": 0.15, "min": 69, "max": 79.35, "samples": 3 }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `total_sale` | 销售额（销售收入正数合计） |
| `total_cost` | 对应采购成本（同期材料采购 abs(amount) 合计） |
| `total_qty` | 销售总数量（来自合同明细聚合） |
| `avg_gm` | 整体毛利率 = (total_sale - total_cost) / total_sale |
| `by_qty` | 按数量排序的 TOP5 商品 |
| `by_amount` | 按金额排序的 TOP5 商品（含每商品成本与毛利率） |
| `price_change` | 价格变动最大的 TOP5 商品（基于合同明细 actual_price 波动） |

---

### GET /api/analysis/product-purchase

采购类商品分析（基于 `transactions.type='材料采购' AND amount<0` 聚合）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：
```json
{
  "total_sale": 8500,
  "total_cost": 8500,
  "total_qty": 200,
  "avg_gm": 0,
  "by_qty": [
    { "product_id": 2, "product_name": "牛仔长裤", "total_qty": 200, "total_amount": 8500 }
  ],
  "by_amount": [
    { "product_id": 2, "product_name": "牛仔长裤", "total_amount": 8500, "cost": 0, "gm": 0 }
  ],
  "price_change": [
    { "product_name": "牛仔长裤", "change": 0.1, "min": 45, "max": 49.5, "samples": 2 }
  ]
}
```

> 采购分析中 `total_cost` 即自身，不计算毛利率。

---

## 19. 驾驶舱聚合 (analysis-cockpit)

### GET /api/analysis/cockpit

小程序「分析 → 驾驶舱」聚合接口。口径严格对齐 PC 端 `calculator.js` 的 `calculateMetrics()` 与 `analysis.js` 的 `detectAlerts()` 默认规则。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |
| `unit` | string | 否 | 单元筛选，传入 `"全部单元"` 或空值表示不过滤 |

**成功响应** (200)：

```json
{
  "kpi": {
    "total_sales": 12800,
    "total_profit": 3200,
    "receivable": 5000,
    "payable": 2000,
    "net_cash_flow": 1800,
    "inventory_value": 12000,
    "profit_rate": 25.0,
    "added_value": 10500,
    "total_hours": 160,
    "total_salary": 5600
  },
  "alerts": [
    {
      "level": "red",
      "title": "客户【张三面料厂】应收 ¥85,000",
      "sub": "超过预警阈值，建议立即跟进回款",
      "value": "¥85,000",
      "jumpTo": "customer"
    },
    {
      "level": "yellow",
      "title": "商品【纯棉T恤】库存呆滞 75 天",
      "sub": "建议盘点/促销/调拨",
      "value": "75 天",
      "jumpTo": "product"
    }
  ],
  "alert_count": {
    "red": 1,
    "yellow": 1
  },
  "tops": [
    {
      "label": "Top 客户贡献",
      "name": "张三面料厂",
      "value": "¥128,000",
      "jumpTo": "customer"
    },
    {
      "label": "Top 商品销售",
      "name": "纯棉T恤",
      "value": "¥69,000",
      "jumpTo": "product"
    },
    {
      "label": "单元附加价值排行",
      "name": "全公司",
      "value": "¥105,000",
      "jumpTo": "amoeba"
    }
  ],
  "unit_hours_available": false
}
```

### kpi 字段说明

| 字段 | 公式 / 说明 |
|---|---|
| `total_sales` | 销售收入（`SUM(CASE WHEN type='销售收入' THEN amount)`） |
| `total_profit` | 总利润 = 附加价值 − 总工资 − 税金 |
| `receivable` | 应收账款 = 销售收入 − 现金收入 |
| `payable` | 应付账款 = 总支出 − 现金支出 |
| `net_cash_flow` | 净现金流 = 现金收入 − 现金支出 |
| `inventory_value` | 库存占用 = Σ(quantity × avg_price) |
| `profit_rate` | 净利率 = (总利润 / 总销售额) × 100，销售额为 0 时返回 0 |
| `added_value` | 附加价值 = 总收入 − 消耗性成本 − 杂费支出 |
| `total_hours` | 区间内在岗员工总工时 |
| `total_salary` | 总工资 = Σ(在岗员工工时 × 时薪) |

### alerts 字段说明

预警按严重程度排序（红色在前，黄色在后），最多返回 10 条。

| 预警类型 | level | 触发条件 | 默认阈值 |
|---|---|---|---|
| 客户应收（红） | `red` | 应收 ≥ 80,000 | `customerRecvRed: 80000` |
| 客户应收（黄） | `yellow` | 应收 ≥ 40,000 | `customerRecvYellow: 40000` |
| 商品毛利率 | `red` | 毛利率 < 15% | `productMargin: 0.15` |
| 库存呆滞 | `yellow` | 库存未更新 > 60 天 | `productStockAge: 60` |
| 净现金流 | `red` | 净现金流 < -20,000 | `cashGap: -20000` |

每条预警对象：

| 字段 | 说明 |
|---|---|
| `level` | 级别：`red` / `yellow` |
| `title` | 预警标题 |
| `sub` | 预警副标题（建议） |
| `value` | 预警数值（已格式化） |
| `jumpTo` | 点击后跳转的分析面板：`customer` / `product` / `overview` |

### tops 字段说明

各维度 Top 1 排行：

| 排行 | `jumpTo` | 说明 |
|---|---|---|
| Top 客户贡献 | `customer` | 按销售收入降序取首位 |
| Top 商品销售 | `product` | 按商品销售金额降序取首位 |
| 单元附加价值排行 | `amoeba` | 按单元附加价值总额降序取首位 |

> `unit_hours_available`：当前恒为 `false`。因 `work_hours` 与 `employees` 表无 `unit` 字段，无法按单元拆分工时，单元排行降级为「附加价值总额」维度。

### alert_count 字段说明

| 字段 | 说明 |
|---|---|
| `red` | 红色预警总数（截断前） |
| `yellow` | 黄色预警总数（截断前） |

> `alert_count` 统计的是截断**前**的预警总数，而 `alerts` 数组最多返回 10 条。

---

## 20. 客户分析聚合 (analysis-customer)

### GET /api/analysis/customer

小程序「分析 → 客户分析」聚合接口（PRD 5.4.2）。口径对齐 PC 端 `public/js/analysis.js` 客户维度逻辑。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：

```json
{
  "kpi": {
    "customer_count": 20,
    "active_count": 8,
    "total_receivable": 85000
  },
  "top5": [
    {
      "customer_id": 3,
      "customer_name": "张三面料厂",
      "sale": 128000,
      "cash": 43000,
      "receivable": 85000,
      "gm": 0.38,
      "last_date": "2026-07-15",
      "age_days": 17
    }
  ],
  "aging": {
    "buckets": { "within30": 50000, "within60": 20000, "over60": 15000 },
    "total": 85000
  },
  "tiers": {
    "list": [ { "name": "张三面料厂", "sale": 128000, "tier": "A" } ],
    "summary": { "A": 4, "B": 8, "C": 8 },
    "amounts": { "A": 380000, "B": 220000, "C": 90000 }
  }
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `kpi.customer_count` | 累计客户数（`customers` 表总数） |
| `kpi.active_count` | 近 90 天有交易的活跃客户数 |
| `kpi.total_receivable` | 应收总额 = 销售收入 − 现金收入 |
| `top5` | Top 5 客户贡献，按销售额降序；每行含销售额、回款额（`cash`）、应收（`sale − cash`）、毛利率（`gm`，0-1 小数）、最近交易日期、账龄（`age_days`，天） |
| `aging.buckets` | 账龄分布：`within30`（≤30 天）/ `within60`（31-60 天）/ `over60`（>60 天），按客户应收金额汇总 |
| `aging.total` | 账龄分布合计 |
| `tiers.list` | 客户分层列表，`tier` 为 `A` / `B` / `C` |
| `tiers.summary` | 各层级客户数量 |
| `tiers.amounts` | 各层级客户销售贡献金额 |

> 客户分层按帕累托原则：A 类累计销售贡献前 20%，B 类 20%-50%，C 类其余。
>
> 账龄按「最近一次交易日期」距今的自然日数计算（本地时区）。

---

## 21. 商品分析聚合 (analysis-product)

### GET /api/analysis/product

小程序「分析 → 商品分析」聚合接口（PRD 5.4.3）。复用 PC 端 `productAnalysis()` 销售分析结果，叠加库存与预警。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：

```json
{
  "kpi": {
    "sku_count": 30,
    "inventory_value": 120000,
    "avg_gm": 0.32
  },
  "top_products": [
    {
      "product_id": 1,
      "product_name": "纯棉T恤",
      "sale": 69000,
      "gm": 0.64,
      "stock": 120,
      "turnover_days": 45
    }
  ],
  "alerts": [
    { "level": "red", "product_name": "C型耗材", "product_id": 8, "reason": "毛利率 10.0% 跌破 15%", "type": "low_margin" }
  ],
  "alert_count": { "red": 2, "yellow": 1 }
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `kpi.sku_count` | 在售商品 SKU 数（`products` 表总数） |
| `kpi.inventory_value` | 库存占用 = Σ(quantity × avg_price) |
| `kpi.avg_gm` | 平均毛利率（复用销售分析，0-1 小数） |
| `top_products` | Top 10 商品销售，按销售额降序；每行含销售额、毛利率（`gm`）、当前库存（`stock`）、周转天数（`turnover_days` = 库存 / 日均销售额） |
| `alerts` | 库存预警列表，红前黄后；`type`：`low_margin`（低毛利）/ `low_stock`（缺货）/ `slow_turnover`（呆滞） |
| `alert_count` | 红/黄预警条数 |

**预警规则**：

| 类型 | level | 触发条件 | 默认阈值 |
|---|---|---|---|
| 低毛利 | `red` | 毛利率 < 15% | `MARGIN_THRESHOLD = 0.15` |
| 缺货 | `red` | 库存 ≤ 安全库存阈值 | `warning_threshold` 字段 |
| 呆滞 | `yellow` | 周转天数 > 90 天 | 90 |

---

## 22. 合同分析聚合 (analysis-contract)

### GET /api/analysis/contract

小程序「分析 → 合同分析」聚合接口（PRD 5.4.4）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：

```json
{
  "kpi": {
    "total_amount": 200000,
    "execution_rate": 0.42,
    "unpaid_amount": 116000,
    "status_summary": {
      "in_progress": { "count": 5, "amount": 120000 },
      "completed": { "count": 3, "amount": 60000 },
      "dunning": { "count": 1, "amount": 20000 }
    }
  },
  "contracts": [
    {
      "id": 12,
      "customer_name": "张三面料厂",
      "date": "2026-07-10",
      "amount": 50000,
      "paid": 20000,
      "unpaid": 30000,
      "status": "进行中",
      "age_days": 22
    }
  ]
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `kpi.total_amount` | 本期签约合同总额 |
| `kpi.execution_rate` | 执行率 = 已回款 / 合同金额（0-1 小数） |
| `kpi.unpaid_amount` | 未回款金额 = max(0, 合同总额 − 已回款) |
| `kpi.status_summary` | 按状态汇总：`in_progress`（进行中）/ `completed`（已完成）/ `cancelled`（已取消），各含 count 与 amount |
| `contracts` | 合同执行列表，按 id 降序；每行含客户、金额、已回款（`paid`，限定在所选日期范围）、未回款（`unpaid`）、状态、账龄（`age_days`，天） |

> 回款统计与 KPI 保持一致，均限定在所选日期范围内；账龄按最近一次回款日期（无回款则为合同签订日）距今计算。

---

## 23. 费用分析聚合 (analysis-expense)

### GET /api/analysis/expense

小程序「分析 → 费用分析」聚合接口（PRD 5.4.5）。视觉统一使用绿色语义（支出/反向）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：

```json
{
  "compose": [
    { "name": "材料采购", "amount": 80000 },
    { "name": "杂费支出", "amount": 15000 }
  ],
  "total_expense": 95000,
  "trend": [
    { "month": "2026-02", "amount": 70000 },
    { "month": "2026-03", "amount": 82000 },
    { "month": "2026-04", "amount": 76000 },
    { "month": "2026-05", "amount": 90000 },
    { "month": "2026-06", "amount": 88000 },
    { "month": "2026-07", "amount": 95000 }
  ],
  "units": [
    { "unit": "销售单元", "amount": 40000 },
    { "unit": "生产单元", "amount": 35000 }
  ],
  "unit_total": 75000
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `compose` | 费用构成列表，按支出金额降序；每项含类别名称（`name`）与金额（`amount`） |
| `total_expense` | 本期总支出 |
| `trend` | 近 6 个月逐月支出趋势，`month` 格式 `YYYY-MM` |
| `units` | 各阿米巴单元费用，按金额降序；`unit` 为 `COALESCE(unit, '全公司')` |
| `unit_total` | 单元费用合计 |

> 费用构成基于 `transactions.amount < 0` 的支出类交易（材料采购、委托加工、杂费支出、税金、现金支出等），按 `ABS(amount)` 汇总。
>
> 趋势按月取「当月 1 日至当月最后一日」（本地时区）。

---

## 24. 阿米巴核算聚合 (analysis-amoeba)

### GET /api/analysis/amoeba

小程序「分析 → 阿米巴核算」聚合接口（PRD 5.4.6）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `startDate` | string | 否 | 起始日期（YYYY-MM-DD），默认无下限 |
| `endDate` | string | 否 | 结束日期（YYYY-MM-DD），默认无上限 |

**成功响应** (200)：

```json
{
  "kpi": {
    "added_value": 105000,
    "total_hours": 1600,
    "hourly_labor_cost": 15.5,
    "breakeven": 80200
  },
  "hourly_added_value": 65.625,
  "prev_hourly_added_value": 62.1,
  "unit_values": [
    { "unit": "销售单元", "added_value": 60000 },
    { "unit": "生产单元", "added_value": 30000 }
  ],
  "unit_contribs": [
    {
      "unit": "销售单元",
      "sales": 150000,
      "expense": 60000,
      "added_value": 60000,
      "hours": null,
      "hourly_value": null
    }
  ],
  "unit_hours_available": false
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `kpi.added_value` | 附加价值总额 = 总收入（销售收入+现金收入+其他收入） − 消耗成本（材料采购+委托加工） − 杂费支出 |
| `kpi.total_hours` | 总劳动时间 = 在岗员工工时合计 |
| `kpi.hourly_labor_cost` | 单位时间劳务费 = 总劳务费 / 总工时 |
| `kpi.breakeven` | 盈亏临界 = 附加值 − 劳务费，盈余为正 |
| `hourly_added_value` | 本月整体单位时间附加值 = 附加价值 / 总劳动时间（¥/人·小时） |
| `prev_hourly_added_value` | 上月单位时间附加值，无上月数据时为 `null` |
| `unit_values` | 各单元附加价值（因工时无单元字段，降级为附加价值总额） |
| `unit_contribs` | 单元总贡献：销售额、经费（材料+加工+杂费）、附加价值总额；`hours` / `hourly_value` 因 `work_hours` 无单元字段恒为 `null` |
| `unit_hours_available` | 单元工时是否可用，当前恒为 `false` |

---

## 25. 汇率查询 (exchange)

### GET /api/exchange/rate

获取实时汇率（1 小时缓存，离线降级到内置参考汇率）。

**请求参数** (Query String)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `base` | string | 否 | 基准货币（如 CNY/USD/EUR），默认 `CNY` |

**成功响应** (200)：
```json
{
  "base": "CNY",
  "rates": {
    "CNY": 1,
    "USD": 0.1475,
    "EUR": 0.1288
  },
  "date": "2026-07-31",
  "source": "欧洲央行 (Frankfurter API)",
  "isRealtime": true
}
```

| 字段 | 说明 |
|---|---|
| `isRealtime` | `true` 实时汇率 / `false` 离线降级 |
| `source` | 汇率数据来源 |
| `rates` | 各货币对基准货币的汇率 |

> 数据来源为 Frankfurter API（欧洲央行），5 秒超时后自动降级到内置参考汇率。

---

## 26. AI 对话 (ai)

### POST /api/ai/chat

SSE 流式 AI 对话（Server-Sent Events）。

**请求参数** (JSON Body)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `messages` | array | 是 | 对话消息数组，每项含 `role`（system/user/assistant）和 `content` |

**请求示例**：
```json
{
  "messages": [
    { "role": "user", "content": "本月销售额是多少？" }
  ]
}
```

**响应格式** (SSE 事件流)：
```
event: start
data: {"userId":1}

event: text
data: {"text":"本月"}

event: text
data: {"text":"销售额为"}

event: tool_start
data: {"name":"queryTransactions"}

event: tool_end
data: {"name":"queryTransactions","success":true,"message":"","data":[...]}

event: text
data: {"text":"12,800 元"}

event: done
data: {}
```

| SSE 事件 | 说明 |
|---|---|
| `start` | 对话开始，含当前用户 ID |
| `text` | AI 逐字输出文本 |
| `tool_start` | 开始调用工具（如查询流水/客户等） |
| `tool_end` | 工具调用完成，含 `success`/`message`/`data` |
| `done` | 对话完成 |
| `error` | 发生错误，含 `message` |

---

### POST /api/ai/chat-sync

非流式 AI 对话（一次性返回完整结果）。

**请求参数** (JSON Body)：同 `/api/ai/chat`。

**成功响应** (200)：
```json
{
  "text": "本月销售额为 12,800 元。",
  "toolCalls": [...]
}
```

**错误响应**：
- 400: `{"error": "缺少消息内容"}`
- 500: `{"error": "AI 服务暂时不可用：..."}`

---

## 附录：全局说明

### 认证
- 除 `/api/auth/login` 和 `/api/health` 外，所有业务接口需携带 JWT Token
- Token 格式：`Authorization: Bearer <token>`
- 登录接口无需认证

### 多租户隔离
- 所有业务数据按 `owner_id`（即 `req.user.id`）隔离
- 各账号只能访问自己的数据
- 客户/商品/合同引用时会校验归属，防止跨账号引用

### 数据校验
- 所有写入接口均校验必填字段
- 外键引用均校验目标数据是否存在且属于当前账号
- 金额类字段使用 REAL 类型

### 错误响应格式
- 400：参数错误 / 业务校验失败
- 401：未登录 / Token 过期
- 403：权限不足
- 404：资源不存在
- 500：服务器内部错误
