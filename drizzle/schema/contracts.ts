/**
 * drizzle/schema/contracts.ts — 合同、合同明细、合同服务表
 */
import { pgTable, serial, text, real, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { customers } from './customers';
import { products } from './products';
import { services } from './services';

export const contracts = pgTable('contracts', {
  id: serial('id').primaryKey(),
  contractNo: text('contract_no').notNull(),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  amount: real('amount').default(0),
  status: text('status').default('进行中'),
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  date: text('date').default(''),
  direction: text('direction').default('sale'),
  note: text('note').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const contractItems = pgTable('contract_items', {
  id: serial('id').primaryKey(),
  contractId: integer('contract_id').references(() => contracts.id, { onDelete: 'cascade' }),
  productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  quantity: real('quantity').default(0),
  actualPrice: real('actual_price').default(0),
  amount: real('amount').default(0),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
});

export const contractServices = pgTable('contract_services', {
  id: serial('id').primaryKey(),
  contractId: integer('contract_id').references(() => contracts.id, { onDelete: 'cascade' }),
  serviceId: integer('service_id').references(() => services.id, { onDelete: 'set null' }),
  serviceName: text('service_name').default(''),
  amount: real('amount').default(0),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
});
