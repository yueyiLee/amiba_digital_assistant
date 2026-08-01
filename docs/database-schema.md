# 数据库表结构说明

> 本文件根据 `amiba_digital_assistant/db.js`（建表 SQL + 迁移函数）与 `routes/` 业务逻辑整理，覆盖系统当前所有 PostgreSQL 表与字段。
>
> **多租户隔离**：除 `users` 外，所有业务表均含 `owner_id` 列，指向 `users(id)`，实现"一个账号一套数据"的隔离。首次启动会创建 `admin` / `editor` 两个种子账号并各自生成示例数据；历史无主数据会迁移归属到 `admin`。

---

## 1. `users` — 用户（账号）

账号表，承载登录认证与企业身份。所有登录用户默认拥有管理员权限；仅 `admin` 超级账号可管理其他账号。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `username` | TEXT | UNIQUE NOT NULL | 登录用户名，全局唯一 |
| `password_hash` | TEXT | NOT NULL | bcrypt 哈希后的密码（10 轮盐） |
| `display_name` | TEXT | DEFAULT '' | 显示名（如"系统管理员"） |
| `role` | TEXT | DEFAULT 'viewer' | 角色标记；当前业务中所有登录用户均视为 admin，仅作历史保留 |
| `company_name` | TEXT | NOT NULL DEFAULT '' | 账号绑定的唯一企业名称（老库通过 `ensureUserCompanyNameColumn` 补列） |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |

---

## 2. `customers` — 客户

客户 / 供应商档案，按 `owner_id` 隔离。合同与收支流水通过外键引用本表。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `name` | TEXT | NOT NULL | 客户名称（必填） |
| `type` | TEXT | DEFAULT '个人' | 客户类型，如"个人"/"公司" |
| `contact` | TEXT | DEFAULT '' | 联系方式 |
| `address` | TEXT | DEFAULT '' | 地址 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |
| `notes` | TEXT | DEFAULT '' | 备注（业务路由使用，建表 SQL 未显式声明，运行时按需存在） |

> 业务接口 `/customers/summary` 会实时按 `contracts(direction='sale')` 与 `transactions(amount>0)` 计算每客户的应收款与最近交易日。

---

## 3. `products` — 商品

商品 / 物料档案，关联库存表。服装行业默认分类由 `categories` 预设提供。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `name` | TEXT | NOT NULL | 商品名称（必填） |
| `brand` | TEXT | DEFAULT '' | 品牌 |
| `unit` | TEXT | DEFAULT '件' | 计量单位 |
| `category1` | TEXT | DEFAULT '' | 一级分类（必填，如"上衣"/"裤子"） |
| `category2` | TEXT | DEFAULT '' | 二级分类（如"短袖"/"牛仔裤"，成品面料留空） |
| `purchase_price` | REAL | DEFAULT 0 | 采购单价 |
| `sale_price` | REAL | DEFAULT 0 | 销售单价 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |
| `notes` | TEXT | DEFAULT '' | 备注（业务路由使用） |
| `warning_threshold` | REAL | DEFAULT 0 | 库存预警阈值（业务路由使用） |

---

## 4. `inventory` — 库存

每个商品在每个账号下唯一一条库存记录（按 `product_id + owner_id` upsert）。记录数量与移动加权平均价。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `product_id` | INTEGER | REFERENCES products(id) ON DELETE CASCADE | 商品 ID |
| `quantity` | REAL | DEFAULT 0 | 库存数量 |
| `avg_price` | REAL | DEFAULT 0 | 移动加权平均价（用于成本核算） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间（老库 `ensureInventoryColumns` 补列） |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | 最后编辑时间，库存变动时刷新 |

---

## 5. `contracts` — 合同

销售 / 采购合同主表，金额由 `contract_items` + `contract_services` 明细聚合。合同名采用"日期-客户-商品/服务"拼接形式展示。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `contract_no` | TEXT | NOT NULL | 合同编号；新版合同由明细拼接展示名，此字段留空 |
| `customer_id` | INTEGER | REFERENCES customers(id) ON DELETE SET NULL | 关联客户 |
| `amount` | REAL | DEFAULT 0 | 合同总金额（由明细聚合写入） |
| `status` | TEXT | DEFAULT '进行中' | 状态，如"进行中"/"已完成" |
| `start_date` | TEXT | DEFAULT '' | 起始日期（TEXT 形式 YYYY-MM-DD） |
| `end_date` | TEXT | DEFAULT '' | 结束日期 |
| `note` | TEXT | DEFAULT '' | 备注 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |
| `date` | TEXT | DEFAULT '' | 签订日，用于拼接合同名（`ensureContractUpgradeColumns` 补列；老合同用 `start_date` 兜底） |
| `direction` | TEXT | DEFAULT 'sale' | 方向：`sale` 销售 / `purchase` 采购（`ensureContractUpgradeColumns` 补列） |

---

## 6. `contract_items` — 合同商品明细

合同下的商品行项，数量 × 实际单价 = 行金额。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `contract_id` | INTEGER | REFERENCES contracts(id) ON DELETE CASCADE | 所属合同 |
| `product_id` | INTEGER | REFERENCES products(id) ON DELETE SET NULL | 商品 ID |
| `quantity` | REAL | DEFAULT 0 | 数量 |
| `actual_price` | REAL | DEFAULT 0 | 实际成交单价（可能与商品标价不同） |
| `amount` | REAL | DEFAULT 0 | 行金额 = quantity × actual_price |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |

---

## 7. `contract_services` — 合同服务费明细

合同下的服务费行项（如染色、设计、物流）。与 `expense_items`（支出项细分）是两套独立数据，勿混用。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `contract_id` | INTEGER | REFERENCES contracts(id) ON DELETE CASCADE | 所属合同 |
| `service_id` | INTEGER | REFERENCES services(id) ON DELETE SET NULL | 关联服务（可空，允许手动填 `service_name`） |
| `service_name` | TEXT | DEFAULT '' | 服务名称（冗余存储，便于删除服务后仍保留历史名） |
| `amount` | REAL | DEFAULT 0 | 服务费金额 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |

---

## 8. `services` — 服务目录

可复用的服务项目档案，供合同服务费明细选择。每个账号独立维护，名称不可重复。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `name` | TEXT | NOT NULL | 服务名称（必填，同账号内唯一） |
| `reference_cost` | REAL | DEFAULT 0 | 参考成本价 |
| `note` | TEXT | DEFAULT '' | 备注 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |

---

## 9. `employees` — 员工

员工档案，含岗位、时薪、入离职状态。状态变更通过 `PATCH /employees/:id/status` 单独处理，写入 `employee_status_history`。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `name` | TEXT | NOT NULL | 姓名（必填） |
| `position` | TEXT | DEFAULT '' | 岗位 |
| `hourly_rate` | REAL | DEFAULT 0 | 时薪（必须 > 0） |
| `join_date` | TEXT | DEFAULT '' | 入职日期（YYYY-MM-DD） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |
| `status` | TEXT | DEFAULT 'active' | 在职状态：`active` 在职 / `left` 离职（`ensureEmployeeStatusColumns` 补列） |
| `leave_date` | TEXT | DEFAULT '' | 离职日期（`ensureEmployeeStatusColumns` 补列；在职时为空） |

---

## 10. `employee_status_history` — 员工状态变更历史

记录员工的入职 / 离职 / 复职时间线，用于按月在岗判断（工时统计时排除离职区间）与"入离职记录"页展示。每条记录快照变更后的岗位与时薪。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `employee_id` | INTEGER | REFERENCES employees(id) ON DELETE CASCADE | 关联员工 |
| `status` | TEXT | NOT NULL | 变更后状态：`active` / `left` |
| `change_type` | TEXT | DEFAULT '' | 变更类型：`入职` / `离职` / `复职`（`ensureEmployeeStatusHistoryColumns` 补列） |
| `position` | TEXT | DEFAULT '' | 变更后岗位快照（离职则为空） |
| `hourly_rate` | REAL | DEFAULT 0 | 变更后时薪快照（离职则为 0） |
| `changed_date` | TEXT | NOT NULL | 变更登记日期（YYYY-MM-DD） |
| `note` | TEXT | DEFAULT '' | 备注 |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 记录创建时间 |

> 老数据回填（`ensureEmployeeStatusHistoryBackfill`）：对功能上线前已存在但无历史记录的员工，依据 `employees.status/leave_date/join_date` 反推补全；对缺 `change_type` 的旧行按序列推导。

---

## 11. `work_hours` — 月度工时

员工按月的工时记录，按 `(employee_id, month)` 唯一，支持 upsert。工时 × 时薪用于工资核算。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `employee_id` | INTEGER | REFERENCES employees(id) ON DELETE CASCADE | 关联员工 |
| `hours` | REAL | DEFAULT 0 | 当月工时数 |
| `month` | TEXT | NOT NULL | 月份（YYYY-MM） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| | | UNIQUE(employee_id, month) | 同一员工同一月份仅一条 |

---

## 12. `salaries` — 工资

员工工资发放记录。可关联合同或独立记录。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `employee_id` | INTEGER | REFERENCES employees(id) ON DELETE CASCADE | 关联员工 |
| `amount` | REAL | DEFAULT 0 | 工资金额 |
| `month` | TEXT | DEFAULT '' | 所属月份（YYYY-MM） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |

---

## 13. `transactions` — 收支流水

核心财务流水表。`amount` 正数为收入、负数为支出；`type` 引用 `expense_types` 的名称。可关联客户、商品、合同。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `amount` | REAL | NOT NULL | 金额（正=收入，负=支出） |
| `type` | TEXT | NOT NULL | 收支类型名称（如"销售收入"/"材料采购"/"委托加工"/"杂费支出"/"税金"） |
| `unit` | TEXT | DEFAULT '全公司' | 归属部门 / 单元 |
| `customer_id` | INTEGER | REFERENCES customers(id) ON DELETE SET NULL | 关联客户（收入/采购类必填） |
| `product_id` | INTEGER | REFERENCES products(id) ON DELETE SET NULL | 关联商品 |
| `date` | TEXT | NOT NULL | 发生日期（YYYY-MM-DD） |
| `note` | TEXT | DEFAULT '' | 备注 |
| `category` | TEXT | DEFAULT '' | 支出项细分：委托加工类别 / 杂费类别（`ensureTransactionCategoryColumn` 补列） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 创建时间 |
| `contract_id` | INTEGER | REFERENCES contracts(id) ON DELETE SET NULL | 关联合同（`ensureContractUpgradeColumns` 补列，批4 录入使用） |

> 商品分析（`/analysis/product-sales`、`/analysis/product-purchase`）基于本表的 `type` + `amount` + `product_id` 聚合，数量与价格变动则走 `contract_items`。

---

## 14. `settings` — 账号设置

每个账号独立的基础设置，键值对存储。复合主键 `(owner_id, key)`。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `owner_id` | INTEGER | NOT NULL, REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| `key` | TEXT | NOT NULL | 设置键（如 `amoeba_enabled`/`currency`/`export_format`/`units`） |
| `value` | TEXT | DEFAULT '' | 设置值（对象类存 JSON 字符串） |
| | | PRIMARY KEY(owner_id, key) | 复合主键 |

---

## 15. `categories` — 商品分类预设

服装行业默认分类（上衣/裤子/外套/裙装/针织/配饰/原材料/成品面料），每个账号自动拥有，支持自定义增删。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `level1` | TEXT | NOT NULL | 一级分类（如"上衣"） |
| `level2` | TEXT | DEFAULT '' | 二级分类（如"短袖"；成品面料留空） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |

---

## 16. `expense_items` — 支出项细分预设

后台配置的支出项细分，供"委托加工"/"杂费支出"类流水联动选择。与 `services` 是两套独立数据。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `kind` | TEXT | NOT NULL | 类别：`processing` 委托加工 / `misc` 杂费 |
| `name` | TEXT | NOT NULL | 细分名称（如"染色费"/"培训费"） |
| `note` | TEXT | DEFAULT '' | 备注（`ensureExpenseItemNoteColumn` 补列） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |

> 预设项（`DEFAULT_EXPENSE_ITEMS`）会为每个账号逐条补全，不删除用户自定义项。

---

## 17. `expense_types` — 收支类型

可配置的收支（费用）类型，定义录入时的联动规则与启停状态。录入流水时 `transactions.type` 引用此表 `name`。

| 列名 | 类型 | 约束 / 默认 | 描述 |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | 主键 |
| `name` | TEXT | NOT NULL | 类型名称（如"销售收入"/"材料采购"/"委托加工"/"杂费支出"/"税金"） |
| `direction` | TEXT | NOT NULL DEFAULT 'expense' | 方向：`income` 收入 / `expense` 支出 |
| `link_customer` | BOOLEAN | DEFAULT TRUE | 是否需关联客户 |
| `link_product` | BOOLEAN | DEFAULT TRUE | 是否需关联商品 |
| `link_cat` | TEXT | DEFAULT '' | 细分联动：`''` 无 / `processing` 委托加工类别 / `misc` 杂费类别 |
| `enabled` | BOOLEAN | DEFAULT TRUE | 是否启用 |
| `parent_id` | INTEGER | | 父类型 ID（预留，当前未使用） |
| `owner_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | 归属账号 |
| | | UNIQUE(owner_id, name, direction) | 同账号同方向下名称唯一 |

> 预设类型（`DEFAULT_EXPENSE_TYPES`）每个账号自动拥有；"税金"类型经批14迁移后 `link_customer=FALSE, link_product=FALSE`。

---

## 表关系总览

```
users
  ├── customers ──┬── contracts ──┬── contract_items ── products
  │               │               └── contract_services ── services
  │               └── transactions
  ├── products ──── inventory
  ├── employees ──┬── work_hours
  │               └── employee_status_history
  │               └── salaries
  ├── transactions ── (customers / products / contracts)
  ├── settings
  ├── categories
  ├── expense_items
  ├── expense_types
  └── services
```

## 初始化与迁移流程（`db.init`）

1. **建表**：执行 `INIT_TABLES_SQL`（17 张表，逐条幂等创建）
2. **补列迁移**（老库兼容，均幂等）：
   - `ensureOwnerColumns`：业务表补 `owner_id`
   - `ensureInventoryColumns`：`inventory` 补 `created_at`/`updated_at`
   - `ensureTransactionCategoryColumn`：`transactions` 补 `category`
   - `ensureExpenseItemNoteColumn`：`expense_items` 补 `note`
   - `ensureEmployeeStatusColumns`：`employees` 补 `status`/`leave_date`
   - `ensureEmployeeStatusHistoryColumns`：`employee_status_history` 补 `change_type`/`position`/`hourly_rate`
   - `ensureEmployeeStatusHistoryBackfill`：老员工状态历史回填
   - `ensureUserCompanyNameColumn`：`users` 补 `company_name`
   - `ensureContractUpgradeColumns`：建 `services`/`contract_items`/`contract_services`，`transactions` 补 `contract_id`，`contracts` 补 `date`/`direction`
3. **数据迁移**：`migrateLegacyData`（无主数据归 admin，editor 重新生成）→ `fixSettingsPkey`（改复合主键）
4. **预设补全**：分类 / 支出项 / 收支类型 逐账号补全；税金联动规则修正
5. **种子账号**：无用户时创建 `admin`/`editor`，各生成完整示例（`seedForUser(uid, 'full')`）
6. **修复孤立归属**：`fixOrphanedOwners` 把 `owner_id` 指向不存在用户的数据归回 admin
