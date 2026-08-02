/**
 * routes/lib/helpers.ts — 公共响应辅助函数与分析工具函数
 */
import type { Request, Response } from 'express';
import * as db from '../../db';

export const ok = (res: Response, data: unknown): void => { res.json(data); };
export const fail400 = (res: Response, msg: string): void => { res.status(400).json({ error: msg }); };
export const fail404 = (res: Response, msg: string): void => { res.status(404).json({ error: msg }); };

// 业务异常兜底：向客户端返回通用错误，避免泄露内部 SQL 细节；详细堆栈通过 logger 记录
export const failErr = (res: Response, e: unknown): void => {
  const err = e instanceof Error ? e : new Error(String(e));
  // 通过 res.req 获取请求级 logger（Express 内部引用），若无则回退到 console
  const req = (res as { req?: Request }).req;
  if (req?.log) {
    req.log.error({ err }, 'API 请求失败');
  } else {
    console.error('[API] 请求失败:', err.stack || err.message);
  }
  res.status(400).json({ error: '操作失败，请稍后重试' });
};

export const numOf = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n: number = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const parts: number[] = String(dateStr).split('-').map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return 0;
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayLocal.getTime() - localDate.getTime()) / 86400000);
}

export function buildTxFilter(ownerId: number, sd: string, ed: string, unit?: string | null): { where: string; params: unknown[] } {
  const useUnit: boolean = !!(unit && unit !== '全部单元');
  return {
    where: `t.owner_id=$1 AND t.date BETWEEN $2 AND $3${useUnit ? ' AND t.unit=$4' : ''}`,
    params: useUnit ? [ownerId, sd, ed, unit] : [ownerId, sd, ed],
  };
}

export function fmtCny(v: number): string {
  return `¥${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
}

export async function productAnalysis(ownerId: number, direction: string, sd: string, ed: string) {
  const isSale: boolean = direction === 'sale';
  const totalAmtRow = isSale
    ? await db.queryOne(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE owner_id=$1 AND type='销售收入' AND amount>0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed])
    : await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalAmount: number = Number(totalAmtRow && totalAmtRow.s) || 0;

  const byAmtRows = isSale
    ? await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(t.amount) AS amt FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.owner_id=$1 AND t.type='销售收入' AND t.amount>0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed])
    : await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(ABS(t.amount)) AS amt FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.owner_id=$1 AND t.type='材料采购' AND t.amount<0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed]);

  const qtyRows = await db.queryAll(`SELECT ci.product_id, p.name AS product_name, SUM(ci.quantity) AS qty, SUM(ci.quantity * ci.actual_price) AS amt FROM contract_items ci JOIN contracts co ON ci.contract_id = co.id LEFT JOIN products p ON ci.product_id = p.id WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4 GROUP BY ci.product_id, p.name ORDER BY amt DESC`, [ownerId, direction, sd, ed]);

  const series = await db.queryAll(`SELECT ci.product_id, p.name AS product_name, co.date, ci.actual_price FROM contract_items ci JOIN contracts co ON ci.contract_id = co.id LEFT JOIN products p ON ci.product_id = p.id WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4 ORDER BY ci.product_id, co.date`, [ownerId, direction, sd, ed]);
  const byPid: Record<number, { date: string; price: number; name: string }[]> = {};
  series.forEach((s) => {
    if (s.product_id == null) return;
    (byPid[s.product_id as number] = byPid[s.product_id as number] || []).push({ date: s.date as string, price: Number(s.actual_price) || 0, name: s.product_name as string });
  });
  const priceChange = Object.values(byPid).map((arr) => {
    const prices: number[] = arr.map((x) => x.price).filter((v) => v > 0);
    if (prices.length < 2) return null;
    const min: number = Math.min(...prices), max: number = Math.max(...prices);
    const change: number = min > 0 ? (max - min) / min : 0;
    return { product_name: arr[0].name, change, min, max, samples: arr.length };
  }).filter(Boolean).sort((a, b) => (b as { change: number }).change - (a as { change: number }).change).slice(0, 5);

  const costRow = await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS c FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalCost: number = Number(costRow && costRow.c) || 0;
  const totalQty: number = qtyRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const avgGm: number = isSale && totalAmount > 0 ? Math.max(0, (totalAmount - totalCost) / totalAmount) : 0;

  let costByPid: Record<number, number> = {};
  if (isSale) {
    const costByPidRows = await db.queryAll(`SELECT product_id, SUM(ABS(amount)) AS cost FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND product_id IS NOT NULL AND date BETWEEN $2 AND $3 GROUP BY product_id`, [ownerId, sd, ed]);
    costByPidRows.forEach((r) => { costByPid[r.product_id as number] = Number(r.cost) || 0; });
  }

  const byQty = qtyRows.slice().sort((a, b) => Number(b.qty) - Number(a.qty)).slice(0, 5)
    .map((r) => ({ product_id: r.product_id, product_name: r.product_name, total_qty: Number(r.qty) || 0, total_amount: Number(r.amt) || 0 }));
  const byAmount = byAmtRows.slice(0, 5).map((r) => {
    const sale: number = Number(r.amt) || 0;
    const cost: number = isSale ? (costByPid[r.product_id as number] || 0) : 0;
    const gm: number = isSale && sale > 0 ? Math.max(0, (sale - cost) / sale) : 0;
    return { product_id: r.product_id, product_name: r.product_name, total_amount: sale, cost, gm };
  });
  return { total_sale: totalAmount, total_cost: isSale ? totalCost : totalAmount, total_qty: totalQty, avg_gm: avgGm, by_qty: byQty, by_amount: byAmount, price_change: priceChange };
}
