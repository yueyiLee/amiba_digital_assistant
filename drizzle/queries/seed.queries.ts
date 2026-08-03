/**
 * drizzle/queries/seed.queries.ts — 种子数据写入（Drizzle 版）
 *
 * 将 seed.ts 中的种子账号创建和示例数据写入迁移到 Drizzle ORM。
 * 保留 seed.ts 作为向后兼容的入口，内部可调用这些函数。
 */
import { eq, and, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { customers } from '../schema/customers';
import { products } from '../schema/products';
import { inventory } from '../schema/inventory';
import { contracts, contractItems, contractServices } from '../schema/contracts';
import { services } from '../schema/services';
import { employees } from '../schema/employees';
import { workHours } from '../schema/work-hours';
import { transactions } from '../schema/transactions';
import { settings } from '../schema/settings';
import { categories } from '../schema/categories';
import { expenseItems } from '../schema/expense-items';
import { expenseTypes } from '../schema/expense-types';

/** 插入种子设置 */
export async function seedSettings(db: DrizzleDb, uid: number) {
  const rows: [string, string][] = [
    ['amoeba_enabled', 'true'], ['currency', '¥'], ['export_format', 'csv'],
    ['units', '["全公司","销售部","生产部","行政部"]']
  ];
  for (const [k, v] of rows) {
    await db.insert(settings).values({ ownerId: uid, key: k, value: v });
  }
}

/** 插入默认分类 */
export async function seedCategories(db: DrizzleDb, uid: number, categoriesList: [string, string][]) {
  for (const [l1, l2] of categoriesList) {
    await db.insert(categories).values({ ownerId: uid, level1: l1, level2: l2 });
  }
}

/** 插入默认支出项 */
export async function seedExpenseItems(db: DrizzleDb, uid: number, items: [string, string][]) {
  for (const [kind, name] of items) {
    await db.insert(expenseItems).values({ ownerId: uid, kind, name });
  }
}

/** 插入默认收支类型 */
export async function seedExpenseTypes(
  db: DrizzleDb, uid: number,
  types: [string, string, boolean, boolean, string][]
) {
  for (const [name, direction, lc, lp, lcat] of types) {
    await db.insert(expenseTypes).values({
      ownerId: uid, name, direction, linkCustomer: lc, linkProduct: lp, linkCat: lcat, enabled: true,
    });
  }
}

/** 插入种子客户 */
export async function seedCustomers(
  db: DrizzleDb, uid: number,
  custData: [string, string, string, string][]
): Promise<number[]> {
  const ids: number[] = [];
  for (const [name, type, contact, address] of custData) {
    const r = await db.insert(customers)
      .values({ name, type, contact, address, ownerId: uid })
      .returning({ id: customers.id });
    ids.push(r[0].id);
  }
  return ids;
}

/** 插入种子商品及库存 */
export async function seedProducts(
  db: DrizzleDb, uid: number,
  prodData: [string, string, string, string, string, number, number, number, number][]
) {
  for (const [name, brand, unit, cat1, cat2, pp, sp, qty, ap] of prodData) {
    const r = await db.insert(products)
      .values({ name, brand, unit, category1: cat1, category2: cat2, purchasePrice: pp, salePrice: sp, ownerId: uid })
      .returning({ id: products.id });
    await db.insert(inventory)
      .values({ productId: r[0].id, quantity: qty, avgPrice: ap, ownerId: uid });
  }
}

/** 插入种子合同 */
export async function seedContracts(
  db: DrizzleDb, uid: number,
  contractData: [string, number, number, string, string, string][]
) {
  for (const [no, cid, amt, st, sd, ed] of contractData) {
    await db.insert(contracts)
      .values({ contractNo: no, customerId: cid, amount: amt, status: st, startDate: sd, endDate: ed, ownerId: uid });
  }
}

/** 插入种子服务 */
export async function seedServices(
  db: DrizzleDb, uid: number,
  svcData: [string, number, string][]
): Promise<number[]> {
  const ids: number[] = [];
  for (const [nm, rc, nt] of svcData) {
    const r = await db.insert(services)
      .values({ name: nm, referenceCost: rc, note: nt, ownerId: uid })
      .returning({ id: services.id });
    ids.push(r[0].id);
  }
  return ids;
}

/** 插入种子员工 */
export async function seedEmployees(
  db: DrizzleDb, uid: number,
  empData: [string, string, number, string][]
): Promise<number[]> {
  const ids: number[] = [];
  for (const [name, pos, rate, jd] of empData) {
    const r = await db.insert(employees)
      .values({ name, position: pos, hourlyRate: rate, joinDate: jd, ownerId: uid })
      .returning({ id: employees.id });
    ids.push(r[0].id);
  }
  return ids;
}

/** 插入种子工时 */
export async function seedWorkHours(db: DrizzleDb, uid: number, empIds: number[], hours: number[], ym: string) {
  for (let i = 0; i < empIds.length; i++) {
    await db.insert(workHours)
      .values({ employeeId: empIds[i], hours: hours[i], month: ym, ownerId: uid });
  }
}

/** 种子交易记录行 */
export interface SeedTransactionRow {
  amount: number;
  type: string;
  unit: string;
  customerId: number | null;
  date: string;
  note: string;
}

/** 插入种子流水 */
export async function seedTransactions(
  db: DrizzleDb, uid: number,
  txns: SeedTransactionRow[]
) {
  for (const { amount, type, unit, customerId, date, note } of txns) {
    await db.insert(transactions)
      .values({ amount, type, unit, customerId, date, note: note || '', ownerId: uid });
  }
}

/** 查找第一个合同 */
export async function findFirstContract(db: DrizzleDb, uid: number) {
  const rows = await db.select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.ownerId, uid))
    .orderBy(sql`${contracts.id} ASC`)
    .limit(1);
  return rows[0] || null;
}

/** 插入合同明细 */
export async function insertContractItemForProduct(
  db: DrizzleDb, contractId: number, uid: number, productName: string
) {
  const rows = await db.select({ id: products.id })
    .from(products)
    .where(and(eq(products.ownerId, uid), eq(products.name, productName)))
    .limit(1);
  const prod = rows[0];
  if (!prod) return;

  await db.insert(contractItems).values({
    contractId,
    productId: prod.id,
    quantity: 100,
    actualPrice: 69,
    amount: 6900,
    ownerId: uid,
  });
}

/** 插入合同服务 */
export async function insertContractService(
  db: DrizzleDb, contractId: number, serviceId: number, serviceName: string, amount: number, uid: number
) {
  await db.insert(contractServices)
    .values({ contractId, serviceId, serviceName, amount, ownerId: uid });
}

/** 计算合同金额并更新 */
export async function updateContractAmount(db: DrizzleDb, contractId: number) {
  const sumI = await db.select({
    s: sql<number>`COALESCE(SUM(${contractItems.amount}), 0)`,
  }).from(contractItems)
    .where(eq(contractItems.contractId, contractId));

  const sumS = await db.select({
    s: sql<number>`COALESCE(SUM(${contractServices.amount}), 0)`,
  }).from(contractServices)
    .where(eq(contractServices.contractId, contractId));

  const total = Number(sumI[0]?.s || 0) + Number(sumS[0]?.s || 0);
  await db.update(contracts)
    .set({ amount: total })
    .where(eq(contracts.id, contractId));
}
