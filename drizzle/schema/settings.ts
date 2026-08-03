/**
 * drizzle/schema/settings.ts — 设置表（复合主键）
 */
import { pgTable, integer, text, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';

export const settings = pgTable('settings', {
  ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').default(''),
}, (table) => ({
  pk: primaryKey({ columns: [table.ownerId, table.key] }),
}));
