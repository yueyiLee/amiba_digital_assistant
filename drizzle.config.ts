/**
 * drizzle-kit 配置文件
 * 用于生成和管理数据库迁移文件
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    // 复用现有环境变量，优先 DATABASE_URL，否则用独立变量
    url: process.env.DATABASE_URL
      || `postgres://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || 'postgres'}@${process.env.PG_HOST || '127.0.0.1'}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE || 'amoeba_app'}`,
  },
  // 严格模式：确保 schema 变更经过审核
  strict: true,
  // 所有表都使用 snake_case 命名（与现有数据库一致）
  casing: 'snake_case',
});
