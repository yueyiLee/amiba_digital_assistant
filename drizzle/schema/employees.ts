/**
 * drizzle/schema/employees.ts — 员工表 + 员工状态历史表
 */
import { pgTable, serial, text, real, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const employees = pgTable('employees', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  position: text('position').default(''),
  hourlyRate: real('hourly_rate').default(0),
  joinDate: text('join_date').default(''),
  status: text('status').default('active'),
  leaveDate: text('leave_date').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const employeeStatusHistory = pgTable('employee_status_history', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  changeType: text('change_type').default(''),
  position: text('position').default(''),
  hourlyRate: real('hourly_rate').default(0),
  changedDate: text('changed_date').notNull(),
  note: text('note').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
