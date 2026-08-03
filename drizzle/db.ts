/**
 * drizzle/db.ts — Drizzle ORM 数据库实例
 *
 * 基于现有 pg.Pool 创建 Drizzle 实例，复用连接池配置。
 * 对外导出 getDb() 供查询层使用，导出 initDrizzleDb() 供 db.ts 初始化时调用。
 *
 * SQL 日志通过 DB_LOG_SQL 环境变量控制：
 *   - 未设置或 "0"/"false"：关闭
 *   - "1" 或 "true"：使用默认 console.log
 *   - "pino"：通过 pino logger 输出（与项目日志统一）
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Logger } from 'drizzle-orm';
import * as schema from './schema';
import { rootLogger } from '../logger';

export type DrizzleDb = NodePgDatabase<typeof schema>;

let _db: DrizzleDb | null = null;

/**
 * 创建 Drizzle 兼容的 Logger。
 * 当 DB_LOG_SQL=pino 时使用项目统一的 pino logger，
 * 否则回退到 console.log 输出。
 */
function createDrizzleLogger(): Logger | true | undefined {
  const flag = (process.env.DB_LOG_SQL || '').trim().toLowerCase();
  if (!flag || flag === '0' || flag === 'false') return undefined;

  if (flag === 'pino') {
    return {
      logQuery(query: string, params: unknown[]) {
        rootLogger.info({ sql: query, params }, 'drizzle query');
      },
    };
  }

  // 默认：console.log
  return true;
}

/**
 * 获取 Drizzle 数据库实例（懒初始化）
 */
export function getDb(): DrizzleDb {
  if (!_db) {
    throw new Error('Drizzle 数据库未初始化，请先调用 initDrizzleDb(pool)');
  }
  return _db;
}

/**
 * 用现有 pg.Pool 初始化 Drizzle 实例
 */
export function initDrizzleDb(pool: Pool): DrizzleDb {
  _db = drizzle(pool, { schema, logger: createDrizzleLogger() });
  return _db;
}
