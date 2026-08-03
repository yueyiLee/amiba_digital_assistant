/**
 * drizzle/queries/transactions.queries.ts — 收支流水、支出项、收支类型查询
 */
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { transactions } from '../schema/transactions';
import { customers } from '../schema/customers';
import { products } from '../schema/products';
import { contracts, contractItems, contractServices } from '../schema/contracts';
import { services } from '../schema/services';
import { expenseItems } from '../schema/expense-items';
import { expenseTypes } from '../schema/expense-types';
import { categories } from '../schema/categories';
import { inventory } from '../schema/inventory';
import { settings } from '../schema/settings';
import { workHours } from '../schema/work-hours';
import { salaries } from '../schema/salaries';
import { employees, employeeStatusHistory } from '../schema/employees';

// ========== transactions 收支流水 ==========

/** 列出收支流水（带 LEFT JOIN 客户/商品名称） */
export function listTransactions(
  db: DrizzleDb,
  ownerId: number,
  filters?: { unit?: string; type?: string; startDate?: string; endDate?: string }
) {
  const conditions = [eq(transactions.ownerId, ownerId)];
  if (filters?.unit && filters.unit !== '全部单元') conditions.push(eq(transactions.unit, filters.unit));
  if (filters?.type) conditions.push(eq(transactions.type, filters.type));
  if (filters?.startDate) conditions.push(sql`${transactions.date} >= ${filters.startDate}`);
  if (filters?.endDate) conditions.push(sql`${transactions.date} <= ${filters.endDate}`);

  return db.select({
    id: transactions.id,
    amount: transactions.amount,
    type: transactions.type,
    unit: transactions.unit,
    customerId: transactions.customerId,
    productId: transactions.productId,
    contractId: transactions.contractId,
    date: transactions.date,
    note: transactions.note,
    category: transactions.category,
    ownerId: transactions.ownerId,
    createdAt: transactions.createdAt,
    customerName: customers.name,
    productName: products.name,
  }).from(transactions)
    .leftJoin(customers, eq(transactions.customerId, customers.id))
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.id));
}

/** 查找单条流水 */
export function findTransactionById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 创建流水 */
export function createTransaction(
  db: DrizzleDb,
  data: {
    amount: number; type: string; unit?: string; customerId?: number | null;
    productId?: number | null; contractId?: number | null; date: string;
    note?: string; category?: string; ownerId: number;
  }
) {
  return db.insert(transactions)
    .values({
      amount: data.amount,
      type: data.type,
      unit: data.unit || '全公司',
      customerId: data.customerId ?? null,
      productId: data.productId ?? null,
      contractId: data.contractId ?? null,
      date: data.date,
      note: data.note || '',
      category: data.category || '',
      ownerId: data.ownerId,
    })
    .returning({ id: transactions.id });
}

/** 更新流水 */
export function updateTransaction(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: {
    amount?: number; type?: string; unit?: string; customerId?: number | null;
    productId?: number | null; contractId?: number | null; date?: string;
    note?: string; category?: string;
  }
) {
  if (data.amount === undefined && data.type === undefined && data.unit === undefined &&
      data.customerId === undefined && data.productId === undefined && data.contractId === undefined &&
      data.date === undefined && data.note === undefined && data.category === undefined) return Promise.resolve();
  return db.update(transactions)
    .set({
      amount: data.amount, type: data.type, unit: data.unit,
      customerId: data.customerId, productId: data.productId, contractId: data.contractId,
      date: data.date, note: data.note, category: data.category,
    })
    .where(and(eq(transactions.id, id), eq(transactions.ownerId, ownerId)));
}

/** 删除流水 */
export function deleteTransaction(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.ownerId, ownerId)));
}

/** 批量查询合同关联信息（用于流水列表中的合同展示名） */
export async function getContractDisplayNames(db: DrizzleDb, contractIds: number[]) {
  if (contractIds.length === 0) return {};

  const rows = await db.select({
    id: contracts.id,
    date: contracts.date,
    direction: contracts.direction,
    customerName: customers.name,
    prodNames: sql<string>`(SELECT COALESCE(string_agg(${products.name}, ','), '') FROM ${contractItems} ci LEFT JOIN ${products} ON ci.product_id=${products.id} WHERE ci.contract_id=${contracts.id})`,
    svcNames: sql<string>`(SELECT COALESCE(string_agg(${contractServices.serviceName}, ','), '') FROM ${contractServices} WHERE ${contractServices.contractId}=${contracts.id})`,
  }).from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .where(inArray(contracts.id, contractIds));

  const map: Record<number, { display_name: string; direction: string }> = {};
  rows.forEach((co) => {
    const names: string[] = [];
    if (co.prodNames) co.prodNames.split(',').forEach((n: string) => n && names.push(n));
    if (co.svcNames) co.svcNames.split(',').forEach((n: string) => n && names.push(n));
    const d: string = co.date || '';
    const display_name: string = names.length
      ? `${d}-${co.customerName || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
      : `${d}-${co.customerName || '—'}`;
    map[co.id] = { display_name, direction: co.direction || 'sale' };
  });
  return map;
}

// ========== expense_items 支出项预设 ==========

export function listExpenseItems(db: DrizzleDb, ownerId: number) {
  return db.select({ id: expenseItems.id, kind: expenseItems.kind, name: expenseItems.name, note: expenseItems.note })
    .from(expenseItems)
    .where(eq(expenseItems.ownerId, ownerId))
    .orderBy(expenseItems.id);
}

export function findExpenseItemByKindName(db: DrizzleDb, ownerId: number, kind: string, name: string) {
  return db.select({ id: expenseItems.id })
    .from(expenseItems)
    .where(and(eq(expenseItems.ownerId, ownerId), eq(expenseItems.kind, kind), eq(expenseItems.name, name)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function findExpenseItemById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(expenseItems)
    .where(and(eq(expenseItems.id, id), eq(expenseItems.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function createExpenseItem(
  db: DrizzleDb,
  data: { ownerId: number; kind: string; name: string; note?: string }
) {
  return db.insert(expenseItems)
    .values({ ownerId: data.ownerId, kind: data.kind, name: data.name, note: data.note || '' })
    .returning({ id: expenseItems.id });
}

export function updateExpenseItem(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: { name: string; note: string }
) {
  return db.update(expenseItems)
    .set({ name: data.name, note: data.note })
    .where(and(eq(expenseItems.id, id), eq(expenseItems.ownerId, ownerId)));
}

export function deleteExpenseItem(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(expenseItems)
    .where(and(eq(expenseItems.id, id), eq(expenseItems.ownerId, ownerId)));
}

// ========== expense_types 收支类型 ==========

export function listExpenseTypes(
  db: DrizzleDb,
  ownerId: number,
  filters?: { direction?: string; enabled?: boolean }
) {
  const conditions = [eq(expenseTypes.ownerId, ownerId)];
  if (filters?.direction) conditions.push(eq(expenseTypes.direction, filters.direction));
  if (filters?.enabled !== undefined) conditions.push(eq(expenseTypes.enabled, filters.enabled));

  return db.select({
    id: expenseTypes.id,
    name: expenseTypes.name,
    direction: expenseTypes.direction,
    linkCustomer: expenseTypes.linkCustomer,
    linkProduct: expenseTypes.linkProduct,
    linkCat: expenseTypes.linkCat,
    enabled: expenseTypes.enabled,
  }).from(expenseTypes)
    .where(and(...conditions))
    .orderBy(expenseTypes.direction, expenseTypes.id);
}

export function findExpenseTypeById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(expenseTypes)
    .where(and(eq(expenseTypes.id, id), eq(expenseTypes.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function findExpenseTypeByNameDir(db: DrizzleDb, ownerId: number, name: string, direction: string) {
  return db.select({ id: expenseTypes.id })
    .from(expenseTypes)
    .where(and(eq(expenseTypes.ownerId, ownerId), eq(expenseTypes.name, name), eq(expenseTypes.direction, direction)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function createExpenseType(
  db: DrizzleDb,
  data: {
    ownerId: number; name: string; direction: string;
    linkCustomer?: boolean; linkProduct?: boolean; linkCat?: string;
  }
) {
  return db.insert(expenseTypes)
    .values({
      ownerId: data.ownerId,
      name: data.name,
      direction: data.direction,
      linkCustomer: data.linkCustomer ?? true,
      linkProduct: data.linkProduct ?? true,
      linkCat: data.linkCat || '',
      enabled: true,
    })
    .returning({ id: expenseTypes.id });
}

export function updateExpenseType(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: {
    name?: string; direction?: string; linkCustomer?: boolean;
    linkProduct?: boolean; linkCat?: string; enabled?: boolean;
  }
) {
  if (data.name === undefined && data.direction === undefined && data.linkCustomer === undefined &&
      data.linkProduct === undefined && data.linkCat === undefined && data.enabled === undefined) return Promise.resolve();
  return db.update(expenseTypes)
    .set({
      name: data.name, direction: data.direction,
      linkCustomer: data.linkCustomer, linkProduct: data.linkProduct,
      linkCat: data.linkCat, enabled: data.enabled,
    })
    .where(and(eq(expenseTypes.id, id), eq(expenseTypes.ownerId, ownerId)));
}

export function deleteExpenseType(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(expenseTypes)
    .where(and(eq(expenseTypes.id, id), eq(expenseTypes.ownerId, ownerId)));
}

// ========== 批量删除（重置示例数据用） ==========

export function deleteAllByOwner(db: DrizzleDb, ownerId: number) {
  return db.transaction(async (tx) => {
    // 注意：CASCADE 外键会自动处理关联数据
    // 但这里按照原逻辑显式按顺序删除
    await tx.delete(transactions).where(eq(transactions.ownerId, ownerId));
    await tx.delete(contractServices).where(eq(contractServices.ownerId, ownerId));
    await tx.delete(services).where(eq(services.ownerId, ownerId));
    await tx.delete(contractItems).where(eq(contractItems.ownerId, ownerId));
    await tx.delete(contracts).where(eq(contracts.ownerId, ownerId));
    await tx.delete(workHours).where(eq(workHours.ownerId, ownerId));
    await tx.delete(salaries).where(eq(salaries.ownerId, ownerId));
    await tx.delete(expenseItems).where(eq(expenseItems.ownerId, ownerId));
    await tx.delete(expenseTypes).where(eq(expenseTypes.ownerId, ownerId));
    await tx.delete(categories).where(eq(categories.ownerId, ownerId));
    await tx.delete(settings).where(eq(settings.ownerId, ownerId));
    await tx.delete(inventory).where(eq(inventory.ownerId, ownerId));
    await tx.delete(products).where(eq(products.ownerId, ownerId));
    await tx.delete(customers).where(eq(customers.ownerId, ownerId));
    await tx.delete(employeeStatusHistory).where(eq(employeeStatusHistory.ownerId, ownerId));
    await tx.delete(employees).where(eq(employees.ownerId, ownerId));
  });
}
