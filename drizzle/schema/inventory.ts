/**
 * drizzle/schema/inventory.ts — 库存表
 */
import { pgTable, serial, integer, real, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { products } from './products';

export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
  quantity: real('quantity').default(0),
  avgPrice: real('avg_price').default(0),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
