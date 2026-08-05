/**
 * routes/analysis.ts — 分析路由（Drizzle ORM 版）
 * 驾驶舱、客户分析、商品分析、合同分析、费用分析、阿米巴核算
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import {
  getTypeAggregation, getSalaryHoursAgg,
  getCustomerAgg, getProductAgg, getStaleInventory, getUnitTop,
  getCustomerAnalysis, getCustomerLastDates,
  getContractAnalysis, getContractPayments,
  getExpenseCompose, getMonthlyExpenseByType, getMonthlyCashFlow,
  getUnitAddedValue, getUnitContribs,
  getProductDetailRows,
  getDailyTrend, getIncomeCompose, getExpenseComposeByType,
} from '../drizzle/queries/analysis.queries.js';
import { getInventoryValue } from '../drizzle/queries/inventory.queries.js';
import { ok, failErr, numOf, daysSince, fmtCny, productAnalysis } from './lib/helpers';

const router: Router = express.Router();

/* ========== 交易类型常量（PRD v2.1 统一口径） ========== */
const T = {
  SALES: '销售收入',
  CASH_IN: '现金收入',
  OTHER_IN: '其他收入',
  MATERIAL: '材料采购',
  PROCESS: '委托加工',
  MISC: '杂费支出',
  TAX: '税金',
  DUTY: '缴纳税金',
  CASH_OUT: '现金支出',
} as const;

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

  const salesIncome: number = raw[T.SALES] || 0;
  const cashIncome: number = raw[T.CASH_IN] || 0;
  const otherIncome: number = raw[T.OTHER_IN] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt[T.MATERIAL] || 0;
  const processCost: number = absAmt[T.PROCESS] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt[T.MISC] || 0;
  const cashExpense: number = absAmt[T.CASH_OUT] || 0;
  const taxCost: number = absAmt[T.TAX] || 0;
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

/* ========== 经营总览（PRD v2.1 §3） ========== */
interface OverviewAlert {
  level: 'red' | 'yellow';
  title: string;
  sub: string;
  jump_to: string;
  jump_key?: string;
}

interface OverviewTopCustomer {
  id: number;
  name: string;
  sale: number;
  receivable: number;
  last_date: string;
  status: 'normal' | 'late' | 'risk';
}

interface OverviewTopProduct {
  name: string;
  sale: number;
}

async function overviewAnalysis(ownerId: number, sd: string, ed: string, unit?: string | null) {
  const db = getDb();
  const typeRows = await getTypeAggregation(db, ownerId, sd, ed, unit);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type] = numOf(r.raw); absAmt[r.type] = numOf(r.absAmt); });

  const salesIncome: number = raw[T.SALES] || 0;
  const cashIncome: number = raw[T.CASH_IN] || 0;
  const otherIncome: number = raw[T.OTHER_IN] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt[T.MATERIAL] || 0;
  const processCost: number = absAmt[T.PROCESS] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt[T.MISC] || 0;
  const taxCost: number = absAmt['税金'] || 0;
  const receivable: number = salesIncome - cashIncome;
  const addedValue: number = totalIncome - consumeCost - miscCost;
  const totalExpense: number = materialCost + processCost + miscCost + taxCost;

  const smk: string = String(sd).slice(0, 7), emk: string = String(ed).slice(0, 7);
  const salaryRow = await getSalaryHoursAgg(db, ownerId, smk, emk);
  const totalSalary: number = numOf(salaryRow.salary);
  const totalHours: number = numOf(salaryRow.hours);
  const profit: number = addedValue - totalSalary - taxCost;
  const unitAddedValue: number = totalHours > 0 ? addedValue / totalHours : 0;

  // ---- 预警（PRD v2.1 §3.4） ----
  const custRows = await getCustomerAgg(db, ownerId, sd, ed, unit);
  const prodRows = await getProductAgg(db, ownerId, sd, ed, unit);
  const productMetrics = prodRows.map((r) => {
    const sale: number = numOf(r.sale), cost: number = numOf(r.cost);
    return { id: r.productId, name: r.productName, sale, cost, gm: sale > 0 ? (sale - cost) / sale : 0 };
  });

  const staleRows = await getStaleInventory(db, ownerId);
  const cashExpense: number = absAmt[T.CASH_OUT] || 0;
  const netCashFlow: number = cashIncome - cashExpense;

  const alerts: OverviewAlert[] = [];

  custRows.forEach((r) => {
    const recv: number = numOf(r.recv);
    const name = r.customerName as string;
    if (recv >= COCKPIT_ALERT_RULES.customerRecvRed) {
      alerts.push({ level: 'red', title: '客户大额应收', sub: `${name} - ${fmtCny(recv)}`, jump_to: 'customer', jump_key: name });
    } else if (recv >= COCKPIT_ALERT_RULES.customerRecvYellow) {
      alerts.push({ level: 'yellow', title: '客户中等应收', sub: `${name} - ${fmtCny(recv)}`, jump_to: 'customer', jump_key: name });
    }
  });

  productMetrics.forEach((r) => {
    if (r.sale > 0 && r.gm < COCKPIT_ALERT_RULES.productMargin) {
      alerts.push({ level: 'red', title: '商品毛利率过低', sub: `${r.name} - ${(r.gm * 100).toFixed(1)}%`, jump_to: 'product', jump_key: r.name as string });
    }
  });

  staleRows.forEach((r) => {
    const days: number = Math.floor(numOf(r.days));
    const pname = (r.productName as string) || '未知商品';
    if (days > COCKPIT_ALERT_RULES.productStockAge) {
      alerts.push({ level: 'yellow', title: '商品库存呆滞', sub: `${pname} - ${days} 天`, jump_to: 'product', jump_key: pname });
    }
  });

  if (netCashFlow < COCKPIT_ALERT_RULES.cashGap) {
    alerts.push({ level: 'red', title: '净现金流缺口', sub: fmtCny(netCashFlow), jump_to: 'cash' });
  }

  // 红色优先，同客户去重
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
  const seenNames = new Set<string>();
  const dedupedAlerts = alerts.filter((a) => {
    if (a.jump_key && seenNames.has(a.jump_key)) return false;
    if (a.jump_key) seenNames.add(a.jump_key);
    return true;
  });

  // ---- Top 5 客户（PRD v2.1 §3.5） ----
  const sortedCust = custRows
    .map((r) => {
      const recv: number = numOf(r.recv);
      let status: 'normal' | 'late' | 'risk' = 'normal';
      if (recv >= COCKPIT_ALERT_RULES.customerRecvRed) status = 'risk';
      else if (recv >= COCKPIT_ALERT_RULES.customerRecvYellow) status = 'late';
      return {
        id: r.customerId as number,
        name: r.customerName as string,
        sale: numOf(r.sale),
        receivable: recv,
        last_date: (r as any).lastDate || '',
        status,
      };
    })
    .sort((a, b) => b.receivable - a.receivable)
    .slice(0, 5);

  // ---- Top 5 商品（PRD v2.1 §3.5） ----
  const top5Products: OverviewTopProduct[] = productMetrics
    .sort((a, b) => b.sale - a.sale)
    .slice(0, 5)
    .map((r) => ({ name: r.name as string, sale: r.sale }));

  return {
    kpi: {
      sales_income: salesIncome,
      receivable,
      added_value: addedValue,
      unit_added_value: unitAddedValue,
      total_expense: totalExpense,
      total_profit: profit,
    },
    alerts: dedupedAlerts.slice(0, COCKPIT_ALERT_LIMIT),
    alert_count: {
      red: dedupedAlerts.filter((a) => a.level === 'red').length,
      yellow: dedupedAlerts.filter((a) => a.level === 'yellow').length,
    },
    top_customers: sortedCust,
    top_products: top5Products,
  };
}

router.get('/analysis/overview', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, unit } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await overviewAnalysis(req.user!.id, sd, ed, unit));
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

/* ========== 商品分析（小程序 — PRD v2.1 §5） ========== */

/** 将 productAnalysis() 返回字段映射为前端 IProductRankItem */
function mapRank(items: { product_id: number | null; product_name: string | null; total_qty?: number; total_amount?: number; qty?: number; amount?: number }[]): { product_id: number | null; product_name: string | null; qty: number; amount: number }[] {
  return items.map(r => ({
    product_id: r.product_id,
    product_name: r.product_name,
    qty: r.total_qty ?? r.qty ?? 0,
    amount: r.total_amount ?? r.amount ?? 0,
  }));
}

/** 将 productAnalysis() 返回的 price_change 映射为前端 IProductPriceChange */
function mapPriceChange(items: { product_name?: string; change?: number; min?: number; max?: number; samples?: number }[]): { product_id: number | null; product_name: string | null; min_price: number; max_price: number; change_rate: number; sample_count: number }[] {
  return items.map(r => ({
    product_id: null, // 价格变动榜无 product_id（来自多笔成交聚合）
    product_name: r.product_name ?? null,
    min_price: r.min ?? 0,
    max_price: r.max ?? 0,
    change_rate: r.change ?? 0,
    sample_count: r.samples ?? 0,
  }));
}

async function productMiniAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();

  // 并行获取收入/支出双视角数据 + 商品明细
  const [salesRaw, purchaseRaw, detailRows] = await Promise.all([
    productAnalysis(ownerId, 'sale', sd, ed),
    productAnalysis(ownerId, 'purchase', sd, ed),
    getProductDetailRows(db, ownerId, sd, ed),
  ]);

  // ---- 收入类（销售） ----
  const sales = {
    kpi: {
      total_qty: salesRaw.total_qty,
      total_sale: salesRaw.total_sale,
      avg_gm: salesRaw.avg_gm,
    },
    by_qty: mapRank(salesRaw.by_qty.map(r => ({ product_id: r.product_id, product_name: r.product_name, total_qty: r.total_qty, total_amount: r.total_amount }))),
    by_amount: mapRank(salesRaw.by_amount.map(r => ({ product_id: r.product_id, product_name: r.product_name, amount: r.total_amount }))),
    price_change: mapPriceChange(salesRaw.price_change as any[]),
  };

  // ---- 支出类（采购） ----
  const purchase = {
    kpi: {
      total_qty: purchaseRaw.total_qty,
      total_cost: purchaseRaw.total_cost,
    },
    by_qty: mapRank(purchaseRaw.by_qty.map(r => ({ product_id: r.product_id, product_name: r.product_name, total_qty: r.total_qty, total_amount: r.total_amount }))),
    by_amount: mapRank(purchaseRaw.by_amount.map(r => ({ product_id: r.product_id, product_name: r.product_name, amount: r.total_amount }))),
    price_change: mapPriceChange(purchaseRaw.price_change as any[]),
  };

  // ---- 商品明细（跨 Tab 固定） ----
  const detail = detailRows.map(r => {
    const sa: number = numOf(r.sale_amt);
    const ca: number = numOf(r.cost_amt);
    const sq: number = numOf(r.sale_qty);
    const pq: number = numOf(r.purchase_qty);
    const gm: number = sa > 0 ? (sa - ca) / sa : 0;
    return {
      product_id: r.product_id,
      name: r.name ?? '',
      sale_amt: sa,
      cost_amt: ca,
      sale_qty: sq,
      purchase_qty: pq,
      gm,
    };
  }).filter(d => d.sale_amt > 0 || d.cost_amt > 0);

  return { sales, purchase, detail };
}

router.get('/analysis/product', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productMiniAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 合同分析（PRD v2.1 §6） ========== */

/** 根据执行率派生前端状态徽章文本 */
function deriveContractStatus(ratio: number): string {
  if (ratio < 0.3) return '回款滞后';
  if (ratio < 0.7) return '执行中';
  return '健康';
}

async function contractAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const { overview, paidRow, contractRows } = await getContractAnalysis(db, ownerId, sd, ed);

  // ---- KPI（3 项） ----
  const totalAmount: number = numOf(overview.totalAmount);
  const totalPaid: number = numOf(paidRow.paid);
  const totalUnpaid: number = Math.max(0, totalAmount - totalPaid);

  // ---- 各合同回款映射 ----
  const cids: number[] = contractRows.map((r) => r.id);
  const paidMap: Record<number, number> = {};

  if (cids.length > 0) {
    const paidRows = await getContractPayments(db, ownerId, cids, sd, ed);
    paidRows.forEach((r) => { paidMap[r.contractId as number] = numOf(r.paid); });
  }

  // ---- 合同明细行（PRD v2.1 §6.1） ----
  const rows = contractRows.map((r) => {
    const amount: number = numOf(r.amount);
    const paid: number = paidMap[r.id] || 0;
    const unpaid: number = Math.max(0, amount - paid);
    const ratio: number = amount > 0 ? Math.min(paid / amount, 1) : 0;
    const status: string = deriveContractStatus(ratio);
    // 合同名：优先 contractNo，缺失回退 #合同ID
    const name: string = (r.contractNo as string)?.trim() || `#合同${r.id}`;
    return {
      id: r.id,
      name,
      customer: (r.customerName as string) || '—',
      amount,
      paid,
      unpaid,
      ratio,
      status,
      start_date: (r.startDate as string) || '',
      end_date: (r.endDate as string) || '',
    };
  });

  return {
    kpi: { total_amount: totalAmount, total_paid: totalPaid, total_unpaid: totalUnpaid },
    rows,
  };
}

router.get('/analysis/contract', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await contractAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 费用分析（PRD v2.1 §7） ========== */

/** 分类名 → 前端色键映射 */
const EXPENSE_COLOR_MAP: Record<string, string> = {
  [T.MATERIAL]: 'blue',
  [T.PROCESS]: 'orange',
  [T.MISC]: 'purple',
  [T.DUTY]: 'red',
};

async function expenseAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();

  // 并行获取构成 + 月度分类趋势
  const [composeRows, trendRows] = await Promise.all([
    getExpenseCompose(db, ownerId, sd, ed),
    getMonthlyExpenseByType(db, ownerId, sd, ed),
  ]);

  // ---- KPI：从 compose 提取五大指标 ----
  const catMap: Record<string, number> = {};
  composeRows.forEach((r) => { catMap[r.name as string] = numOf(r.amount); });
  const material: number = catMap[T.MATERIAL] || 0;
  const process: number = catMap[T.PROCESS] || 0;
  const misc: number = catMap[T.MISC] || 0;
  const tax: number = catMap[T.DUTY] || 0;
  const total: number = material + process + misc + tax;

  // ---- 月度趋势：pivot 行 → 按月份合并分类 ----
  const monthMap: Record<string, { material: number; process: number; misc: number; tax: number }> = {};
  trendRows.forEach((r) => {
    const m: string = r.month as string;
    const t: string = r.type as string;
    const amt: number = numOf(r.amount);
    if (!monthMap[m]) monthMap[m] = { material: 0, process: 0, misc: 0, tax: 0 };
    if (t === T.MATERIAL) monthMap[m].material += amt;
    else if (t === T.PROCESS) monthMap[m].process += amt;
    else if (t === T.MISC) monthMap[m].misc += amt;
    else if (t === T.DUTY) monthMap[m].tax += amt;
  });

  const trend = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cats]) => ({
      month,
      material: cats.material,
      process: cats.process,
      misc: cats.misc,
      tax: cats.tax,
      total: cats.material + cats.process + cats.misc + cats.tax,
    }));

  // ---- 费用构成（环形图） ----
  const compose = composeRows.map((r) => ({
    name: r.name as string,
    amount: numOf(r.amount),
    color_key: EXPENSE_COLOR_MAP[r.name as string] || 'gray',
  }));

  return {
    kpi: { total, material, process, misc, tax },
    trend,
    compose,
  };
}

router.get('/analysis/expense', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await expenseAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 资金分析（PRD v2.1 §8） ========== */

async function cashAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();

  // 并行获取类型聚合 + 月度现金流行 + 客户分析
  const [typeRows, cashFlowRows, custAgg] = await Promise.all([
    getTypeAggregation(db, ownerId, sd, ed, null /* 不过滤单元 */),
    getMonthlyCashFlow(db, ownerId, sd, ed),
    getCustomerAnalysis(db, ownerId, sd, ed),
  ]);

  // ---- KPI ----
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type] = numOf(r.raw); absAmt[r.type] = numOf(r.absAmt); });
  const cashIn: number = raw[T.CASH_IN] || 0;
  const cashOut: number = absAmt[T.CASH_OUT] || 0;
  const netCash: number = cashIn - cashOut;
  const receivable: number = Math.max(0, (raw[T.SALES] || 0) - cashIn);

  // ---- 月度趋势：pivot 行为 { month, in, out, net } ----
  const monthMap: Record<string, { in: number; out: number }> = {};
  cashFlowRows.forEach((r) => {
    const m: string = r.month as string;
    const t: string = r.type as string;
    const amt: number = numOf(r.amount);
    if (!monthMap[m]) monthMap[m] = { in: 0, out: 0 };
    if (t === T.CASH_IN) monthMap[m].in += amt;
    else if (t === T.CASH_OUT) monthMap[m].out += amt;
  });
  const trend = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({
      month,
      in: vals.in,
      out: vals.out,
      net: vals.in - vals.out,
    }));

  // ---- 客户账龄（PRD §8.1） ----
  const lastDateMap: Record<number, string> = {};
  if (custAgg.custAgg.length > 0) {
    const cids: number[] = custAgg.custAgg.map((r) => r.customerId as number);
    const dates = await getCustomerLastDates(db, ownerId, cids);
    dates.forEach((r) => { lastDateMap[r.customerId as number] = r.lastDate as string; });
  }

  const aging = custAgg.custAgg
    .map((r) => {
      const sale: number = numOf(r.sale);
      const cash: number = numOf(r.cash);
      const recv: number = sale - cash;
      const lastDate: string = lastDateMap[r.customerId as number] || '';
      const days: number = daysSince(lastDate);
      let bucket: string;
      if (days > 60) bucket = 'overdue';
      else if (days > 30) bucket = 'watch';
      else bucket = 'normal';
      return { customer_id: r.customerId as number, name: (r.customerName as string) || '—', days, amount: recv, bucket };
    })
    .filter(a => a.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // ---- 挂账空态引导 ----
  const showReceivableGuide: boolean = cashIn === 0 && cashOut === 0 && receivable > 0;

  // pending_receivable 与 kpi.receivable 等价（两者均表示累计应收款），
  // 仅当前端空态引导文案需要独立字段时保留此冗余。
  return {
    kpi: { cash_in: cashIn, cash_out: cashOut, net_cash: netCash, receivable },
    trend,
    aging,
    show_receivable_guide: showReceivableGuide,
    pending_receivable: receivable,
  };
}

router.get('/analysis/cash', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await cashAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 阿米巴核算 ========== */
async function amoebaAnalysis(ownerId: number, sd: string, ed: string) {
  const db = getDb();
  const typeRows = await getTypeAggregation(db, ownerId, sd, ed, null);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type] = numOf(r.raw); absAmt[r.type] = numOf(r.absAmt); });

  const salesIncome: number = raw[T.SALES] || 0;
  const cashIncome: number = raw[T.CASH_IN] || 0;
  const otherIncome: number = raw[T.OTHER_IN] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt[T.MATERIAL] || 0;
  const processCost: number = absAmt[T.PROCESS] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt[T.MISC] || 0;
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
    const pAdded: number = (pRaw[T.SALES] || 0) + (pRaw[T.CASH_IN] || 0) + (pRaw[T.OTHER_IN] || 0) - ((pAbs[T.MATERIAL] || 0) + (pAbs[T.PROCESS] || 0)) - (pAbs[T.MISC] || 0);

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

/* ========== 看板 v2 新增端点 ========== */

router.get('/analysis/daily-trend', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    const db = getDb();
    const [trend, incomeCompose, expenseCompose] = await Promise.all([
      getDailyTrend(db, req.user!.id, sd, ed),
      getIncomeCompose(db, req.user!.id, sd, ed),
      getExpenseComposeByType(db, req.user!.id, sd, ed),
    ]);
    ok(res, { trend, incomeCompose, expenseCompose });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
