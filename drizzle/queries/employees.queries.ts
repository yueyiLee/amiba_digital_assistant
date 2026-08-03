/**
 * drizzle/queries/employees.queries.ts — 员工管理 + 工时工资查询
 */
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { employees, employeeStatusHistory } from '../schema/employees';
import { workHours } from '../schema/work-hours';
import { salaries } from '../schema/salaries';

// ========== employees 员工 ==========

export function listEmployees(db: DrizzleDb, ownerId: number) {
  return db.select()
    .from(employees)
    .where(eq(employees.ownerId, ownerId))
    .orderBy(desc(employees.id));
}

export function findEmployeeById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function createEmployee(
  db: DrizzleDb,
  data: {
    name: string; position?: string; hourlyRate: number;
    joinDate?: string; status?: string; leaveDate?: string; ownerId: number;
  }
) {
  return db.insert(employees)
    .values({
      name: data.name,
      position: data.position || '',
      hourlyRate: data.hourlyRate,
      joinDate: data.joinDate || '',
      status: data.status || 'active',
      leaveDate: data.leaveDate || '',
      ownerId: data.ownerId,
    })
    .returning({ id: employees.id });
}

export function updateEmployee(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: {
    name?: string; position?: string; hourlyRate?: number;
    joinDate?: string; leaveDate?: string;
  }
) {
  // Drizzle 的 .set() 不接受直接传递 undefined，需要动态构建更新对象
  const setData: Record<string, unknown> = {};
  if (data.name !== undefined) setData.name = data.name;
  if (data.position !== undefined) setData.position = data.position;
  if (data.hourlyRate !== undefined) setData.hourlyRate = data.hourlyRate;
  if (data.joinDate !== undefined) setData.joinDate = data.joinDate;
  if (data.leaveDate !== undefined) setData.leaveDate = data.leaveDate;
  if (Object.keys(setData).length === 0) return Promise.resolve();

  return db.update(employees)
    .set(setData as any)
    .where(and(eq(employees.id, id), eq(employees.ownerId, ownerId)));
}

export function updateEmployeeStatus(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: { status: string; leaveDate: string }
) {
  return db.update(employees)
    .set({ status: data.status, leaveDate: data.leaveDate })
    .where(and(eq(employees.id, id), eq(employees.ownerId, ownerId)));
}

export function deleteEmployee(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(employees)
    .where(and(eq(employees.id, id), eq(employees.ownerId, ownerId)));
}

// ========== employee_status_history 状态历史 ==========

export function getStatusHistory(db: DrizzleDb, employeeId: number, ownerId: number) {
  return db.select({
    id: employeeStatusHistory.id,
    employeeId: employeeStatusHistory.employeeId,
    status: employeeStatusHistory.status,
    changeType: employeeStatusHistory.changeType,
    position: employeeStatusHistory.position,
    hourlyRate: employeeStatusHistory.hourlyRate,
    changedDate: employeeStatusHistory.changedDate,
    note: employeeStatusHistory.note,
    createdAt: employeeStatusHistory.createdAt,
  }).from(employeeStatusHistory)
    .where(and(eq(employeeStatusHistory.employeeId, employeeId), eq(employeeStatusHistory.ownerId, ownerId)))
    .orderBy(asc(employeeStatusHistory.changedDate), asc(employeeStatusHistory.id));
}

export function getAllStatusHistory(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: employeeStatusHistory.id,
    employeeId: employeeStatusHistory.employeeId,
    status: employeeStatusHistory.status,
    changeType: employeeStatusHistory.changeType,
    position: employeeStatusHistory.position,
    hourlyRate: employeeStatusHistory.hourlyRate,
    changedDate: employeeStatusHistory.changedDate,
    note: employeeStatusHistory.note,
    createdAt: employeeStatusHistory.createdAt,
  }).from(employeeStatusHistory)
    .where(eq(employeeStatusHistory.ownerId, ownerId))
    .orderBy(asc(employeeStatusHistory.employeeId), asc(employeeStatusHistory.changedDate), asc(employeeStatusHistory.id));
}

export function hasStatusHistory(db: DrizzleDb, employeeId: number, ownerId: number): Promise<boolean> {
  return db.select({ id: employeeStatusHistory.id })
    .from(employeeStatusHistory)
    .where(and(eq(employeeStatusHistory.employeeId, employeeId), eq(employeeStatusHistory.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows.length > 0);
}

export function createStatusHistory(
  db: DrizzleDb,
  data: {
    employeeId: number; status: string; changeType: string;
    position: string; hourlyRate: number; changedDate: string; note: string; ownerId: number;
  }
) {
  return db.insert(employeeStatusHistory).values(data);
}

/**
 * 更新员工最新的 active 状态历史记录。
 * 采用两步查询：先查找最新 active 记录 ID，再按 ID 更新，避免原始 SQL 子查询。
 * 若无匹配记录则为安全的静默跳过（员工创建时已写入入职记录，正常流程一定有）。
 */
export async function updateLatestStatusHistory(
  db: DrizzleDb,
  employeeId: number,
  ownerId: number,
  data: { position?: string; hourlyRate?: number; changedDate?: string }
) {
  const latest = await db.select({ id: employeeStatusHistory.id })
    .from(employeeStatusHistory)
    .where(and(
      eq(employeeStatusHistory.employeeId, employeeId),
      eq(employeeStatusHistory.ownerId, ownerId),
      eq(employeeStatusHistory.status, 'active'),
    ))
    .orderBy(desc(employeeStatusHistory.changedDate), desc(employeeStatusHistory.id))
    .limit(1);

  if (latest.length === 0) return;

  return db.update(employeeStatusHistory)
    .set({
      position: data.position !== undefined ? (data.position || '') : undefined,
      hourlyRate: data.hourlyRate !== undefined ? (data.hourlyRate || 0) : undefined,
      changedDate: data.changedDate !== undefined ? (data.changedDate || '') : undefined,
    })
    .where(eq(employeeStatusHistory.id, latest[0].id));
}

// ========== work_hours 工时 ==========

export function listWorkHours(
  db: DrizzleDb,
  ownerId: number,
  month?: string
) {
  const conditions = [eq(workHours.ownerId, ownerId)];
  if (month) conditions.push(eq(workHours.month, month));

  return db.select({
    id: workHours.id,
    employeeId: workHours.employeeId,
    hours: workHours.hours,
    month: workHours.month,
    ownerId: workHours.ownerId,
    employeeName: employees.name,
    hourlyRate: employees.hourlyRate,
  }).from(workHours)
    .innerJoin(employees, eq(workHours.employeeId, employees.id))
    .where(and(...conditions));
}

export function findWorkHourById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(workHours)
    .where(and(eq(workHours.id, id), eq(workHours.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function upsertWorkHour(
  db: DrizzleDb,
  data: { employeeId: number; hours: number; month: string; ownerId: number }
) {
  return db.insert(workHours)
    .values(data)
    .onConflictDoUpdate({
      target: [workHours.employeeId, workHours.month],
      set: { hours: data.hours },
    });
}

export function deleteWorkHour(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(workHours)
    .where(and(eq(workHours.id, id), eq(workHours.ownerId, ownerId)));
}

// ========== salaries 工资 ==========

export function listSalaries(db: DrizzleDb, ownerId: number) {
  return db.select()
    .from(salaries)
    .where(eq(salaries.ownerId, ownerId))
    .orderBy(desc(salaries.id));
}

export function createSalary(
  db: DrizzleDb,
  data: { employeeId: number; amount: number; month: string; ownerId: number }
) {
  return db.insert(salaries).values(data).returning({ id: salaries.id });
}

export function deleteSalary(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(salaries)
    .where(and(eq(salaries.id, id), eq(salaries.ownerId, ownerId)));
}
