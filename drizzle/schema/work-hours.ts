/**
 * drizzle/schema/work-hours.ts — 月度工时表
 */
import { pgTable, serial, integer, real, text, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { employees } from './employees';

export const workHours = pgTable('work_hours', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  hours: real('hours').default(0),
  month: text('month').notNull(),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => ({
  unqEmployeeMonth: unique().on(table.employeeId, table.month),
}));
