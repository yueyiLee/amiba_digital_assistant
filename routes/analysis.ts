/**
 * routes/analysis.ts — 分析路由（Drizzle ORM 版）
 * 驾驶舱、客户分析、商品分析、合同分析、费用分析、阿米巴核算
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import { sql, inArray, and, eq } from 'drizzle-orm';
import {
  getTypeAggregation, getSalaryHoursAgg,
  getCustomerAgg, getProductAgg, getStaleInventory, getUnitTop,
  getCustomerAnalysis, getCustomerLastDates,
  getProductSaleAgg, getProductPurchaseAgg,
  getContractItemAgg, getPriceTrend,
  getContractAnalysis, getContractPayments,
  getExpenseCompose, getMonthlyExpense, getExpenseByUnit,
  getUnitAddedValue, getUnitContribs,
  getProductSkuCount, getProductTop10,
  getStockByProductIds, getAvgCostByProductIds,
  getAllProductsWithStock, getProductGmByPids,
  countCustomers, getTotalSaleAmount,
  buildTxFilter,
} from '../drizzle/queries/analysis.queries.js';
import { getInventoryValue } from '../drizzle/queries/inventory.queries.js';
import { transactions } from '../drizzle/schema/transactions.js';
import { ok, failErr, numOf, daysSince, fmtCny, productAnalysis } from './lib/helpers';

const router: Router = express.Router();

/* ========== 分析驾驶舱 ========== */
const COCKPIT_ALERT_RULES = {
  customerRecvRed: 80000,
  customerRecvYellow: 40000,
  productMargin: 0.15,
  productStockAge: 60,
  cashGap: -20000,
};
const COCKPIT_ALERT_LIMIT = 10;

interface AlertItem {
  level: string;
  title: string;
  sub: string;
  value: string;
  jumpTo: string;
}

async function cockpitAnalysis(ownerId: number, sd: string, ed: string, unit?: string | null) {
  const db = getDb();
  const typeRows = await getTypeAggregation(db, ownerId, sd, ed, unit);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type] = numOf(r.raw); absAmt[r.type] = numOf(r.absAmt); });

  const salesIncome: number = raw['销售收入'] || 0;
  const cashIncome: number = raw['现金收入'] || 0;
  const otherIncome: number = raw['其他收入'] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt['材料采购'] || 0;
  const processCost: number = absAmt['委托加工'] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt['杂费支出'] || 0;
  const cashExpense: number = absAmt['现金支出'] || 0;
  const taxCost: number = absAmt['税金'] || 0;
  const receivable: number = salesIncome - cashIncome;
  const addedValue: number = totalIncome - consumeCost - miscCost;
  const totalExpense: number = materialCost + processCost + miscCost + taxCost;
  const payable: number = totalExpense - cashExpense;

  const smk: string = String(sd).slice(0, 7), emk: string = String(ed).slice(0, 7);
  const salaryRow = await getSalaryHoursAgg(db, ownerId, smk, emk);
  const totalSalary: number = numOf(salaryRow.salary);
  const totalHours: number = numOf(salaryRow.hours);
  const profit: number = addedValue - totalSalary - taxCost;
  const netCashFlow: number = cashIncome - cashExpense;

  const inventoryValue: number = await getInventoryValue(db, ownerId);

  const custRows = await getCustomerAgg(db, ownerId, sd, ed, unit);
  const prodRows = await getProductAgg(db, ownerId, sd, ed, unit);
  const productMetrics = prodRows.map((r) => {
    const sale: number = numOf(r.sale), cost: number = numOf(r.cost);
    return { id: r.productId, name: r.productName, sale, cost, gm: sale > 0 ? (sale - cost) / sale : 0 };
  });

  const staleRows = await getStaleInventory(db, ownerId);

  const alerts: AlertItem[] = [];
  custRows.forEach((r) => {
    const recv: number = numOf(r.recv);
    if (recv >= COCKPIT_ALERT_RULES.customerRecvRed) {
      alerts.push({ level: 'red', title: `客户【${r.customerName}】应收 ${fmtCny(recv)}`, sub: '超过预警阈值，建议立即跟进回款', value: fmtCny(recv), jumpTo: 'customer' });
    } else if (recv >= COCKPIT_ALERT_RULES.customerRecvYellow) {
      alerts.push({ level: 'yellow', title: `客户【${r.customerName}】应收 ${fmtCny(recv)}`, sub: '需保持关注', value: fmtCny(recv), jumpTo: 'customer' });
    }
  });
  productMetrics.forEach((r) => {
    if (r.sale > 0 && r.gm < COCKPIT_ALERT_RULES.productMargin) {
      const pct: string = `${(r.gm * 100).toFixed(1)}%`;
      alerts.push({ level: 'red', title: `商品【${r.name}】毛利率 ${pct}`, sub: '毛利率跌破健康线', value: pct, jumpTo: 'product' });
    }
  });
  staleRows.forEach((r) => {
    const days: number = Math.floor(numOf(r.days));
    if (days > COCKPIT_ALERT_RULES.productStockAge) {
      alerts.push({ level: 'yellow', title: `商品【${(r.productName as string) || '未知商品'}】库存呆滞 ${days} 天`, sub: '建议盘点/促销/调拨', value: `${days} 天`, jumpTo: 'product' });
    }
  });
  if (netCashFlow < COCKPIT_ALERT_RULES.cashGap) {
    alerts.push({ level: 'red', title: `净现金流 ${fmtCny(netCashFlow)}`, sub: '现金缺口较大，关注回款', value: fmtCny(netCashFlow), jumpTo: 'overview' });
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  const unitRows = await getUnitTop(db, ownerId, sd, ed, unit);
  const topCustomer = custRows.length > 0 ? custRows.slice().sort((a, b) => numOf(b.sale) - numOf(a.sale))[0] : undefined;
  const topProduct = productMetrics.length > 0 ? productMetrics.slice().sort((a, b) => b.sale - a.sale)[0] : undefined;
  const topUnit = unitRows.length > 0 ? unitRows[0] : undefined;

  const tops = [
    { label: 'Top 客户贡献', name: topCustomer ? (topCustomer.customerName as string) : '', value: topCustomer ? fmtCny(numOf(topCustomer.sale)) : '', jumpTo: 'customer' },
    { label: 'Top 商品销售', name: topProduct ? (topProduct.name as string) : '', value: topProduct ? fmtCny(topProduct.sale) : '', jumpTo: 'product' },
    { label: '单元附加价值排行', name: topUnit ? (topUnit.unit as string) : '', value: topUnit ? fmtCny(numOf(topUnit.addedValue)) : '', jumpTo: 'amoeba' },
  ];

  return {
    kpi: { total_sales: salesIncome, total_profit: profit, receivable, payable, net_cash_flow: netCashFlow, inventory_value: inventoryValue, profit_rate: salesIncome > 0 ? (profit / salesIncome) * 100 : 0, added_value: addedValue, total_hours: totalHours, total_salary: totalSalary },
    alerts: alerts.slice(0, COCKPIT_ALERT_LIMIT),
    alert_count: { red: alerts.filter((a) => a.level === 'red').length, yellow: alerts.filter((a) => a.level === 'yellow').length },
    tops,
    unit_hours_available: false,
  };
}

router.get('/analysis/cockpit', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, unit } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await cockpitAnalysis(req.user!.id, sd, ed, unit));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 商品分析（销售/采购） ========== */
router.get('/analysis/product-sales', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user!.id, 'sale', sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

router.get('/analysis/product-purchase', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user!.id, 'purchase', sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 客户分析 ========== */
async function customerAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const { totalCount, activeCount, recvRow, custAgg } = await getCustomerAnalysis(db, ownerId, sd, ed);

  const totalSale: number = numOf(recvRow.sale);
  const totalCash: number = numOf(recvRow.cash);
  const totalReceivable: number = totalSale - totalCash;

  const lastDateMap: Record<number, string> = {};
  if (custAgg.length > 0) {
    const cids: number[] = custAgg.map((r) => r.customerId as number).filter((id): id is number => id !== null && !isNaN(id));
    const lastRows = await getCustomerLastDates(db, ownerId, cids);
    lastRows.forEach((r) => { lastDateMap[r.customerId as number] = r.lastDate; });
  }

  const top5 = custAgg.slice(0, 5).map((r) => {
    const sale: number = numOf(r.sale);
    const cash: number = numOf(r.cash);
    const cost: number = numOf(r.cost);
    const recv: number = sale - cash;
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const lastDate: string = lastDateMap[r.customerId as number] || '';
    const ageDays: number = daysSince(lastDate);
    return { customer_id: r.customerId, customer_name: r.customerName, sale, cash, receivable: recv, gm, last_date: lastDate, age_days: ageDays };
  });

  const allCustAging = custAgg.filter((r) => {
    const sale: number = numOf(r.sale), cash: number = numOf(r.cash);
    return sale - cash > 0;
  }).map((r) => {
    const recv: number = numOf(r.sale) - numOf(r.cash);
    const lastDate: string = lastDateMap[r.customerId as number] || '';
    return { recv, lastDate };
  });

  const allAging = { within30: 0, within60: 0, over60: 0 };
  allCustAging.forEach((r) => {
    const ageDays: number = daysSince(r.lastDate);
    if (ageDays <= 30) allAging.within30 += r.recv;
    else if (ageDays <= 60) allAging.within60 += r.recv;
    else allAging.over60 += r.recv;
  });
  const allAgingTotal: number = allAging.within30 + allAging.within60 + allAging.over60;

  const allCust = custAgg.map((r) => ({ name: r.customerName as string, sale: numOf(r.sale) }));
  const grandSale: number = allCust.reduce((s, c) => s + c.sale, 0);
  allCust.sort((a, b) => b.sale - a.sale);
  let cum = 0;
  const tiers: { name: string; sale: number; tier: string }[] = [];
  allCust.forEach((c) => {
    cum += c.sale;
    const pct: number = grandSale > 0 ? cum / grandSale : 0;
    let tier: string;
    if (pct <= 0.2) tier = 'A';
    else if (pct <= 0.5) tier = 'B';
    else tier = 'C';
    tiers.push({ name: c.name, sale: c.sale, tier });
  });

  const tierSummary: Record<string, number> = { A: 0, B: 0, C: 0 };
  const tierAmounts: Record<string, number> = { A: 0, B: 0, C: 0 };
  tiers.forEach((t) => { tierSummary[t.tier]++; tierAmounts[t.tier] += t.sale; });

  return {
    kpi: { customer_count: totalCount, active_count: activeCount, total_receivable: totalReceivable },
    top5,
    aging: { buckets: allAging, total: allAgingTotal },
    tiers: { list: tiers, summary: tierSummary, amounts: tierAmounts },
  };
}

router.get('/analysis/customer', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await customerAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 商品分析（小程序） ========== */
async function productMiniAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const salesData = await productAnalysis(ownerId, 'sale', sd, ed);

  const skuCount = await getProductSkuCount(db, ownerId);
  const inventoryValue: number = await getInventoryValue(db, ownerId);

  const topRows = await getProductTop10(db, ownerId, sd, ed);

  const pids: number[] = topRows.map((r) => r.productId as number);
  const stockMap: Record<number, number> = {};
  if (pids.length > 0) {
    const stockRows = await getStockByProductIds(db, ownerId, pids);
    stockRows.forEach((r) => { stockMap[r.productId as number] = Number(r.qty) || 0; });
  }

  const costAvgMap: Record<number, number> = {};
  if (pids.length > 0) {
    const avgRows = await getAvgCostByProductIds(db, ownerId, pids);
    avgRows.forEach((r) => { costAvgMap[r.productId as number] = Number(r.avgCost) || 0; });
  }

  const topProducts = topRows.map((r) => {
    const sale: number = numOf(r.sale);
    const cost: number = numOf(r.cost);
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const stock: number = stockMap[r.productId as number] || 0;
    const daysDiff: number = Math.max(1, Math.ceil((new Date(ed).getTime() - new Date(sd).getTime()) / 86400000));
    const dailySale: number = sale / daysDiff;
    const turnoverDays: number = dailySale > 0 ? Math.round(stock / dailySale) : 0;
    return { product_id: r.productId, product_name: r.productName, sale, gm, stock, turnover_days: turnoverDays };
  });

  const ALL_PRODUCTS = await getAllProductsWithStock(db, ownerId);

  const gmMap: Record<number, number> = {};
  topProducts.forEach((p) => { gmMap[p.product_id as number] = p.gm; });

  if (ALL_PRODUCTS.length > 0) {
    const allPids: number[] = ALL_PRODUCTS.map((p) => p.id);
    const gmRows = await getProductGmByPids(db, ownerId, allPids, sd, ed);
    gmRows.forEach((r) => {
      if (!gmMap[r.productId as number]) {
        const s: number = numOf(r.sale), c: number = numOf(r.cost);
        gmMap[r.productId as number] = s > 0 ? (s - c) / s : 0;
      }
    });
  }

  const MARGIN_THRESHOLD = 0.15;
  const alerts: Record<string, unknown>[] = [];

  ALL_PRODUCTS.forEach((p) => {
    const gm = gmMap[p.id];
    if (gm !== undefined && gm < MARGIN_THRESHOLD) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `毛利率 ${(gm * 100).toFixed(1)}% 跌破 ${(MARGIN_THRESHOLD * 100).toFixed(0)}%`, type: 'low_margin' });
    }
    if (p.warningThreshold as number > 0 && (p.stock as number) <= (p.warningThreshold as number)) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `库存 ${p.stock} ≤ 安全线 ${p.warningThreshold}，建议补货`, type: 'low_stock' });
    }
  });

  topProducts.forEach((p) => {
    if (p.turnover_days > 90) {
      alerts.push({ level: 'yellow', product_name: p.product_name, product_id: p.product_id, reason: `周转 ${p.turnover_days} 天，库存呆滞风险`, type: 'slow_turnover' });
    }
  });

  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  return {
    kpi: { sku_count: skuCount, inventory_value: inventoryValue, avg_gm: salesData.avg_gm },
    top_products: topProducts,
    alerts,
    alert_count: { red: alerts.filter((a) => a.level === 'red').length, yellow: alerts.filter((a) => a.level === 'yellow').length },
  };
}

router.get('/analysis/product', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productMiniAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 合同分析 ========== */
async function contractAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const { overview, statusRows, paidRow, contractRows } = await getContractAnalysis(db, ownerId, sd, ed);

  const totalAmount: number = numOf(overview.totalAmount);
  const totalPaid: number = numOf(paidRow.paid);
  const executionRate: number = totalAmount > 0 ? totalPaid / totalAmount : 0;
  const unpaidAmount: number = Math.max(0, totalAmount - totalPaid);

  const statusMap: Record<string, { count: number; amount: number }> = {};
  statusRows.forEach((r) => { statusMap[r.status || '进行中'] = { count: Number(r.cnt), amount: numOf(r.amt) }; });
  const inProgress = statusMap['进行中'] || { count: 0, amount: 0 };
  const completed = statusMap['已完结'] || { count: 0, amount: 0 };
  const dunning = statusMap['催收中'] || { count: 0, amount: 0 };

  const cids: number[] = contractRows.map((r) => r.id);
  const paidMap: Record<number, number> = {};
  const lastPaidMap: Record<number, string> = {};

  if (cids.length > 0) {
    const paidRows = await getContractPayments(db, ownerId, cids, sd, ed);
    paidRows.forEach((r) => { paidMap[r.contractId as number] = numOf(r.paid); });

    // 获取最后支付日期
    const lastRows = await db.select({
      contractId: transactions.contractId,
      lastDate: sql<string>`MAX(${transactions.date})`,
    }).from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), inArray(transactions.contractId, cids), sql`${transactions.amount} > 0`))
      .groupBy(transactions.contractId);
    lastRows.forEach((r) => { lastPaidMap[r.contractId as number] = r.lastDate; });
  }

  const contractList = contractRows.map((r) => {
    const paid: number = paidMap[r.id] || 0;
    const unpaid: number = Math.max(0, numOf(r.amount) - paid);
    const lastDate: string = lastPaidMap[r.id] || r.date || '';
    const ageDays: number = daysSince(lastDate);
    return { id: r.id, customer_name: r.customerName || '—', date: r.date || '', amount: numOf(r.amount), paid, unpaid, status: r.status || '进行中', age_days: ageDays };
  });

  return {
    kpi: { total_amount: totalAmount, execution_rate: executionRate, unpaid_amount: unpaidAmount, status_summary: { in_progress: { count: inProgress.count, amount: inProgress.amount }, completed: { count: completed.count, amount: completed.amount }, dunning: { count: dunning.count, amount: dunning.amount } } },
    contracts: contractList,
  };
}

router.get('/analysis/contract', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await contractAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 费用分析 ========== */
async function expenseAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const composeRows = await getExpenseCompose(db, ownerId, sd, ed);
  const compose = composeRows.map((r) => ({ name: r.name, amount: numOf(r.amount) }));
  const totalExpense: number = compose.reduce((s, r) => s + r.amount, 0);

  const trendData: { month: string; amount: number }[] = [];
  const endParts: number[] = String(ed).split('-').map(Number);
  const endYear: number = endParts[0], endMonth: number = endParts[1];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(endYear, endMonth - 1 - i, 1);
    const ms: string = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const mEndStr: string = `${mEnd.getFullYear()}-${String(mEnd.getMonth() + 1).padStart(2, '0')}-${String(mEnd.getDate()).padStart(2, '0')}`;
    const amt = await getMonthlyExpense(db, ownerId, ms + '-01', mEndStr);
    trendData.push({ month: ms, amount: amt });
  }

  const unitRows = await getExpenseByUnit(db, ownerId, sd, ed);
  const units = unitRows.map((r) => ({ unit: r.unit, amount: numOf(r.amount) }));
  const unitTotal: number = units.reduce((s, r) => s + r.amount, 0);

  return { compose, total_expense: totalExpense, trend: trendData, units, unit_total: unitTotal };
}

router.get('/analysis/expense', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await expenseAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 阿米巴核算 ========== */
async function amoebaAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const typeRows = await getTypeAggregation(db, ownerId, sd, ed, null);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type] = numOf(r.raw); absAmt[r.type] = numOf(r.absAmt); });

  const salesIncome: number = raw['销售收入'] || 0;
  const cashIncome: number = raw['现金收入'] || 0;
  const otherIncome: number = raw['其他收入'] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt['材料采购'] || 0;
  const processCost: number = absAmt['委托加工'] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt['杂费支出'] || 0;
  const addedValue: number = totalIncome - consumeCost - miscCost;

  const smk: string = String(sd).slice(0, 7), emk: string = String(ed).slice(0, 7);
  const salaryRow = await getSalaryHoursAgg(db, ownerId, smk, emk);
  const totalSalary: number = numOf(salaryRow.salary);
  const totalHours: number = numOf(salaryRow.hours);

  const hourlyAddedValue: number = totalHours > 0 ? addedValue / totalHours : 0;
  const hourlyLaborCost: number = totalHours > 0 ? totalSalary / totalHours : 0;
  const breakeven: number = addedValue - totalSalary;

  // 上期数据
  const prevSd = new Date(Number(String(sd).slice(0, 4)), Number(String(sd).slice(5, 7)) - 2, 1);
  const prevEd = new Date(Number(String(ed).slice(0, 4)), Number(String(ed).slice(5, 7)) - 1, 0);
  const prevSdStr: string = `${prevSd.getFullYear()}-${String(prevSd.getMonth() + 1).padStart(2, '0')}-${String(prevSd.getDate()).padStart(2, '0')}`;
  const prevEdStr: string = `${prevEd.getFullYear()}-${String(prevEd.getMonth() + 1).padStart(2, '0')}-${String(prevEd.getDate()).padStart(2, '0')}`;

  let prevHourlyAddedValue: number | null = null;
  try {
    const prevTypeRows = await getTypeAggregation(db, ownerId, prevSdStr, prevEdStr, null);
    const pRaw: Record<string, number> = {};
    const pAbs: Record<string, number> = {};
    prevTypeRows.forEach((r) => { pRaw[r.type] = numOf(r.raw); pAbs[r.type] = numOf(r.absAmt); });
    const pAdded: number = (pRaw['销售收入'] || 0) + (pRaw['现金收入'] || 0) + (pRaw['其他收入'] || 0) - ((pAbs['材料采购'] || 0) + (pAbs['委托加工'] || 0)) - (pAbs['杂费支出'] || 0);

    const pSmk: string = String(prevSdStr).slice(0, 7), pEmk: string = String(prevEdStr).slice(0, 7);
    const prevSalRow = await getSalaryHoursAgg(db, ownerId, pSmk, pEmk);
    const prevHours: number = numOf(prevSalRow.hours);
    if (prevHours > 0) prevHourlyAddedValue = pAdded / prevHours;
  } catch (_e: unknown) { /* 上月数据缺失不影响当期 */ }

  const unitValues = (await getUnitAddedValue(db, ownerId, sd, ed))
    .map((r) => ({ unit: r.unit, added_value: numOf(r.addedValue) }));

  const unitContribs = (await getUnitContribs(db, ownerId, sd, ed))
    .map((r) => ({ unit: r.unit, sales: numOf(r.sales), expense: numOf(r.expense), added_value: numOf(r.addedValue), hours: null, hourly_value: null }));

  return {
    kpi: { added_value: addedValue, total_hours: totalHours, hourly_labor_cost: hourlyLaborCost, breakeven: breakeven },
    hourly_added_value: hourlyAddedValue,
    prev_hourly_added_value: prevHourlyAddedValue,
    unit_values: unitValues,
    unit_contribs: unitContribs,
    unit_hours_available: false,
  };
}

router.get('/analysis/amoeba', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await amoebaAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
