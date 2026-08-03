/**
 * db.ts — PostgreSQL 数据库连接与初始化
 *
 * 统一使用 pg 原生连接池直连 PostgreSQL（本地与云端部署通用）。
 * 对上层暴露的接口（query / queryOne / queryAll / insertReturning / init）保持不变。
 *
 * 自 v1.2 起，init() 会优先通过 Drizzle ORM 迁移系统建表，
 * 同时保留 INIT_TABLES_SQL 作为降级后备（Drizzle 迁移不可用时回退）。
 */
import { Pool, QueryResult as PgQueryResult } from 'pg';
import type { DbStatus, DiagResult, QueryResult } from './types/db';
import { seedAccounts } from './seed';
import { rootLogger } from './logger';
import { initDrizzleDb } from './drizzle/db.js';

// ===== 初始化状态（供 /api/health 暴露）=====
let dbReady = false;
let dbError: string | null = null;
function setDbStatus(ready: boolean, error?: string): void {
  dbReady = ready;
  dbError = error || null;
}
function getStatus(): DbStatus {
  return { ready: dbError ? false : dbReady, error: dbError };
}

// 诊断信息：暴露容器内关键环境变量是否存在（不暴露取值），便于排查连接问题
function diag(): DiagResult {
  return {
    mode: 'native-pg+drizzle',
    hasNativePgConfig: !!(process.env.DATABASE_URL || process.env.PG_HOST || process.env.PG_DATABASE),
    poolConnected: pool.totalCount > 0,
  };
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

async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  const result: PgQueryResult = await getPool().query(text, params);
  return result;
}

async function insertReturning(text: string, params?: unknown[]): Promise<QueryResult> {
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
    catch (e: unknown) {
      const m = (e as Error).message;
      errors.push(`${name}: ${m}`);
      rootLogger.warn({ step: name, err: e }, 'DB 迁移步骤跳过');
    }
  };

  try {
    // 1. 初始化 Drizzle 实例（基于 pg Pool）
    initDrizzleDb(getPool());

    // 2. 优先使用 Drizzle 迁移系统建表
    try {
      const { runMigrations } = await import('./drizzle/migrate.js');
      await runMigrations(getPool());
      rootLogger.info('Drizzle 迁移执行完成');
    } catch (e: unknown) {
      rootLogger.warn({ err: e }, 'Drizzle 迁移失败，回退到 INIT_TABLES_SQL 建表');
      // 降级：使用原有 SQL 建表方式，包裹在事务中确保原子性
      const stmts: string[] = INIT_TABLES_SQL.split(';').map((s) => s.trim()).filter(Boolean);
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        for (const st of stmts) {
          await client.query(st);
        }
        await client.query('COMMIT');
      } catch (e2: unknown) {
        try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
        rootLogger.warn({ err: e2 }, 'DB 降级建表事务失败');
      } finally {
        client.release();
      }
    }

    // 3. 创建种子账号：独立容错，确保即使上述迁移有残留问题也能创建账号，避免首次启动无法登录
    await step('seedAccounts', seedAccounts);

    if (errors.length === 0) {
      setDbStatus(true);
      rootLogger.info('数据库初始化完成');
    } else {
      // 迁移有非致命错误，但核心可用：标记为 degraded 而不是彻底失败，保留可读写状态
      setDbStatus(true, `部分迁移步骤跳过: ${errors.join('; ')}`);
      rootLogger.warn({ errors }, '数据库初始化完成（部分步骤跳过）');
    }
  } catch (e: unknown) {
    rootLogger.error({ err: e }, 'DB init 致命异常');
    setDbStatus(false, (e as Error).message);
  }
}

const getDiag = diag;

export { pool, query, queryOne, queryAll, insertReturning, init, getStatus, getDiag };
