/**
 * drizzle/schema/categories.ts — 商品分类表
 */
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  level1: text('level1').notNull(),
  level2: text('level2').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
});
