/**
 * drizzle/migrate.ts — 编程式数据库迁移执行
 *
 * 通过 pg Pool 执行 drizzle-kit 生成的 SQL 迁移文件。
 * 在 db.ts 的 init() 中调用，替代原有的 INIT_TABLES_SQL 手动建表。
 * 使用 __drizzle_migrations 表追踪已执行的迁移，避免重复执行。
 *
 * 自 v1.3 起，增加"首次启动自动补登"逻辑：
 *   当迁移因表/约束已存在而失败时，自动检查迁移中涉及的所有表是否均已在库，
 *   若全部存在则视为该迁移已被 INIT_TABLES_SQL 等降级方案先行创建，
 *   自动向 __drizzle_migrations 补登记录并继续后续迁移。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { rootLogger } from '../logger';

/** 确保迁移追踪表存在 */
async function ensureMigrationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      name TEXT PRIMARY KEY,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

/** 获取已执行的迁移名称列表 */
async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM __drizzle_migrations ORDER BY name`
  );
  return new Set(rows.map((r) => r.name));
}

/**
 * 从迁移 SQL 中提取所有 CREATE TABLE 的目标表名。
 * 匹配形如 CREATE TABLE "table_name" 或 CREATE TABLE IF NOT EXISTS "table_name" 的语句。
 * `--> statement-breakpoint` 是 drizzle-kit 生成的注释分隔符，不影响匹配。
 */
function extractTableNames(sql: string): string[] {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * 检查给定表名列表是否全部存在于 public schema 中。
 * 使用 information_schema.tables 做批量查询，单次往返即可确认。
 */
async function allTablesExist(pool: Pool, tableNames: string[]): Promise<boolean> {
  if (tableNames.length === 0) return false;
  const { rows } = await pool.query<{ all_exist: boolean }>(
    `SELECT bool_and(EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    )) AS all_exist`,
    [tableNames]
  );
  return rows[0]?.all_exist ?? false;
}

/** PostgreSQL 重复对象类错误码：用于判断"已存在"场景 */
const DUPLICATE_ERROR_CODES = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object（约束、索引等）
]);

/**
 * 执行 drizzle/migrations/ 目录下的所有 .sql 迁移文件
 * 已执行的迁移会被跳过（幂等）。
 *
 * 新增"自动补登"：当迁移执行遇到重复对象错误（42P07 / 42710），
 * 且迁移中所有 CREATE TABLE 的目标表均已存在时，
 * 自动在 __drizzle_migrations 中补登该迁移记录，避免每次启动都报错。
 *
 * @param pool pg Pool 实例
 * @returns 本次新执行的迁移文件名列表
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await ensureMigrationTable(pool);
  const applied = await getAppliedMigrations(pool);

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    rootLogger.info('没有待执行的数据库迁移文件');
    return [];
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    rootLogger.info('所有数据库迁移已是最新，无需执行');
    return [];
  }

  const executed: string[] = [];
  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    try {
      // 每个迁移文件在独立事务中执行，失败不影响其他迁移
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO __drizzle_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executed.push(file);
        rootLogger.info({ migration: file }, '数据库迁移已执行');
      } catch (innerErr) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw innerErr;
      } finally {
        client.release();
      }
    } catch (e: unknown) {
      const code = (e as Record<string, unknown>)?.code as string | undefined;

      // 自动补登：当遇到重复对象错误，且迁移涉及的所有表均已存在时，
      // 视为该迁移已被降级方案（如 INIT_TABLES_SQL）先行完成。
      if (code && DUPLICATE_ERROR_CODES.has(code)) {
        const tableNames = extractTableNames(sql);
        if (tableNames.length > 0 && await allTablesExist(pool, tableNames)) {
          rootLogger.warn(
            { migration: file, errCode: code, tables: tableNames },
            '迁移中的表/约束已存在（可能由降级方案先行创建），自动补登迁移记录'
          );
          await pool.query(
            `INSERT INTO __drizzle_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
            [file]
          );
          executed.push(file);
          continue; // 跳过当前迁移，继续下一个
        }
      }

      rootLogger.error({ migration: file, err: e }, '数据库迁移执行失败');
      throw e;
    }
  }

  rootLogger.info({ count: executed.length, skipped: applied.size }, '数据库迁移全部完成');
  return executed;
}
