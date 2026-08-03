/**
 * drizzle/schema/products.ts — 商品表
 */
import { pgTable, serial, text, real, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').default(''),
  unit: text('unit').default('件'),
  category1: text('category1').default(''),
  category2: text('category2').default(''),
  purchasePrice: real('purchase_price').default(0),
  salePrice: real('sale_price').default(0),
  notes: text('notes').default(''),
  warningThreshold: real('warning_threshold').default(0),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
