/**
 * routes/analysis.ts — 分析路由（驾驶舱、客户分析、商品分析、合同分析、费用分析、阿米巴核算）
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, failErr, numOf, daysSince, buildTxFilter, fmtCny, productAnalysis } from './lib/helpers';

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
  const { where: txWhere, params: txParams } = buildTxFilter(ownerId, sd, ed, unit);

  const typeRows = await db.queryAll(
    `SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${txWhere} GROUP BY t.type`,
    txParams
  );
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type as string] = numOf(r.raw); absAmt[r.type as string] = numOf(r.abs_amt); });

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
  const salaryRow = await db.queryOne(
    `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
    [ownerId, smk, emk]
  );
  const totalSalary: number = numOf(salaryRow && salaryRow.salary);
  const totalHours: number = numOf(salaryRow && salaryRow.hours);
  const profit: number = addedValue - totalSalary - taxCost;
  const netCashFlow: number = cashIncome - cashExpense;

  const invRow = await db.queryOne(`SELECT COALESCE(SUM(quantity * avg_price), 0) AS v FROM inventory WHERE owner_id=$1`, [ownerId]);
  const inventoryValue: number = numOf(invRow && invRow.v);

  const custRows = await db.queryAll(
    `SELECT t.customer_id, c.name AS customer_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount WHEN t.type='现金收入' THEN -t.amount ELSE 0 END), 0) AS recv FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE ${txWhere} AND t.customer_id IS NOT NULL GROUP BY t.customer_id, c.name`,
    txParams
  );

  const prodRows = await db.queryAll(
    `SELECT t.product_id, p.name AS product_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN products p ON p.id = t.product_id WHERE ${txWhere} AND t.product_id IS NOT NULL GROUP BY t.product_id, p.name`,
    txParams
  );
  const productMetrics = prodRows.map((r) => {
    const sale: number = numOf(r.sale), cost: number = numOf(r.cost);
    return { id: r.product_id, name: r.product_name, sale, cost, gm: sale > 0 ? (sale - cost) / sale : 0 };
  });

  const staleRows = await db.queryAll(
    `SELECT i.product_id, p.name AS product_name, i.quantity, EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 86400 AS days FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.owner_id=$1 AND i.quantity > 0 AND i.updated_at IS NOT NULL`,
    [ownerId]
  );

  const alerts: AlertItem[] = [];
  custRows.forEach((r) => {
    const recv: number = numOf(r.recv);
    if (recv >= COCKPIT_ALERT_RULES.customerRecvRed) {
      alerts.push({ level: 'red', title: `客户【${r.customer_name}】应收 ${fmtCny(recv)}`, sub: '超过预警阈值，建议立即跟进回款', value: fmtCny(recv), jumpTo: 'customer' });
    } else if (recv >= COCKPIT_ALERT_RULES.customerRecvYellow) {
      alerts.push({ level: 'yellow', title: `客户【${r.customer_name}】应收 ${fmtCny(recv)}`, sub: '需保持关注', value: fmtCny(recv), jumpTo: 'customer' });
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
      alerts.push({ level: 'yellow', title: `商品【${(r.product_name as string) || '未知商品'}】库存呆滞 ${days} 天`, sub: '建议盘点/促销/调拨', value: `${days} 天`, jumpTo: 'product' });
    }
  });
  if (netCashFlow < COCKPIT_ALERT_RULES.cashGap) {
    alerts.push({ level: 'red', title: `净现金流 ${fmtCny(netCashFlow)}`, sub: '现金缺口较大，关注回款', value: fmtCny(netCashFlow), jumpTo: 'overview' });
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC LIMIT 1`,
    txParams
  );
  const topCustomer = custRows.length > 0 ? custRows.slice().sort((a, b) => numOf(b.sale) - numOf(a.sale))[0] : undefined;
  const topProduct = productMetrics.length > 0 ? productMetrics.slice().sort((a, b) => b.sale - a.sale)[0] : undefined;
  const topUnit = unitRows.length > 0 ? unitRows[0] : undefined;

  const tops = [
    { label: 'Top 客户贡献', name: topCustomer ? (topCustomer.customer_name as string) : '', value: topCustomer ? fmtCny(numOf(topCustomer.sale)) : '', jumpTo: 'customer' },
    { label: 'Top 商品销售', name: topProduct ? (topProduct.name as string) : '', value: topProduct ? fmtCny(topProduct.sale) : '', jumpTo: 'product' },
    { label: '单元附加价值排行', name: topUnit ? (topUnit.unit as string) : '', value: topUnit ? fmtCny(numOf(topUnit.added_value)) : '', jumpTo: 'amoeba' },
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
  const totalRow = await db.queryOne('SELECT COUNT(*) AS total FROM customers WHERE owner_id=$1', [ownerId]);
  const totalCount: number = Number(totalRow?.total) || 0;

  const activeRow = await db.queryOne(`SELECT COUNT(DISTINCT t.customer_id) AS active FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const activeCount: number = Number(activeRow?.active) || 0;

  const recvRow = await db.queryOne(`SELECT COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS cash FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalSale: number = numOf(recvRow?.sale);
  const totalCash: number = numOf(recvRow?.cash);
  const totalReceivable: number = totalSale - totalCash;

  const custAggRows = await db.queryAll(
    `SELECT t.customer_id, c.name AS customer_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS cash, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.customer_id, c.name ORDER BY sale DESC`,
    [ownerId, sd, ed]
  );

  const lastDateMap: Record<number, string> = {};
  if (custAggRows.length > 0) {
    const cids: number[] = custAggRows.map((r) => r.customer_id as number);
    const lastRows = await db.queryAll(`SELECT customer_id, MAX(date) AS last_date FROM transactions WHERE owner_id=$1 AND customer_id = ANY($2::int[]) GROUP BY customer_id`, [ownerId, cids]);
    lastRows.forEach((r) => { lastDateMap[r.customer_id as number] = r.last_date as string; });
  }

  const top5 = custAggRows.slice(0, 5).map((r) => {
    const sale: number = numOf(r.sale);
    const cash: number = numOf(r.cash);
    const cost: number = numOf(r.cost);
    const recv: number = sale - cash;
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const lastDate: string = lastDateMap[r.customer_id as number] || '';
    const ageDays: number = daysSince(lastDate);
    return { customer_id: r.customer_id, customer_name: r.customer_name, sale, cash, receivable: recv, gm, last_date: lastDate, age_days: ageDays };
  });

  const allCustAging = await db.queryAll(
    `SELECT t.customer_id, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS recv, MAX(t.date) AS last_date FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.customer_id HAVING COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) > 0`,
    [ownerId, sd, ed]
  );
  const allAging = { within30: 0, within60: 0, over60: 0 };
  allCustAging.forEach((r) => {
    const recv: number = numOf(r.recv);
    const lastDate: string = (r.last_date as string) || '';
    const ageDays: number = daysSince(lastDate);
    if (ageDays <= 30) allAging.within30 += recv;
    else if (ageDays <= 60) allAging.within60 += recv;
    else allAging.over60 += recv;
  });
  const allAgingTotal: number = allAging.within30 + allAging.within60 + allAging.over60;

  const allCust = custAggRows.map((r) => ({ name: r.customer_name as string, sale: numOf(r.sale) }));
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
  const salesData = await productAnalysis(ownerId, 'sale', sd, ed);

  const skuRow = await db.queryOne('SELECT COUNT(*) AS cnt FROM products WHERE owner_id=$1', [ownerId]);
  const skuCount: number = Number(skuRow?.cnt) || 0;

  const invRow = await db.queryOne('SELECT COALESCE(SUM(quantity * avg_price), 0) AS v FROM inventory WHERE owner_id=$1', [ownerId]);
  const inventoryValue: number = numOf(invRow?.v);

  const topRows = await db.queryAll(
    `SELECT t.product_id, p.name AS product_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN products p ON p.id = t.product_id WHERE t.owner_id=$1 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY sale DESC LIMIT 10`,
    [ownerId, sd, ed]
  );

  const pids: number[] = topRows.map((r) => r.product_id as number);
  const stockMap: Record<number, number> = {};
  if (pids.length > 0) {
    const stockRows = await db.queryAll(`SELECT product_id, COALESCE(quantity, 0) AS qty FROM inventory WHERE owner_id=$1 AND product_id = ANY($2::int[])`, [ownerId, pids]);
    stockRows.forEach((r) => { stockMap[r.product_id as number] = Number(r.qty) || 0; });
  }

  const costAvgMap: Record<number, number> = {};
  if (pids.length > 0) {
    const avgRows = await db.queryAll(`SELECT product_id, AVG(ABS(amount)) AS avg_cost FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND product_id = ANY($2::int[]) GROUP BY product_id`, [ownerId, pids]);
    avgRows.forEach((r) => { costAvgMap[r.product_id as number] = Number(r.avg_cost) || 0; });
  }

  const topProducts = topRows.map((r) => {
    const sale: number = numOf(r.sale);
    const cost: number = numOf(r.cost);
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const stock: number = stockMap[r.product_id as number] || 0;
    const daysDiff: number = Math.max(1, Math.ceil((new Date(ed).getTime() - new Date(sd).getTime()) / 86400000));
    const dailySale: number = sale / daysDiff;
    const turnoverDays: number = dailySale > 0 ? Math.round(stock / dailySale) : 0;
    return { product_id: r.product_id, product_name: r.product_name, sale, gm, stock, turnover_days: turnoverDays };
  });

  const ALL_PRODUCTS = await db.queryAll(
    `SELECT p.id, p.name, p.warning_threshold, COALESCE(i.quantity, 0) AS stock FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.owner_id = p.owner_id WHERE p.owner_id=$1`,
    [ownerId]
  );

  const gmMap: Record<number, number> = {};
  topProducts.forEach((p) => { gmMap[p.product_id as number] = p.gm; });

  if (ALL_PRODUCTS.length > 0) {
    const allPids: number[] = ALL_PRODUCTS.map((p) => p.id as number);
    const gmRows = await db.queryAll(
      `SELECT t.product_id, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t WHERE t.owner_id=$1 AND t.product_id = ANY($2::int[]) AND t.date BETWEEN $3 AND $4 GROUP BY t.product_id`,
      [ownerId, allPids, sd, ed]
    );
    gmRows.forEach((r) => {
      if (!gmMap[r.product_id as number]) {
        const s: number = numOf(r.sale), c: number = numOf(r.cost);
        gmMap[r.product_id as number] = s > 0 ? (s - c) / s : 0;
      }
    });
  }

  const MARGIN_THRESHOLD = 0.15;
  const alerts: Record<string, unknown>[] = [];

  ALL_PRODUCTS.forEach((p) => {
    const gm = gmMap[p.id as number];
    if (gm !== undefined && gm < MARGIN_THRESHOLD) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `毛利率 ${(gm * 100).toFixed(1)}% 跌破 ${(MARGIN_THRESHOLD * 100).toFixed(0)}%`, type: 'low_margin' });
    }
    if ((p.warning_threshold as number) > 0 && (p.stock as number) <= (p.warning_threshold as number)) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `库存 ${p.stock} ≤ 安全线 ${p.warning_threshold}，建议补货`, type: 'low_stock' });
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
  const overviewRow = await db.queryOne(`SELECT COUNT(*) AS total_count, COALESCE(SUM(co.amount), 0) AS total_amount FROM contracts co WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalAmount: number = numOf(overviewRow?.total_amount);

  const statusRows = await db.queryAll(`SELECT co.status, COUNT(*) AS cnt, COALESCE(SUM(co.amount), 0) AS amt FROM contracts co WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3 GROUP BY co.status`, [ownerId, sd, ed]);
  const statusMap: Record<string, { count: number; amount: number }> = {};
  statusRows.forEach((r) => { statusMap[r.status as string] = { count: Number(r.cnt), amount: numOf(r.amt) }; });
  const inProgress = statusMap['进行中'] || { count: 0, amount: 0 };
  const completed = statusMap['已完结'] || { count: 0, amount: 0 };
  const dunning = statusMap['催收中'] || { count: 0, amount: 0 };

  const paidRow = await db.queryOne(`SELECT COALESCE(SUM(t.amount), 0) AS paid FROM transactions t WHERE t.owner_id=$1 AND t.contract_id IS NOT NULL AND t.amount > 0 AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalPaid: number = numOf(paidRow?.paid);
  const executionRate: number = totalAmount > 0 ? totalPaid / totalAmount : 0;
  const unpaidAmount: number = Math.max(0, totalAmount - totalPaid);

  const contractRows = await db.queryAll(`SELECT co.id, co.date, co.status, co.amount, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id = c.id WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3 ORDER BY co.id DESC`, [ownerId, sd, ed]);
  const cids: number[] = contractRows.map((r) => r.id as number);

  const paidMap: Record<number, number> = {};
  if (cids.length > 0) {
    const paidRows = await db.queryAll(`SELECT contract_id, COALESCE(SUM(amount), 0) AS paid FROM transactions WHERE owner_id=$1 AND contract_id = ANY($2::int[]) AND amount > 0 AND date BETWEEN $3 AND $4 GROUP BY contract_id`, [ownerId, cids, sd, ed]);
    paidRows.forEach((r) => { paidMap[r.contract_id as number] = numOf(r.paid); });
  }

  const lastPaidMap: Record<number, string> = {};
  if (cids.length > 0) {
    const lastRows = await db.queryAll(`SELECT contract_id, MAX(date) AS last_date FROM transactions WHERE owner_id=$1 AND contract_id = ANY($2::int[]) AND amount > 0 GROUP BY contract_id`, [ownerId, cids]);
    lastRows.forEach((r) => { lastPaidMap[r.contract_id as number] = r.last_date as string; });
  }

  const contractList = contractRows.map((r) => {
    const paid: number = paidMap[r.id as number] || 0;
    const unpaid: number = Math.max(0, numOf(r.amount) - paid);
    const lastDate: string = lastPaidMap[r.id as number] || (r.date as string) || '';
    const ageDays: number = daysSince(lastDate);
    return { id: r.id, customer_name: (r.customer_name as string) || '—', date: (r.date as string) || '', amount: numOf(r.amount), paid, unpaid, status: (r.status as string) || '进行中', age_days: ageDays };
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
  const composeRows = await db.queryAll(
    `SELECT t.type AS name, COALESCE(SUM(ABS(t.amount)), 0) AS amount FROM transactions t WHERE t.owner_id=$1 AND t.amount < 0 AND t.date BETWEEN $2 AND $3 GROUP BY t.type ORDER BY amount DESC`,
    [ownerId, sd, ed]
  );
  const compose = composeRows.map((r) => ({ name: r.name as string, amount: numOf(r.amount) }));
  const totalExpense: number = compose.reduce((s, r) => s + r.amount, 0);

  const trendData: { month: string; amount: number }[] = [];
  const endParts: number[] = String(ed).split('-').map(Number);
  const endYear: number = endParts[0], endMonth: number = endParts[1];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(endYear, endMonth - 1 - i, 1);
    const ms: string = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const mEndStr: string = `${mEnd.getFullYear()}-${String(mEnd.getMonth() + 1).padStart(2, '0')}-${String(mEnd.getDate()).padStart(2, '0')}`;
    const monthRow = await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS amt FROM transactions WHERE owner_id=$1 AND amount < 0 AND date BETWEEN $2 AND $3`, [ownerId, ms + '-01', mEndStr]);
    trendData.push({ month: ms, amount: numOf(monthRow?.amt) });
  }

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(ABS(t.amount)), 0) AS amount FROM transactions t WHERE t.owner_id=$1 AND t.amount < 0 AND t.date BETWEEN $2 AND $3 GROUP BY COALESCE(t.unit, '全公司') ORDER BY amount DESC`,
    [ownerId, sd, ed]
  );
  const units = unitRows.map((r) => ({ unit: r.unit as string, amount: numOf(r.amount) }));
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
  const { where: txWhere, params: txParams } = buildTxFilter(ownerId, sd, ed, null);

  const typeRows = await db.queryAll(`SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${txWhere} GROUP BY t.type`, txParams);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type as string] = numOf(r.raw); absAmt[r.type as string] = numOf(r.abs_amt); });

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
  const salaryRow = await db.queryOne(
    `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
    [ownerId, smk, emk]
  );
  const totalSalary: number = numOf(salaryRow?.salary);
  const totalHours: number = numOf(salaryRow?.hours);

  const hourlyAddedValue: number = totalHours > 0 ? addedValue / totalHours : 0;
  const hourlyLaborCost: number = totalHours > 0 ? totalSalary / totalHours : 0;
  const breakeven: number = addedValue - totalSalary;

  const prevSd = new Date(Number(String(sd).slice(0, 4)), Number(String(sd).slice(5, 7)) - 2, 1);
  const prevEd = new Date(Number(String(ed).slice(0, 4)), Number(String(ed).slice(5, 7)) - 1, 0);
  const prevSdStr: string = `${prevSd.getFullYear()}-${String(prevSd.getMonth() + 1).padStart(2, '0')}-${String(prevSd.getDate()).padStart(2, '0')}`;
  const prevEdStr: string = `${prevEd.getFullYear()}-${String(prevEd.getMonth() + 1).padStart(2, '0')}-${String(prevEd.getDate()).padStart(2, '0')}`;

  let prevHourlyAddedValue: number | null = null;
  try {
    const prevFilter = buildTxFilter(ownerId, prevSdStr, prevEdStr, null);
    const prevTypeRows = await db.queryAll(`SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${prevFilter.where} GROUP BY t.type`, prevFilter.params);
    const pRaw: Record<string, number> = {};
    const pAbs: Record<string, number> = {};
    prevTypeRows.forEach((r) => { pRaw[r.type as string] = numOf(r.raw); pAbs[r.type as string] = numOf(r.abs_amt); });
    const pAdded: number = (pRaw['销售收入'] || 0) + (pRaw['现金收入'] || 0) + (pRaw['其他收入'] || 0) - ((pAbs['材料采购'] || 0) + (pAbs['委托加工'] || 0)) - (pAbs['杂费支出'] || 0);

    const pSmk: string = String(prevSdStr).slice(0, 7), pEmk: string = String(prevEdStr).slice(0, 7);
    const prevSalRow = await db.queryOne(
      `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
      [ownerId, pSmk, pEmk]
    );
    const prevHours: number = numOf(prevSalRow?.hours);
    if (prevHours > 0) prevHourlyAddedValue = pAdded / prevHours;
  } catch (_e: unknown) { /* 上月数据缺失不影响当期 */ }

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC`,
    txParams
  );
  const unitValues = unitRows.map((r) => ({ unit: r.unit as string, added_value: numOf(r.added_value) }));

  const unitContribRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount ELSE 0 END), 0) AS sales, COALESCE(SUM(CASE WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN ABS(t.amount) ELSE 0 END), 0) AS expense, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC`,
    txParams
  );
  const unitContribs = unitContribRows.map((r) => ({ unit: r.unit as string, sales: numOf(r.sales), expense: numOf(r.expense), added_value: numOf(r.added_value), hours: null, hourly_value: null }));

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
