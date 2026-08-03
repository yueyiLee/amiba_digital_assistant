/**
 * drizzle/schema/salaries.ts — 工资表
 */
import { pgTable, serial, integer, real, text } from 'drizzle-orm/pg-core';
import { users } from './users';
import { employees } from './employees';

export const salaries = pgTable('salaries', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  amount: real('amount').default(0),
  month: text('month').default(''),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
});
