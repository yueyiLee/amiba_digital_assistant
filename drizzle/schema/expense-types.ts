/**
 * drizzle/schema/expense-types.ts — 收支类型表
 */
import { pgTable, serial, text, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

export const expenseTypes = pgTable('expense_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  direction: text('direction').notNull().default('expense'),
  linkCustomer: boolean('link_customer').default(true),
  linkProduct: boolean('link_product').default(true),
  linkCat: text('link_cat').default(''),
  enabled: boolean('enabled').default(true),
  parentId: integer('parent_id'),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => ({
  unqOwnerNameDir: unique().on(table.ownerId, table.name, table.direction),
}));
