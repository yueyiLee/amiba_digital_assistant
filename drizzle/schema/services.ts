/**
 * drizzle/schema/services.ts — 服务表
 */
import { pgTable, serial, text, real, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  referenceCost: real('reference_cost').default(0),
  note: text('note').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
