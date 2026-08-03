/**
 * drizzle/schema/transactions.ts — 收支流水表
 */
import { pgTable, serial, real, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { customers } from './customers';
import { products } from './products';
import { contracts } from './contracts';

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  amount: real('amount').notNull(),
  type: text('type').notNull(),
  unit: text('unit').default('全公司'),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  contractId: integer('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  date: text('date').notNull(),
  note: text('note').default(''),
  category: text('category').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
