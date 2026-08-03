/**
 * drizzle/db.ts — Drizzle ORM 数据库实例
 *
 * 基于现有 pg.Pool 创建 Drizzle 实例，复用连接池配置。
 * 对外导出 getDb() 供查询层使用，导出 initDrizzleDb() 供 db.ts 初始化时调用。
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';

export type DrizzleDb = NodePgDatabase<typeof schema>;

let _db: DrizzleDb | null = null;

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
  _db = drizzle(pool, { schema });
  return _db;
}
