/**
 * drizzle/schema/users.ts — 用户账号表
 */
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').default(''),
  role: text('role').default('viewer'),
  companyName: text('company_name').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
