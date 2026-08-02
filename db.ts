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
import type { DbStatus, DiagResult, QueryResult } from './types/db';
import { seedAccounts } from './seed';

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
  if (Array.isArray(v)) {
    if (v.length === 0) return "'{}'";
    return "'{" + v.map((x) =>
      x === null || x === undefined ? 'NULL' :
      typeof x === 'number' ? (Number.isFinite(x) ? String(x) : 'NULL') :
      '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
    ).join(',') + "}'";
  }
  if (v instanceof Date) return "'" + v.toISOString() + "'";
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function bind(text: string, params?: unknown[]): string {
  if (!params || params.length === 0) return text;
  return text.replace(/\$(\d+)/g, (_m: string, i: string) => quote(params[Number(i) - 1]));
}

// 已知表名白名单：所有动态拼接的表名（如 ${table}）必须先经此校验，杜绝 SQL 注入
const KNOWN_TABLES: ReadonlySet<string> = new Set([
  'users', 'customers', 'products', 'inventory', 'contracts', 'services',
  'contract_services', 'employees', 'work_hours', 'salaries', 'transactions',
  'categories', 'expense_items', 'expense_types', 'settings',
]);

function assertTable(t: string): string {
  if (!KNOWN_TABLES.has(t)) {
    throw new Error(`[DB] 拒绝访问未知表名: ${t}`);
  }
  return t;
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
      const tableName: string = assertTable(tableMatch[1]);
      const res = await cloudQuery(`SELECT id FROM ${tableName} ORDER BY id DESC LIMIT 1`);
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
    notes TEXT DEFAULT '',
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
    notes TEXT DEFAULT '',
    warning_threshold REAL DEFAULT 0,
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
    date TEXT DEFAULT '',
    direction TEXT DEFAULT 'sale',
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
    status TEXT DEFAULT 'active',
    leave_date TEXT DEFAULT '',
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
    contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
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

async function init(): Promise<void> {
  const errors: string[] = [];
  // 单步容错：任一迁移失败仅记录并继续，避免后续关键步骤（含种子账号）被跳过
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); }
    catch (e: unknown) { const m = (e as Error).message; errors.push(`${name}: ${m}`); console.error(`[DB] 迁移步骤跳过(${name}):`, m); }
  };

  try {
    const stmts: string[] = INIT_TABLES_SQL.split(';').map((s) => s.trim()).filter(Boolean);
    for (const st of stmts) {
      try {
        await query(st);
      } catch (e: unknown) {
        console.error('[DB] 建表语句跳过:', st.slice(0, 50).replace(/\s+/g, ' '), '->', (e as Error).message);
      }
    }

    // 创建种子账号：独立容错，确保即使上述迁移有残留问题也能创建账号，避免首次启动无法登录
    await step('seedAccounts', seedAccounts);

    if (errors.length === 0) {
      setDbStatus(true);
    } else {
      // 迁移有非致命错误，但核心可用：标记为 degraded 而不是彻底失败，保留可读写状态
      setDbStatus(true, `部分迁移步骤跳过: ${errors.join('; ')}`);
    }
  } catch (e: unknown) {
    console.error('[DB] init 致命异常:', (e as Error).message);
    setDbStatus(false, (e as Error).message);
  }
}

const getDiag = diag;

export { pool, query, queryOne, queryAll, insertReturning, init, getStatus, getDiag };
