/**
 * db.ts — PostgreSQL 数据库连接与初始化（CloudBase 云函数兼容版）
 *
 * 双模式：
 *  - 云端（检测到 TENCENTCLOUD_SECRETID 等运行时临时密钥）：走 CloudBase manager-node 的
 *    executePGSql 访问环境内置 PostgreSQL（无需 pg 原生 TCP，也无需任何显式密钥）。
 *  - 本地 / 其他环境：走 pg 原生连接池（保持原有行为，便于本地开发）。
 *
 * 对上层暴露的接口（query / queryOne / queryAll / init）保持不变，路由层无需改动。
 */
import { Pool, QueryResult as PgQueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import type { DbStatus, DiagResult, UserRow, QueryResult } from './types/db';

const hasCloudCreds: boolean = !!(
  process.env.TENCENTCLOUD_SECRETID &&
  process.env.TENCENTCLOUD_SECRETKEY
);

// 是否通过环境变量显式配置了原生 PostgreSQL 连接
const hasNativePgConfig: boolean = !!(process.env.DATABASE_URL || process.env.PG_HOST || process.env.PG_DATABASE);

// 若显式配置了外部 PG 地址（非内置模板占位），一律走 pg 原生直连。
const DIRECT_PG: boolean = !!(
  process.env.PG_HOST &&
  process.env.PG_HOST !== '{{envId}}.pg.rdb.cloud.tencent.com' &&
  process.env.PG_HOST.indexOf('rdb.cloud.tencent.com') === -1
);
const ENV: string = process.env.SCF_NAMESPACE || process.env.TCB_ENV || 'amiba-d3gk34ae899822073';

/**
 * 统一判断是否应走云端 executePGSql 路径。
 * 保持与原始 db.js 一致的逻辑：仅当未显式配置原生 PG 且存在云端凭据时才走云端。
 * query / insertReturning 均使用此函数。
 */
function shouldUseCloud(): boolean {
  return !hasNativePgConfig && (!!cloudApp || hasCloudCreds);
}

/**
 * 判断 insertReturning 是否走云端（与 query 略有不同：DIRECT_PG 模式下也强制走原生）。
 * 原始逻辑：!DIRECT_PG && (cloudApp || hasCloudCreds)
 */
function shouldInsertReturningUseCloud(): boolean {
  return !DIRECT_PG && (!!cloudApp || hasCloudCreds);
}

// ===== 初始化状态（供 /api/health 暴露，无需 CLS 也能观测）=====
let dbReady = false;
let dbError: string | null = null;
function setDbStatus(ready: boolean, error?: string): void {
  dbReady = ready;
  dbError = error || null;
}
function getStatus(): DbStatus {
  return { ready: dbReady, error: dbError };
}

// 诊断信息：暴露容器内关键环境变量是否存在（不暴露取值），便于排查连接问题
function diag(): DiagResult {
  const relevant: string[] = Object.keys(process.env).filter((k: string) =>
    /^(TENCENTCLOUD_|TCB_|SCF_|PG|POSTGRES|DATABASE|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGPORT)/i.test(k)
  );
  return {
    mode: hasNativePgConfig ? 'native-pg' : (hasCloudCreds ? 'cloud-executePGSql' : 'native-local'),
    hasCloudCreds,
    hasNativePgConfig,
    envId: ENV,
    poolConnected: pool.totalCount > 0,
    envKeys: relevant,
  };
}

// 服装行业默认商品分类（系统预设，所有账号同步拥有，便于直接录入商品）
const DEFAULT_CATEGORIES: [string, string][] = [
  ['上衣', '短袖'], ['上衣', '长袖'], ['上衣', '卫衣'], ['上衣', '衬衫'],
  ['裤子', '牛仔裤'], ['裤子', '休闲裤'], ['裤子', '西裤'],
  ['外套', '风衣'], ['外套', '棉服'], ['外套', '羽绒服'],
  ['裙装', '连衣裙'], ['裙装', '半身裙'],
  ['针织', '毛衣'], ['针织', '针织衫'],
  ['配饰', '皮带'], ['配饰', '帽子'], ['配饰', '围巾'], ['配饰', '袜子'],
  ['原材料', '纱线'], ['原材料', '坯布'],
  ['成品面料', ''],
];

// 支出项细分预设
const DEFAULT_EXPENSE_ITEMS: [string, string][] = [
  ['processing', '染色费'], ['processing', '制造费用'], ['processing', '后整理费'],
  ['misc', '培训费'], ['misc', '差旅费'], ['misc', '水电费'], ['misc', '维修费用'],
  ['misc', '产品运营费用'], ['misc', '车辆费用'], ['misc', '库存利息'], ['misc', '其他管理杂费'],
  ['misc', '医保社保保费'], ['misc', '门店租金'], ['misc', '物业费'],
  ['misc', '机器设备折旧费'], ['misc', '财务费用'], ['misc', '预提所得税'],
];

// 收支类型预设
const DEFAULT_EXPENSE_TYPES: [string, string, boolean, boolean, string][] = [
  ['材料采购', 'expense', true, true, ''],
  ['委托加工', 'expense', true, false, 'processing'],
  ['杂费支出', 'expense', false, false, 'misc'],
  ['税金', 'expense', false, false, ''],
  ['现金支出', 'expense', true, true, ''],
  ['销售收入', 'income', true, true, ''],
  ['现金收入', 'income', true, true, ''],
  ['其他收入', 'income', true, true, ''],
];

// 云端 SDK 客户端延迟创建（不在模块加载时缓存）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cloudApp: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCloudApp(): any {
  if (!cloudApp) {
    const CloudBase = require('@cloudbase/manager-node');
    cloudApp = CloudBase.init({
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN,
      envId: ENV,
    });
    console.log('[DB] 使用 CloudBase executePGSql 访问内置 PostgreSQL');
  }
  return cloudApp;
}

async function cloudQuery(Sql: string): Promise<Record<string, unknown>> {
  let app = getCloudApp();
  try {
    const result = await app.database.executePGSql({ EnvId: ENV, Sql });
    return result as unknown as Record<string, unknown>;
  } catch (e: unknown) {
    const errMsg: string = e instanceof Error ? e.message : String(e || '');
    const m: string = errMsg.toLowerCase();

    // 区分可重试的凭证/认证错误与不可重试的 SQL 语法/业务错误
    const isAuthError = m.includes('secretid') || m.includes('secretkey') || m.includes('token') ||
      m.includes('expired') || m.includes('credential') || m.includes('auth');
    const isSyntaxError = m.includes('syntax') || m.includes('parse error') || m.includes('column') ||
      m.includes('relation') || m.includes('violates');

    if (isAuthError && !isSyntaxError) {
      console.warn('[DB] 凭证疑似过期，重建 SDK 客户端并重试:', errMsg);
      cloudApp = null;
      app = getCloudApp();
      return (await app.database.executePGSql({ EnvId: ENV, Sql })) as unknown as Record<string, unknown>;
    }
    throw e;
  }
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = process.env.DATABASE_URL
      ? new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      })
      : new Pool({
        user: process.env.PG_USER || process.env.PGUSER || 'amoeba',
        host: process.env.PG_HOST || process.env.PGHOST || 'localhost',
        database: process.env.PG_DATABASE || process.env.PGDATABASE || 'amoeba_app',
        password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'amoeba123',
        port: parseInt(process.env.PG_PORT || process.env.PGPORT || '5432', 10),
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
  }
  return _pool;
}

// 对外保留 pool 引用（diag 等需要），但通过 getter 访问
const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop: string | symbol) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ===== 云端适配：executePGSql 的结果 → { rows: [{ col: val }] } =====
function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  const t: string = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) {
    const n: number = Number(t);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return v;
}

interface CloudBaseQueryResponse {
  Columns?: string[];
  Rows?: string[];
}

interface AdaptedQueryResult {
  rows: Record<string, unknown>[];
}

function adapt(res: CloudBaseQueryResponse): AdaptedQueryResult {
  const cols: string[] = (res && res.Columns) || [];
  const rows: Record<string, unknown>[] = ((res && res.Rows) || []).map((s: string) => {
    let arr: unknown[] = [];
    try { arr = JSON.parse(s); } catch (_e: unknown) { arr = []; }
    const obj: Record<string, unknown> = {};
    cols.forEach((c: string, i: number) => { obj[c] = coerce(arr[i]); });
    return obj;
  });
  return { rows };
}

// pg 风格 $1/$2 参数 → 安全的 SQL 字面量
function quote(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function bind(text: string, params?: unknown[]): string {
  if (!params || params.length === 0) return text;
  return text.replace(/\$(\d+)/g, (_m: string, i: string) => quote(params[Number(i) - 1]));
}

async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  if (shouldUseCloud()) {
    const res = await cloudQuery(bind(text, params));
    return adapt(res as unknown as CloudBaseQueryResponse);
  }
  const result: PgQueryResult = await getPool().query(text, params);
  return result;
}

async function insertReturning(text: string, params?: unknown[]): Promise<QueryResult> {
  if (shouldInsertReturningUseCloud()) {
    // 使用 dotAll 模式匹配跨行 RETURNING 子句
    const insertPart: string = text.replace(/\s+RETURNING\s+.*$/is, '');
    await cloudQuery(bind(insertPart, params));
    const tableMatch: RegExpMatchArray | null = insertPart.match(/INTO\s+(\w+)/i);
    if (tableMatch) {
      const res = await cloudQuery(`SELECT id FROM ${tableMatch[1]} ORDER BY id DESC LIMIT 1`);
      return adapt(res as unknown as CloudBaseQueryResponse);
    }
    return { rows: [{}] };
  }
  return query(text, params);
}

async function queryOne(text: string, params?: unknown[]): Promise<Record<string, unknown> | null> {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

async function queryAll(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const { rows } = await query(text, params);
  return rows;
}

// ===== 建表 SQL =====
const INIT_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    role TEXT DEFAULT 'viewer',
    company_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT '个人',
    contact TEXT DEFAULT '',
    address TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    unit TEXT DEFAULT '件',
    category1 TEXT DEFAULT '',
    category2 TEXT DEFAULT '',
    purchase_price REAL DEFAULT 0,
    sale_price REAL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL DEFAULT 0,
    avg_price REAL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    contract_no TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT '进行中',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    note TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT DEFAULT '',
    hourly_rate REAL DEFAULT 0,
    join_date TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS work_hours (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    hours REAL DEFAULT 0,
    month TEXT NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(employee_id, month)
  );

  CREATE TABLE IF NOT EXISTS employee_status_history (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    change_type TEXT DEFAULT '',
    position TEXT DEFAULT '',
    hourly_rate REAL DEFAULT 0,
    changed_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    amount REAL DEFAULT 0,
    month TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    unit TEXT DEFAULT '全公司',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    note TEXT DEFAULT '',
    category TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS settings (
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT DEFAULT '',
    PRIMARY KEY(owner_id, key)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    level1 TEXT NOT NULL,
    level2 TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expense_items (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expense_types (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'expense',
    link_customer BOOLEAN DEFAULT TRUE,
    link_product BOOLEAN DEFAULT TRUE,
    link_cat TEXT DEFAULT '',
    enabled BOOLEAN DEFAULT TRUE,
    parent_id INTEGER,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(owner_id, name, direction)
  );

  CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    reference_cost REAL DEFAULT 0,
    note TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contract_items (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity REAL DEFAULT 0,
    actual_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contract_services (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    service_name TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );
`;

// ===== 兼容性迁移函数 =====

async function ensureOwnerColumns(): Promise<void> {
  const tables: string[] = ['customers', 'products', 'inventory', 'contracts', 'employees', 'work_hours', 'salaries', 'transactions', 'settings', 'categories', 'expense_items', 'expense_types'];
  for (const t of tables) {
    try {
      await query(`ALTER TABLE ${t} ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    } catch (e: unknown) {
      if (!/already exists/i.test((e as Error).message || '')) throw e;
    }
  }
}

async function ensureInventoryColumns(): Promise<void> {
  for (const col of ['created_at', 'updated_at']) {
    try {
      await query(`ALTER TABLE inventory ADD COLUMN ${col} TIMESTAMPTZ DEFAULT NOW()`);
    } catch (e: unknown) {
      if (!/already exists/i.test((e as Error).message || '')) throw e;
    }
  }
}

async function ensureTransactionCategoryColumn(): Promise<void> {
  try {
    await query("ALTER TABLE transactions ADD COLUMN category TEXT DEFAULT ''");
  } catch (e: unknown) {
    if (!/already exists/i.test((e as Error).message || '')) throw e;
  }
}

async function ensureExpenseItemNoteColumn(): Promise<void> {
  try {
    await query("ALTER TABLE expense_items ADD COLUMN note TEXT DEFAULT ''");
  } catch (e: unknown) {
    if (!/already exists/i.test((e as Error).message || '')) throw e;
  }
}

async function ensureEmployeeStatusColumns(): Promise<void> {
  try {
    await query("ALTER TABLE employees ADD COLUMN status TEXT DEFAULT 'active'");
  } catch (e: unknown) {
    if (!/already exists/i.test((e as Error).message || '')) throw e;
  }
  try {
    await query("ALTER TABLE employees ADD COLUMN leave_date TEXT DEFAULT ''");
  } catch (e: unknown) {
    if (!/already exists/i.test((e as Error).message || '')) throw e;
  }
}

async function ensureEmployeeStatusHistoryColumns(): Promise<void> {
  for (const col of [
    "ADD COLUMN change_type TEXT DEFAULT ''",
    "ADD COLUMN position TEXT DEFAULT ''",
    "ADD COLUMN hourly_rate REAL DEFAULT 0",
  ]) {
    try {
      await query(`ALTER TABLE employee_status_history ${col}`);
    } catch (e: unknown) {
      if (!/already exists/i.test((e as Error).message || '')) throw e;
    }
  }
}

async function ensureEmployeeStatusHistoryBackfill(): Promise<void> {
  try {
    const owners = await queryAll('SELECT DISTINCT owner_id FROM employees WHERE owner_id IS NOT NULL');
    for (const row of owners) {
      const owner_id = row.owner_id as number;
      const emps = await queryAll(
        `SELECT id, status, leave_date, join_date, position, hourly_rate, created_at
         FROM employees
         WHERE owner_id=$1
           AND id NOT IN (SELECT DISTINCT employee_id FROM employee_status_history WHERE owner_id=$1)`,
        [owner_id]
      );
      for (const emp of emps) {
        const start = (emp.join_date as string) || (emp.created_at ? String(emp.created_at).slice(0, 10) : '2000-01-01');
        await query(
          'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [emp.id, 'active', '入职', (emp.position as string) || '', (emp.hourly_rate as number) || 0, start, '系统自动补全入职状态', owner_id]
        );
        if (((emp.status as string) || 'active') === 'left' && emp.leave_date) {
          await query(
            'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [emp.id, 'left', '离职', '', 0, emp.leave_date as string, '系统自动补全离职状态', owner_id]
          );
        }
      }

      const broken = await queryAll(
        `SELECT h.id, h.employee_id, h.status, h.changed_date, e.position AS emp_position, e.hourly_rate AS emp_rate
         FROM employee_status_history h
         JOIN employees e ON e.id = h.employee_id
         WHERE h.owner_id=$1 AND (h.change_type IS NULL OR h.change_type='')`,
        [owner_id]
      );
      const byEmp: Record<number, Record<string, unknown>[]> = {};
      for (const row of broken) {
        (byEmp[row.employee_id as number] = byEmp[row.employee_id as number] || []).push(row);
      }
      for (const empIdStr of Object.keys(byEmp)) {
        const empId = Number(empIdStr);
        const seq = byEmp[empId].sort((a, b) => {
          const aDate = a.changed_date as string;
          const bDate = b.changed_date as string;
          if (aDate < bDate) return -1;
          if (aDate > bDate) return 1;
          return (a.id as number) - (b.id as number);
        });
        for (let idx = 0; idx < seq.length; idx++) {
          const row = seq[idx];
          let ct: string;
          if (idx === 0) ct = '入职';
          else ct = (row.status as string) === 'left' ? '离职' : '复职';
          const pos = (row.status as string) === 'left' ? '' : ((seq[0].emp_position as string) || '');
          const rate = (row.status as string) === 'left' ? 0 : ((seq[0].emp_rate as number) || 0);
          await query(
            'UPDATE employee_status_history SET change_type=$1, position=$2, hourly_rate=$3 WHERE id=$4',
            [ct, pos, rate, row.id]
          );
        }
      }
    }
    console.log('[DB] 员工状态历史回填完成');
  } catch (e: unknown) {
    console.error('[DB] 状态历史回填跳过:', (e as Error).message);
  }
}

async function ensureDefaultCategoriesForAll(): Promise<void> {
  const users = await queryAll('SELECT id FROM users');
  for (const u of users) {
    let added = 0;
    for (const [l1, l2] of DEFAULT_CATEGORIES) {
      const exists = await queryOne(
        'SELECT 1 FROM categories WHERE owner_id=$1 AND level1=$2 AND level2=$3 LIMIT 1',
        [u.id, l1, l2]
      );
      if (!exists) {
        await query('INSERT INTO categories(owner_id,level1,level2) VALUES($1,$2,$3)', [u.id, l1, l2]);
        added++;
      }
    }
    if (added > 0) console.log(`[DB] 账号 ${u.id} 补全预设分类 ${added} 条`);
  }
}

async function ensureExpenseItemsForAll(): Promise<void> {
  const users = await queryAll('SELECT id FROM users');
  for (const u of users) {
    let added = 0;
    for (const [kind, name] of DEFAULT_EXPENSE_ITEMS) {
      const exists = await queryOne(
        'SELECT 1 FROM expense_items WHERE owner_id=$1 AND kind=$2 AND name=$3 LIMIT 1',
        [u.id, kind, name]
      );
      if (!exists) {
        await query('INSERT INTO expense_items(owner_id,kind,name) VALUES($1,$2,$3)', [u.id, kind, name]);
        added++;
      }
    }
    if (added > 0) console.log(`[DB] 账号 ${u.id} 补全支出项预设 ${added} 条`);
  }
}

async function ensureExpenseTypesForAll(): Promise<void> {
  const users = await queryAll('SELECT id FROM users');
  for (const u of users) {
    let added = 0;
    for (const [name, direction, lc, lp, lcat] of DEFAULT_EXPENSE_TYPES) {
      const exists = await queryOne(
        'SELECT 1 FROM expense_types WHERE owner_id=$1 AND name=$2 AND direction=$3 LIMIT 1',
        [u.id, name, direction]
      );
      if (!exists) {
        await query(
          'INSERT INTO expense_types(owner_id,name,direction,link_customer,link_product,link_cat,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [u.id, name, direction, lc, lp, lcat, true]
        );
        added++;
      }
    }
    if (added > 0) console.log(`[DB] 账号 ${u.id} 补全收支类型预设 ${added} 条`);
  }
}

async function migrateTaxExpenseTypeLinkage(): Promise<void> {
  try {
    const r = await query(
      "UPDATE expense_types SET link_customer=FALSE, link_product=FALSE WHERE name='税金' AND direction='expense' AND (link_customer=TRUE OR link_product=TRUE) RETURNING id"
    );
    const n: number = r.rows ? r.rows.length : 0;
    if (n > 0) console.log(`[DB] 税金联动规则迁移：修正 ${n} 条`);
  } catch (e: unknown) {
    console.error('[DB] migrateTaxExpenseTypeLinkage 失败:', (e as Error).message);
  }
}

async function ensureUserCompanyNameColumn(): Promise<void> {
  try {
    await query("ALTER TABLE users ADD COLUMN company_name TEXT NOT NULL DEFAULT ''");
  } catch (e: unknown) {
    if (!/already exists/i.test((e as Error).message || '')) throw e;
  }
  try {
    await query("UPDATE users SET company_name='系统默认企业' WHERE username='admin' AND company_name=''");
  } catch (e: unknown) { throw e; }
}

async function ensureContractUpgradeColumns(): Promise<void> {
  try {
    await query(`CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, reference_cost REAL DEFAULT 0, note TEXT DEFAULT '',
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW())`);
  } catch (e: unknown) { console.error('[DB] services 建表跳过:', (e as Error).message); }
  try {
    await query(`CREATE TABLE IF NOT EXISTS contract_items (
      id SERIAL PRIMARY KEY, contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, quantity REAL DEFAULT 0,
      actual_price REAL DEFAULT 0, amount REAL DEFAULT 0, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE)`);
  } catch (e: unknown) { console.error('[DB] contract_items 建表跳过:', (e as Error).message); }
  try {
    await query(`CREATE TABLE IF NOT EXISTS contract_services (
      id SERIAL PRIMARY KEY, contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL, service_name TEXT DEFAULT '',
      amount REAL DEFAULT 0, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE)`);
  } catch (e: unknown) { console.error('[DB] contract_services 建表跳过:', (e as Error).message); }
  try {
    await query('ALTER TABLE transactions ADD COLUMN contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL');
  } catch (e: unknown) { if (!/already exists/i.test((e as Error).message || '')) throw e; }
  try { await query("ALTER TABLE contracts ADD COLUMN date TEXT DEFAULT ''"); }
  catch (e: unknown) { if (!/already exists/i.test((e as Error).message || '')) throw e; }
  try { await query("ALTER TABLE contracts ADD COLUMN direction TEXT DEFAULT 'sale'"); }
  catch (e: unknown) { if (!/already exists/i.test((e as Error).message || '')) throw e; }
  try { await query("UPDATE contracts SET date=start_date WHERE date IS NULL OR date=''"); }
  catch (e: unknown) { console.error('[DB] contracts.date 兜底跳过:', (e as Error).message); }
}

async function fixOrphanedOwners(): Promise<void> {
  const admin = await queryOne("SELECT id FROM users WHERE username='admin'") as UserRow | null;
  if (!admin) return;
  const tables: string[] = ['customers', 'products', 'inventory', 'contracts', 'employees', 'work_hours', 'salaries', 'transactions', 'categories', 'expense_items'];
  for (const t of tables) {
    try {
      await query(`UPDATE ${t} SET owner_id=$1 WHERE owner_id IS NOT NULL AND owner_id NOT IN (SELECT id FROM users)`, [admin.id]);
    } catch (e: unknown) {
      console.error('[DB] fixOrphanedOwners 失败(' + t + '):', (e as Error).message);
    }
  }
  for (const sid of [1, 2, 3]) {
    try {
      await query('UPDATE customers SET owner_id=$1 WHERE id=$2 AND owner_id<>$1', [admin.id, sid]);
    } catch (e: unknown) {
      console.error('[DB] fixSeedCustomers 失败(' + sid + '):', (e as Error).message);
    }
  }
}

async function fixSettingsPkey(): Promise<void> {
  try { await query('ALTER TABLE settings DROP CONSTRAINT settings_pkey'); }
  catch (e: unknown) { if (!/does not exist/i.test((e as Error).message || '')) throw e; }
  try { await query('ALTER TABLE settings ADD PRIMARY KEY(owner_id, key)'); }
  catch (e: unknown) { if (!/already exists/i.test((e as Error).message || '')) throw e; }
}

async function migrateLegacyData(): Promise<void> {
  const chk = await query('SELECT COUNT(*) AS c FROM transactions WHERE owner_id IS NULL');
  if (!chk.rows[0] || parseInt(String(chk.rows[0].c), 10) === 0) return;
  const admin = await queryOne("SELECT id FROM users WHERE username='admin'") as UserRow | null;
  const editor = await queryOne("SELECT id FROM users WHERE username='editor'") as UserRow | null;
  if (admin) {
    const tables: string[] = ['customers', 'products', 'inventory', 'contracts', 'employees', 'work_hours', 'salaries', 'transactions', 'settings', 'categories', 'expense_items'];
    for (const t of tables) {
      await query(`UPDATE ${t} SET owner_id=$1 WHERE owner_id IS NULL`, [admin.id]);
    }
  }
  await fixSettingsPkey();
  if (editor) {
    const ec = await queryOne('SELECT COUNT(*) AS c FROM customers WHERE owner_id=$1', [editor.id]);
    if (!ec || parseInt(String(ec.c), 10) === 0) await seedForUser(editor.id, 'full');
  }
}

async function seedForUser(uid: number, mode: 'full' | 'sample'): Promise<void> {
  const full: boolean = mode === 'full';
  const today: Date = new Date();
  const d = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() - n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const futureD = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  const settingsRows: [string, string][] = [['amoeba_enabled', 'true'], ['currency', '¥'], ['export_format', 'csv'], ['units', '["全公司","销售部","生产部","行政部"]']];
  for (const [k, v] of settingsRows) {
    await query('INSERT INTO settings(owner_id,key,value) VALUES($1,$2,$3)', [uid, k, v]);
  }
  for (const [l1, l2] of DEFAULT_CATEGORIES) {
    await query('INSERT INTO categories(owner_id,level1,level2) VALUES($1,$2,$3)', [uid, l1, l2]);
  }
  for (const [kind, name] of DEFAULT_EXPENSE_ITEMS) {
    await query('INSERT INTO expense_items(owner_id,kind,name) VALUES($1,$2,$3)', [uid, kind, name]);
  }
  for (const [name, direction, lc, lp, lcat] of DEFAULT_EXPENSE_TYPES) {
    await query(
      'INSERT INTO expense_types(owner_id,name,direction,link_customer,link_product,link_cat,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid, name, direction, lc, lp, lcat, true]
    );
  }

  const customers: [string, string, string, string][] = full
    ? [['张三面料厂', '公司', '138-0000-0001', '绍兴柯桥'], ['李四成衣店', '个人', '139-0000-0002', '杭州四季青'], ['王五贸易行', '公司', '137-0000-0003', '广州白马']]
    : [['示例客户甲', '公司', '138-0000-1001', '上海'], ['示例客户乙', '个人', '139-0000-1002', '杭州'], ['示例客户丙', '公司', '137-0000-1003', '广州']];
  const custIds: number[] = [];
  for (const [name, type, contact, address] of customers) {
    const r = await insertReturning('INSERT INTO customers(name,type,contact,address,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, type, contact, address, uid]);
    custIds.push(r.rows[0].id as number);
  }
  const [c1, c2, c3] = custIds;

  const products: [string, string, string, string, string, number, number, number, number][] = full
    ? [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 320, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 150, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 80, 38], ['修身风衣', '风行', '件', '外套', '风衣', 80, 259, 40, 80], ['帆布腰带', '皮革记', '件', '配饰', '皮带', 8, 29, 200, 8]]
    : [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 120, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 60, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 40, 38]];
  for (const [name, brand, unit, cat1, cat2, pp, sp, qty, ap] of products) {
    const r = await insertReturning('INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [name, brand, unit, cat1, cat2, pp, sp, uid]);
    await query('INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4)', [r.rows[0].id, qty, ap, uid]);
  }

  if (!full) {
    const txns: [number, string, string, number | null, null, string, string][] = [
      [1280, '销售收入', '全公司', c1, null, d(2), '示例销售尾款'],
      [-8500, '材料采购', '生产部', c2, null, d(3), '示例面料采购'],
      [-120, '杂费支出', '全公司', null, null, d(4), '示例快递费'],
    ];
    for (const [amount, type, unit, cid, pid, date, note] of txns) {
      await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
    }
    return;
  }

  const ym: string = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const contracts: [string, number, number, string, string, string][] = [
    ['HT-2026-001', c1, 12000, '进行中', d(28), futureD(20)],
    ['HT-2026-002', c2, 8500, '进行中', d(25), futureD(15)],
    ['HT-2026-003', c3, 15000, '进行中', d(20), futureD(10)],
  ];
  for (const [no, cid, amt, st, sd, ed] of contracts) {
    await query('INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [no, cid, amt, st, sd, ed, uid]);
  }

  const svcSeed: [string, number, string][] = [['染色服务', 2.5, '按米计费的染色加工'], ['设计打样', 60, '款式设计打样'], ['物流配送', 8, '同城配送费']];
  const svcIds: number[] = [];
  for (const [nm, rc, nt] of svcSeed) {
    const r = await insertReturning('INSERT INTO services(name,reference_cost,note,owner_id) VALUES($1,$2,$3,$4) RETURNING id', [nm, rc, nt, uid]);
    svcIds.push(r.rows[0].id as number);
  }

  const firstC = await queryOne('SELECT id FROM contracts WHERE owner_id=$1 ORDER BY id ASC LIMIT 1', [uid]);
  if (firstC) {
    await query("UPDATE contracts SET direction='sale', date=start_date, contract_no='' WHERE id=$1", [firstC.id]);
    await query(
      'INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) SELECT $1, id, 100, 69, 6900, $2 FROM products WHERE owner_id=$2 AND name=$3 LIMIT 1',
      [firstC.id, uid, '纯棉T恤']
    );
    await query('INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
      [firstC.id, svcIds[0], '染色服务', 250, uid]);
    const sumI = await queryOne('SELECT COALESCE(SUM(amount),0) AS s FROM contract_items WHERE contract_id=$1 AND owner_id=$2', [firstC.id, uid]);
    const sumS = await queryOne('SELECT COALESCE(SUM(amount),0) AS s FROM contract_services WHERE contract_id=$1 AND owner_id=$2', [firstC.id, uid]);
    await query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number((sumI?.s as number) || 0) + Number((sumS?.s as number) || 0), firstC.id]);
  }

  const employees: [string, string, number, string][] = [['张师傅', '裁剪工', 35, '2024-03-01'], ['李师傅', '缝纫工', 30, '2024-05-15'], ['王小妹', '包装工', 25, '2025-01-10'], ['赵主管', '管理员', 45, '2023-06-01']];
  const empIds: number[] = [];
  for (const [name, pos, rate, jd] of employees) {
    const r = await insertReturning('INSERT INTO employees(name,position,hourly_rate,join_date,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, pos, rate, jd, uid]);
    empIds.push(r.rows[0].id as number);
  }
  const hours: number[] = [80, 90, 70, 80];
  for (let i = 0; i < empIds.length; i++) {
    await query('INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)', [empIds[i], hours[i], ym, uid]);
  }

  const txns: [number, string, string, number | null, null, string, string][] = [
    [1280, '销售收入', '全公司', c1, null, d(2), '面料订单尾款'],
    [4500, '销售收入', '销售部', c2, null, d(5), '成衣批发'],
    [3200, '销售收入', '销售部', c3, null, d(8), '贸易出货'],
    [800, '现金收入', '全公司', null, null, d(10), '零散零售'],
    [2600, '其他收入', '全公司', null, null, d(15), '利息收入'],
    [-8500, '材料采购', '生产部', c1, null, d(3), '本月面料采购'],
    [-3200, '委托加工', '生产部', null, null, d(6), '外发染色加工'],
    [-120, '杂费支出', '全公司', null, null, d(4), '顺丰快递'],
    [-380, '杂费支出', '行政部', null, null, d(18), '办公用品'],
    [-5200, '税金', '全公司', null, null, d(1), '增值税'],
  ];
  for (const [amount, type, unit, cid, pid, date, note] of txns) {
    await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
  }
}

async function init(): Promise<void> {
  try {
    const stmts: string[] = INIT_TABLES_SQL.split(';').map((s) => s.trim()).filter(Boolean);
    for (const st of stmts) {
      try {
        await query(st);
      } catch (e: unknown) {
        console.error('[DB] 建表语句跳过:', st.slice(0, 50).replace(/\s+/g, ' '), '->', (e as Error).message);
      }
    }

    await ensureOwnerColumns();
    await ensureInventoryColumns();
    await ensureTransactionCategoryColumn();
    await ensureExpenseItemNoteColumn();
    await ensureEmployeeStatusColumns();
    await ensureEmployeeStatusHistoryColumns();
    await ensureEmployeeStatusHistoryBackfill();
    await migrateLegacyData();
    await ensureDefaultCategoriesForAll();
    await ensureExpenseItemsForAll();
    await ensureExpenseTypesForAll();
    await migrateTaxExpenseTypeLinkage();
    await ensureUserCompanyNameColumn();
    await ensureContractUpgradeColumns();

    const r = await query('SELECT COUNT(*) AS c FROM users');
    const count: number = r.rows[0] ? parseInt(String(r.rows[0].c), 10) : 0;
    if (count === 0) {
      console.log('[DB] 首次启动，创建种子账号与示例数据...');
      const adminHash: string = bcrypt.hashSync('admin123', 10);
      const editorHash: string = bcrypt.hashSync('editor123', 10);
      await query(
        'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
        ['admin', adminHash, '系统管理员', 'admin', 'editor', editorHash, '数据录入员', 'admin']
      );
      const admin = await queryOne("SELECT id FROM users WHERE username='admin'") as UserRow | null;
      const editor = await queryOne("SELECT id FROM users WHERE username='editor'") as UserRow | null;
      if (admin) await seedForUser(admin.id, 'full');
      if (editor) await seedForUser(editor.id, 'full');
      console.log('[DB] 种子账号与示例数据初始化完成');
    } else {
      console.log('[DB] 数据库已存在账号，跳过账号创建（示例数据按 owner 隔离）');
    }

    await fixOrphanedOwners();
    setDbStatus(true);
  } catch (e: unknown) {
    console.error('[DB] init 异常:', (e as Error).message);
    setDbStatus(false, (e as Error).message);
  }
}

const getDiag = diag;

export { pool, query, queryOne, queryAll, insertReturning, init, getStatus, getDiag, seedForUser };
