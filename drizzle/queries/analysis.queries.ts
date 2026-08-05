/**
 * drizzle/queries/analysis.queries.ts — 分析查询（聚合/统计/趋势）
 *
 * 由于分析查询非常复杂且大量使用 CASE WHEN + 动态 SQL，
 * 部分查询使用 sql 模板字符串直接嵌入，保持与原有逻辑一致。
 */
import { eq, and, sql, inArray, between } from 'drizzle-orm';
import type { DrizzleDb } from '../db';
import { transactions } from '../schema/transactions';
import { customers } from '../schema/customers';
import { products } from '../schema/products';
import { contracts, contractItems } from '../schema/contracts';
import { inventory } from '../schema/inventory';
import { workHours } from '../schema/work-hours';
import { employees } from '../schema/employees';

// ========== 工具函数 ==========

/** 收入类交易类型（与 PRD §4.1/§9 口径一致） */
export const INCOME_TYPES = ['销售收入', '现金收入', '其他收入'];
/** 支出类交易类型（含「现金支出」独立原始指标，见 PRD §4.1 L440） */
export const EXPENSE_TYPES = ['材料采购', '委托加工', '杂费支出', '税金', '现金支出'];

/** 构建交易过滤条件 */
export function buildTxFilter(ownerId: number, sd: string, ed: string, unit?: string | null): {
  where: ReturnType<typeof and>;
  params: unknown[];
} {
  const useUnit = !!(unit && unit !== '全部单元');
  return {
    where: useUnit
      ? and(eq(transactions.ownerId, ownerId), between(transactions.date, sd, ed), eq(transactions.unit, unit!))
      : and(eq(transactions.ownerId, ownerId), between(transactions.date, sd, ed)),
    params: useUnit ? [ownerId, sd, ed, unit!] : [ownerId, sd, ed],
  };
}

// ========== 驾驶舱分析 ==========

export async function getTypeAggregation(db: DrizzleDb, ownerId: number, sd: string, ed: string, unit?: string | null) {
  const { where } = buildTxFilter(ownerId, sd, ed, unit);
  return db.select({
    type: transactions.type,
    raw: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    absAmt: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
  }).from(transactions)
    .where(where)
    .groupBy(transactions.type);
}

export async function getSalaryHoursAgg(db: DrizzleDb, ownerId: number, smk: string, emk: string) {
  const rows = await db.select({
    salary: sql<number>`COALESCE(SUM(${workHours.hours} * ${employees.hourlyRate}), 0)`,
    hours: sql<number>`COALESCE(SUM(${workHours.hours}), 0)`,
  }).from(workHours)
    .innerJoin(employees, eq(employees.id, workHours.employeeId))
    .where(and(
      eq(workHours.ownerId, ownerId),
      between(workHours.month, smk, emk),
      sql`COALESCE(${employees.status}, 'active') = 'active'`
    ));
  return rows[0] || { salary: 0, hours: 0 };
}

// getInventoryValue 在 inventory.queries.ts 中统一定义，此处不再重复导出

export async function getCustomerAgg(db: DrizzleDb, ownerId: number, sd: string, ed: string, unit?: string | null) {
  const { where } = buildTxFilter(ownerId, sd, ed, unit);
  return db.select({
    customerId: transactions.customerId,
    customerName: customers.name,
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    recv: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} WHEN ${transactions.type}='现金收入' THEN -${transactions.amount} ELSE 0 END), 0)`,
  }).from(transactions)
    .innerJoin(customers, eq(customers.id, transactions.customerId))
    .where(and(where, sql`${transactions.customerId} IS NOT NULL`))
    .groupBy(transactions.customerId, customers.name);
}

export async function getProductAgg(db: DrizzleDb, ownerId: number, sd: string, ed: string, unit?: string | null) {
  const { where } = buildTxFilter(ownerId, sd, ed, unit);
  return db.select({
    productId: transactions.productId,
    productName: products.name,
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cost: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='材料采购' THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .innerJoin(products, eq(products.id, transactions.productId))
    .where(and(where, sql`${transactions.productId} IS NOT NULL`))
    .groupBy(transactions.productId, products.name);
}

export async function getStaleInventory(db: DrizzleDb, ownerId: number) {
  return db.select({
    productId: inventory.productId,
    productName: products.name,
    quantity: inventory.quantity,
    days: sql<number>`EXTRACT(EPOCH FROM (NOW() - ${inventory.updatedAt})) / 86400`,
  }).from(inventory)
    .leftJoin(products, eq(products.id, inventory.productId))
    .where(and(
      eq(inventory.ownerId, ownerId),
      sql`${inventory.quantity} > 0`,
      sql`${inventory.updatedAt} IS NOT NULL`
    ));
}

export async function getUnitTop(db: DrizzleDb, ownerId: number, sd: string, ed: string, unit?: string | null) {
  const { where } = buildTxFilter(ownerId, sd, ed, unit);
  return db.select({
    unit: sql<string>`COALESCE(${transactions.unit}, '全公司')`,
    addedValue: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('销售收入','现金收入','其他收入') THEN ${transactions.amount} WHEN ${transactions.type} IN ('材料采购','委托加工','杂费支出') THEN -ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .where(where)
    .groupBy(sql`COALESCE(${transactions.unit}, '全公司')`)
    .orderBy(sql`2 DESC`)
    .limit(1);
}

// ========== 客户分析 ==========

export async function getCustomerAnalysis(
  db: DrizzleDb, ownerId: number, sd: string, ed: string
) {
  // 总数
  const totalRow = await db.select({ total: sql<number>`COUNT(*)` })
    .from(customers).where(eq(customers.ownerId, ownerId));
  const totalCount = Number(totalRow[0]?.total) || 0;

  // 活跃数
  const activeRow = await db.select({ active: sql<number>`COUNT(DISTINCT ${transactions.customerId})` })
    .from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.customerId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ));
  const activeCount = Number(activeRow[0]?.active) || 0;

  // 应收汇总
  const recvRow = await db.select({
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cash: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='现金收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.customerId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ));

  // 客户聚合
  const custAgg = await db.select({
    customerId: transactions.customerId,
    customerName: customers.name,
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cash: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='现金收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cost: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='材料采购' THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .innerJoin(customers, eq(customers.id, transactions.customerId))
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.customerId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.customerId, customers.name)
    .orderBy(sql`3 DESC`);

  return { totalCount, activeCount, recvRow: recvRow[0], custAgg };
}

export async function getCustomerLastDates(db: DrizzleDb, ownerId: number, customerIds: number[]) {
  if (customerIds.length === 0) return [];
  return db.select({
    customerId: transactions.customerId,
    lastDate: sql<string>`MAX(${transactions.date})`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      inArray(transactions.customerId, customerIds)
    ))
    .groupBy(transactions.customerId);
}

// ========== 商品分析 ==========

export async function getProductSaleAgg(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    productId: transactions.productId,
    productName: products.name,
    amt: sql<number>`SUM(${transactions.amount})`,
  }).from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.type, '销售收入'),
      sql`${transactions.amount} > 0`,
      sql`${transactions.productId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.productId, products.name)
    .orderBy(sql`3 DESC`)
    .limit(100);
}

export async function getProductPurchaseAgg(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    productId: transactions.productId,
    productName: products.name,
    amt: sql<number>`SUM(ABS(${transactions.amount}))`,
  }).from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.type, '材料采购'),
      sql`${transactions.amount} < 0`,
      sql`${transactions.productId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.productId, products.name)
    .orderBy(sql`3 DESC`)
    .limit(100);
}

export async function getContractItemAgg(db: DrizzleDb, ownerId: number, direction: string, sd: string, ed: string) {
  return db.select({
    productId: contractItems.productId,
    productName: products.name,
    qty: sql<number>`SUM(${contractItems.quantity})`,
    amt: sql<number>`SUM(${contractItems.quantity} * ${contractItems.actualPrice})`,
  }).from(contractItems)
    .innerJoin(contracts, eq(contractItems.contractId, contracts.id))
    .leftJoin(products, eq(contractItems.productId, products.id))
    .where(and(
      eq(contracts.ownerId, ownerId),
      eq(contracts.direction, direction),
      between(contracts.date, sd, ed)
    ))
    .groupBy(contractItems.productId, products.name)
    .orderBy(sql`4 DESC`);
}

export async function getPriceTrend(db: DrizzleDb, ownerId: number, direction: string, sd: string, ed: string) {
  return db.select({
    productId: contractItems.productId,
    productName: products.name,
    date: contracts.date,
    actualPrice: contractItems.actualPrice,
  }).from(contractItems)
    .innerJoin(contracts, eq(contractItems.contractId, contracts.id))
    .leftJoin(products, eq(contractItems.productId, products.id))
    .where(and(
      eq(contracts.ownerId, ownerId),
      eq(contracts.direction, direction),
      between(contracts.date, sd, ed)
    ))
    .orderBy(contractItems.productId, contracts.date);
}

// ========== 合同分析 ==========

export async function getContractAnalysis(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  const overview = await db.select({
    totalCount: sql<number>`COUNT(*)`,
    totalAmount: sql<number>`COALESCE(SUM(${contracts.amount}), 0)`,
  }).from(contracts)
    .where(and(eq(contracts.ownerId, ownerId), between(contracts.date, sd, ed)));

  const statusRows = await db.select({
    status: contracts.status,
    cnt: sql<number>`COUNT(*)`,
    amt: sql<number>`COALESCE(SUM(${contracts.amount}), 0)`,
  }).from(contracts)
    .where(and(eq(contracts.ownerId, ownerId), between(contracts.date, sd, ed)))
    .groupBy(contracts.status);

  const paidRow = await db.select({
    paid: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.contractId} IS NOT NULL`,
      sql`${transactions.amount} > 0`,
      between(transactions.date, sd, ed)
    ));

  const contractRows = await db.select({
    id: contracts.id,
    date: contracts.date,
    status: contracts.status,
    amount: contracts.amount,
    customerName: customers.name,
  }).from(contracts)
    .leftJoin(customers, eq(contracts.customerId, customers.id))
    .where(and(eq(contracts.ownerId, ownerId), between(contracts.date, sd, ed)))
    .orderBy(sql`${contracts.id} DESC`);

  return { overview: overview[0], statusRows, paidRow: paidRow[0], contractRows };
}

export async function getContractPayments(db: DrizzleDb, ownerId: number, contractIds: number[], sd: string, ed: string) {
  if (contractIds.length === 0) return [];
  return db.select({
    contractId: transactions.contractId,
    paid: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      inArray(transactions.contractId, contractIds),
      sql`${transactions.amount} > 0`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.contractId);
}

// ========== 费用分析 ==========

export async function getExpenseCompose(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    name: transactions.type,
    amount: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.amount} < 0`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.type)
    .orderBy(sql`2 DESC`);
}

export async function getMonthlyExpense(db: DrizzleDb, ownerId: number, ms: string, mEndStr: string) {
  const rows = await db.select({
    amt: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.amount} < 0`,
      between(transactions.date, ms, mEndStr)
    ));
  return Number(rows[0]?.amt) || 0;
}

export async function getExpenseByUnit(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    unit: sql<string>`COALESCE(${transactions.unit}, '全公司')`,
    amount: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.amount} < 0`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(sql`COALESCE(${transactions.unit}, '全公司')`)
    .orderBy(sql`2 DESC`);
}

// ========== 阿米巴核算 ==========

export async function getUnitAddedValue(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  const { where } = buildTxFilter(ownerId, sd, ed, null);
  return db.select({
    unit: sql<string>`COALESCE(${transactions.unit}, '全公司')`,
    addedValue: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('销售收入','现金收入','其他收入') THEN ${transactions.amount} WHEN ${transactions.type} IN ('材料采购','委托加工','杂费支出') THEN -ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .where(where)
    .groupBy(sql`COALESCE(${transactions.unit}, '全公司')`)
    .orderBy(sql`2 DESC`);
}

export async function getUnitContribs(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  const { where } = buildTxFilter(ownerId, sd, ed, null);
  return db.select({
    unit: sql<string>`COALESCE(${transactions.unit}, '全公司')`,
    sales: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('销售收入','现金收入','其他收入') THEN ${transactions.amount} ELSE 0 END), 0)`,
    expense: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('材料采购','委托加工','杂费支出') THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
    addedValue: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('销售收入','现金收入','其他收入') THEN ${transactions.amount} WHEN ${transactions.type} IN ('材料采购','委托加工','杂费支出') THEN -ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .where(where)
    .groupBy(sql`COALESCE(${transactions.unit}, '全公司')`)
    .orderBy(sql`4 DESC`);
}

// ========== 商品分析小程序 ==========

export async function getProductSkuCount(db: DrizzleDb, ownerId: number) {
  const rows = await db.select({ cnt: sql<number>`COUNT(*)` })
    .from(products).where(eq(products.ownerId, ownerId));
  return Number(rows[0]?.cnt) || 0;
}

export async function getProductTop10(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    productId: transactions.productId,
    productName: products.name,
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cost: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='材料采购' THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .innerJoin(products, eq(products.id, transactions.productId))
    .where(and(
      eq(transactions.ownerId, ownerId),
      sql`${transactions.productId} IS NOT NULL`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.productId, products.name)
    .orderBy(sql`3 DESC`)
    .limit(10);
}

export async function getStockByProductIds(db: DrizzleDb, ownerId: number, pids: number[]) {
  if (pids.length === 0) return [];
  return db.select({
    productId: inventory.productId,
    qty: sql<number>`COALESCE(${inventory.quantity}, 0)`,
  }).from(inventory)
    .where(and(eq(inventory.ownerId, ownerId), inArray(inventory.productId, pids)));
}

export async function getAvgCostByProductIds(db: DrizzleDb, ownerId: number, pids: number[]) {
  if (pids.length === 0) return [];
  return db.select({
    productId: transactions.productId,
    avgCost: sql<number>`AVG(ABS(${transactions.amount}))`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.type, '材料采购'),
      sql`${transactions.amount} < 0`,
      inArray(transactions.productId, pids)
    ))
    .groupBy(transactions.productId);
}

export async function getAllProductsWithStock(db: DrizzleDb, ownerId: number) {
  return db.select({
    id: products.id,
    name: products.name,
    warningThreshold: products.warningThreshold,
    stock: sql<number>`COALESCE(${inventory.quantity}, 0)`,
  }).from(products)
    .leftJoin(inventory, and(
      eq(inventory.productId, products.id),
      eq(inventory.ownerId, products.ownerId)
    ))
    .where(eq(products.ownerId, ownerId));
}

export async function getProductGmByPids(db: DrizzleDb, ownerId: number, pids: number[], sd: string, ed: string) {
  if (pids.length === 0) return [];
  return db.select({
    productId: transactions.productId,
    sale: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`,
    cost: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='材料采购' THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      inArray(transactions.productId, pids),
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.productId);
}

// ========== 商品明细聚合（PRD v2.1 §5） ==========

/**
 * 获取全量商品明细——按商品聚合销售额/采购成本/销售数量/采购数量。
 * 使用子查询分别聚合 transaction 金额与 contract_items 数量，避免双重 JOIN 笛卡尔积。
 */
export async function getProductDetailRows(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  // ---- 子查询 A：按商品聚合交易金额 ----
  const amtSQ = db.select({
    productId: transactions.productId,
    saleAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='销售收入' THEN ${transactions.amount} ELSE 0 END), 0)`.as('sale_amt'),
    costAmt: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type}='材料采购' THEN ABS(${transactions.amount}) ELSE 0 END), 0)`.as('cost_amt'),
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      between(transactions.date, sd, ed),
      sql`${transactions.productId} IS NOT NULL`,
    ))
    .groupBy(transactions.productId).as('amt_sub');

  // ---- 子查询 B：按商品聚合合同明细数量 ----
  const qtySQ = db.select({
    productId: contractItems.productId,
    saleQty: sql<number>`COALESCE(SUM(CASE WHEN ${contracts.direction}='sale' THEN ${contractItems.quantity} ELSE 0 END), 0)`.as('sale_qty'),
    purQty: sql<number>`COALESCE(SUM(CASE WHEN ${contracts.direction}='purchase' THEN ${contractItems.quantity} ELSE 0 END), 0)`.as('purchase_qty'),
  }).from(contractItems)
    .innerJoin(contracts, eq(contractItems.contractId, contracts.id))
    .where(and(
      eq(contractItems.ownerId, ownerId),
      between(contracts.date, sd, ed),
      sql`${contractItems.productId} IS NOT NULL`,
    ))
    .groupBy(contractItems.productId).as('qty_sub');

  return db.select({
    product_id: products.id,
    name: products.name,
    sale_amt: sql<number>`COALESCE(${amtSQ.saleAmt}, 0)`,
    cost_amt: sql<number>`COALESCE(${amtSQ.costAmt}, 0)`,
    sale_qty: sql<number>`COALESCE(${qtySQ.saleQty}, 0)`,
    purchase_qty: sql<number>`COALESCE(${qtySQ.purQty}, 0)`,
  }).from(products)
    .leftJoin(amtSQ, eq(products.id, amtSQ.productId))
    .leftJoin(qtySQ, eq(products.id, qtySQ.productId))
    .where(and(
      eq(products.ownerId, ownerId),
      // 至少有一笔金额或数量记录
      sql`(COALESCE(${amtSQ.saleAmt}, 0) > 0 OR COALESCE(${amtSQ.costAmt}, 0) > 0 OR COALESCE(${qtySQ.saleQty}, 0) > 0 OR COALESCE(${qtySQ.purQty}, 0) > 0)`,
    ))
    .orderBy(sql`COALESCE(${amtSQ.saleAmt}, 0) DESC`);
}

// ========== 通用计数查询 ==========

export async function countCustomers(db: DrizzleDb, ownerId: number): Promise<number> {
  const rows = await db.select({ c: sql<number>`COUNT(*)` })
    .from(customers).where(eq(customers.ownerId, ownerId));
  return Number(rows[0]?.c) || 0;
}

export async function getTotalSaleAmount(db: DrizzleDb, ownerId: number, sd: string, ed: string, isSale: boolean): Promise<number> {
  const rows = isSale
    ? await db.select({ s: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
        .from(transactions).where(and(
          eq(transactions.ownerId, ownerId),
          eq(transactions.type, '销售收入'),
          sql`${transactions.amount} > 0`,
          between(transactions.date, sd, ed)
        ))
    : await db.select({ s: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)` })
        .from(transactions).where(and(
          eq(transactions.ownerId, ownerId),
          eq(transactions.type, '材料采购'),
          sql`${transactions.amount} < 0`,
          between(transactions.date, sd, ed)
        ));
  return Number(rows[0]?.s) || 0;
}

// ========== 看板 v2 新增查询 ==========

/** 按日聚合收入/支出趋势 */
export async function getDailyTrend(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    date: transactions.date,
    income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.amount} > 0 THEN ${transactions.amount} ELSE 0 END), 0)`,
    expense: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.amount} < 0 THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.date)
    .orderBy(transactions.date);
}

/** 按类型聚合收入构成（销售收入/现金收入/其他收入，含销售退货冲红，口径与 cockpit.addedValue 对齐） */
export async function getIncomeCompose(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    name: transactions.type,
    amount: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      inArray(transactions.type, INCOME_TYPES),
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.type)
    .orderBy(sql`2 DESC`);
}

/** 按类型聚合支出构成（材料采购/委托加工/杂费支出/税金/现金支出） */
export async function getExpenseComposeByType(db: DrizzleDb, ownerId: number, sd: string, ed: string) {
  return db.select({
    name: transactions.type,
    amount: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
  }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      inArray(transactions.type, EXPENSE_TYPES),
      sql`${transactions.amount} < 0`,
      between(transactions.date, sd, ed)
    ))
    .groupBy(transactions.type)
    .orderBy(sql`2 DESC`);
}
