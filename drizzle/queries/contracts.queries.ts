/**
 * drizzle/queries/contracts.queries.ts — 合同与服务管理查询
 */
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { contracts, contractItems, contractServices } from '../schema/contracts';
import { customers } from '../schema/customers';
import { products } from '../schema/products';
import { services } from '../schema/services';

// ========== contracts 合同 ==========

/** 列出合同（带 LEFT JOIN customer） */
export function listContracts(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: contracts.id,
    contractNo: contracts.contractNo,
    customerId: contracts.customerId,
    amount: contracts.amount,
    status: contracts.status,
    startDate: contracts.startDate,
    endDate: contracts.endDate,
    date: contracts.date,
    direction: contracts.direction,
    note: contracts.note,
    ownerId: contracts.ownerId,
    createdAt: contracts.createdAt,
    customerName: customers.name,
  }).from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .where(eq(contracts.ownerId, ownerId))
    .orderBy(desc(contracts.id));
}

/** 批量查询合同明细 */
export function getContractItemsByContractIds(db: DrizzleDb, contractIds: number[], ownerId: number) {
  if (contractIds.length === 0) return [];
  return db.select({
    id: contractItems.id,
    contractId: contractItems.contractId,
    productId: contractItems.productId,
    quantity: contractItems.quantity,
    actualPrice: contractItems.actualPrice,
    amount: contractItems.amount,
    ownerId: contractItems.ownerId,
    productName: products.name,
  }).from(contractItems)
    .leftJoin(products, eq(contractItems.productId, products.id))
    .where(and(
      inArray(contractItems.contractId, contractIds),
      eq(contractItems.ownerId, ownerId)
    ));
}

/** 批量查询合同服务 */
export function getContractServicesByContractIds(db: DrizzleDb, contractIds: number[], ownerId: number) {
  if (contractIds.length === 0) return [];
  return db.select()
    .from(contractServices)
    .where(and(
      inArray(contractServices.contractId, contractIds),
      eq(contractServices.ownerId, ownerId)
    ));
}

/** 查找合同 */
export function findContractById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

/** 创建合同 */
export function createContract(
  db: DrizzleDb,
  data: {
    customerId: number; date?: string; direction?: string; status?: string;
    startDate?: string; endDate?: string; note?: string; ownerId: number;
  }
) {
  const useDate = data.date || data.startDate || '';
  return db.insert(contracts)
    .values({
      contractNo: '',
      customerId: data.customerId,
      amount: 0,
      status: data.status || '进行中',
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      note: data.note || '',
      date: useDate,
      direction: data.direction || 'sale',
      ownerId: data.ownerId,
    })
    .returning({ id: contracts.id });
}

/** 更新合同基本信息 */
export function updateContract(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: {
    customerId?: number; status?: string; startDate?: string;
    endDate?: string; note?: string; date?: string; direction?: string; amount?: number;
  }
) {
  if (data.customerId === undefined && data.status === undefined && data.startDate === undefined &&
      data.endDate === undefined && data.note === undefined && data.date === undefined &&
      data.direction === undefined && data.amount === undefined) return Promise.resolve();
  return db.update(contracts)
    .set({
      customerId: data.customerId, status: data.status, startDate: data.startDate,
      endDate: data.endDate, note: data.note, date: data.date,
      direction: data.direction, amount: data.amount,
    })
    .where(and(eq(contracts.id, id), eq(contracts.ownerId, ownerId)));
}

/** 删除合同 */
export function deleteContract(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.ownerId, ownerId)));
}

// ========== contract_items 合同明细 ==========

export function createContractItem(
  db: DrizzleDb,
  data: { contractId: number; productId: number; quantity: number; actualPrice: number; amount: number; ownerId: number }
) {
  return db.insert(contractItems).values(data);
}

export function deleteContractItemsByContract(db: DrizzleDb, contractId: number, ownerId: number) {
  return db.delete(contractItems)
    .where(and(eq(contractItems.contractId, contractId), eq(contractItems.ownerId, ownerId)));
}

// ========== contract_services 合同服务 ==========

export function createContractService(
  db: DrizzleDb,
  data: { contractId: number; serviceId?: number | null; serviceName?: string; amount: number; ownerId: number }
) {
  return db.insert(contractServices).values({
    contractId: data.contractId,
    serviceId: data.serviceId ?? null,
    serviceName: data.serviceName || '',
    amount: data.amount,
    ownerId: data.ownerId,
  });
}

export function deleteContractServicesByContract(db: DrizzleDb, contractId: number, ownerId: number) {
  return db.delete(contractServices)
    .where(and(eq(contractServices.contractId, contractId), eq(contractServices.ownerId, ownerId)));
}

// ========== services 服务 ==========

export function listServices(db: DrizzleDb, ownerId: number, search?: string) {
  const conditions = [eq(services.ownerId, ownerId)];
  if (search) {
    // 转义 LIKE 通配符，防止用户输入 % _ 导致意外匹配
    const escaped = search.replace(/[%_]/g, '\\$&');
    conditions.push(sql`${services.name} ILIKE ${'%' + escaped + '%'}`);
  }

  return db.select({
    id: services.id,
    name: services.name,
    referenceCost: services.referenceCost,
    note: services.note,
  }).from(services)
    .where(and(...conditions))
    .orderBy(desc(services.id));
}

export function findServiceByName(db: DrizzleDb, ownerId: number, name: string) {
  return db.select({ id: services.id })
    .from(services)
    .where(and(eq(services.ownerId, ownerId), eq(services.name, name)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function findServiceById(db: DrizzleDb, id: number, ownerId: number) {
  return db.select()
    .from(services)
    .where(and(eq(services.id, id), eq(services.ownerId, ownerId)))
    .limit(1)
    .then((rows) => rows[0] || null);
}

export function createService(
  db: DrizzleDb,
  data: { ownerId: number; name: string; referenceCost?: number; note?: string }
) {
  return db.insert(services)
    .values({
      ownerId: data.ownerId,
      name: data.name,
      referenceCost: data.referenceCost || 0,
      note: data.note || '',
    })
    .returning({ id: services.id });
}

export function updateService(
  db: DrizzleDb,
  id: number,
  ownerId: number,
  data: { name: string; referenceCost: number; note: string }
) {
  return db.update(services)
    .set({ name: data.name, referenceCost: data.referenceCost, note: data.note })
    .where(and(eq(services.id, id), eq(services.ownerId, ownerId)));
}

export function deleteService(db: DrizzleDb, id: number, ownerId: number) {
  return db.delete(services)
    .where(and(eq(services.id, id), eq(services.ownerId, ownerId)));
}

// ========== 候选合同推荐 ==========

export function suggestContracts(
  db: DrizzleDb,
  ownerId: number,
  filters?: { direction?: string; customerId?: number }
) {
  const conditions = [eq(contracts.ownerId, ownerId)];
  if (filters?.direction) conditions.push(eq(contracts.direction, filters.direction));
  if (filters?.customerId) conditions.push(eq(contracts.customerId, filters.customerId));

  return db.select({
    id: contracts.id,
    date: contracts.date,
    direction: contracts.direction,
    customerName: customers.name,
    prodNames: sql<string>`(SELECT COALESCE(string_agg(${products.name}, ','), '') FROM ${contractItems} ci LEFT JOIN ${products} ON ci.product_id=${products.id} WHERE ci.contract_id=${contracts.id})`,
    svcNames: sql<string>`(SELECT COALESCE(string_agg(${contractServices.serviceName}, ','), '') FROM ${contractServices} WHERE ${contractServices.contractId}=${contracts.id})`,
  }).from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(contracts.id));
}
