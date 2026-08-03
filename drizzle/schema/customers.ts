/**
 * drizzle/schema/customers.ts — 客户表
 */
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').default('个人'),
  contact: text('contact').default(''),
  address: text('address').default(''),
  notes: text('notes').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
