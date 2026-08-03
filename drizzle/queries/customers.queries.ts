/**
 * drizzle/queries/customers.queries.ts — 客户管理查询
 */
import { eq, desc, sql, sum, max, and } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { customers } from '../schema/customers';
import { transactions } from '../schema/transactions';
import { contracts } from '../schema/contracts';

/** 列出指定用户的所有客户 */
export function listCustomers(db: DrizzleDb, ownerId: number) {
  return db.select()
    .from(customers)
    .where(eq(customers.ownerId, ownerId))
    .orderBy(desc(customers.id));
}

/** 客户应收账款汇总 */
export async function getCustomerSummary(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: customers.id,
    receivable: sql<number>`COALESCE((
      SELECT SUM(${contracts.amount} - COALESCE((
        SELECT SUM(${transactions.amount}) FROM ${transactions}
        WHERE ${transactions.contractId} = ${contracts.id}
          AND ${transactions.amount} > 0
          AND ${transactions.ownerId} = ${ownerId}
      ), 0))
      FROM ${contracts}
      WHERE ${contracts.customerId} = ${customers.id}
        AND ${contracts.direction} = 'sale'
        AND ${contracts.ownerId} = ${ownerId}
    ), 0)`,
    lastTransactionDate: sql<string>`COALESCE((
      SELECT MAX(${transactions.date}) FROM ${transactions}
      WHERE ${transactions.customerId} = ${customers.id}
        AND ${transactions.ownerId} = ${ownerId}
    ), '')`,
  }).from(customers)
    .where(eq(customers.ownerId, ownerId));
}

/** 根据 ID 和 owner_id 查找客户 */
export function findCustomerById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 创建客户 */
export function createCustomer(
  db: DrizzleDb,
  data: { name: string; type: string; contact?: string; address?: string; notes?: string; ownerId: number }
) {
  return db.insert(customers)
    .values({
      name: data.name,
      type: data.type,
      contact: data.contact || '',
      address: data.address || '',
      notes: data.notes || '',
      ownerId: data.ownerId,
    })
    .returning({ id: customers.id });
}

/** 更新客户 */
export function updateCustomer(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: { name?: string; type?: string; contact?: string; address?: string; notes?: string }
) {
  if (data.name === undefined && data.type === undefined && data.contact === undefined &&
      data.address === undefined && data.notes === undefined) return Promise.resolve();
  return db.update(customers)
    .set({ name: data.name, type: data.type, contact: data.contact, address: data.address, notes: data.notes })
    .where(and(eq(customers.id, id), eq(customers.ownerId, ownerId)));
}

/** 删除客户 */
export function deleteCustomer(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(customers)
    .where(and(eq(customers.id, id), eq(customers.ownerId, ownerId)));
}
