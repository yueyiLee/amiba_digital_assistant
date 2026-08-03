/**
 * drizzle/schema/expense-items.ts — 支出项预设表
 */
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

export const expenseItems = pgTable('expense_items', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  note: text('note').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
});
