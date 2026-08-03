/**
 * routes/lib/helpers.ts — 公共响应辅助函数与分析工具函数
 */
import type { Request, Response } from 'express';

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

/**
 * 商品分析 - 已迁移至 Drizzle ORM
 * 内部使用 Drizzle 查询替代原来的原生 SQL，返回值结构保持不变。
 */
export async function productAnalysis(ownerId: number, direction: string, sd: string, ed: string) {
  const { getDb } = await import('../../drizzle/db.js');
  const { getTotalSaleAmount, getProductSaleAgg, getProductPurchaseAgg, getContractItemAgg, getPriceTrend } = await import('../../drizzle/queries/analysis.queries.js');
  const db = getDb();

  const isSale: boolean = direction === 'sale';
  const totalAmount: number = await getTotalSaleAmount(db, ownerId, sd, ed, isSale);

  const byAmtRows = isSale
    ? await getProductSaleAgg(db, ownerId, sd, ed)
    : await getProductPurchaseAgg(db, ownerId, sd, ed);

  const qtyRows = await getContractItemAgg(db, ownerId, direction, sd, ed);
  const series = await getPriceTrend(db, ownerId, direction, sd, ed);

  const byPid: Record<number, { date: string; price: number; name: string }[]> = {};
  series.forEach((s: { productId: number | null; date: string | null; actualPrice: number | null; productName: string | null }) => {
    if (s.productId == null) return;
    (byPid[s.productId] = byPid[s.productId] || []).push({ date: (s.date as string) || '', price: Number(s.actualPrice) || 0, name: (s.productName as string) || '' });
  });
  const priceChange = Object.values(byPid).map((arr) => {
    const prices: number[] = arr.map((x) => x.price).filter((v) => v > 0);
    if (prices.length < 2) return null;
    const min: number = Math.min(...prices), max: number = Math.max(...prices);
    const change: number = min > 0 ? (max - min) / min : 0;
    return { product_name: arr[0].name, change, min, max, samples: arr.length };
  }).filter(Boolean).sort((a, b) => (b as { change: number }).change - (a as { change: number }).change).slice(0, 5);

  const totalCost: number = isSale ? await getTotalSaleAmount(db, ownerId, sd, ed, false) : totalAmount;
  const totalQty: number = qtyRows.reduce((s: number, r: { qty: number }) => s + (Number(r.qty) || 0), 0);
  const avgGm: number = isSale && totalAmount > 0 ? Math.max(0, (totalAmount - totalCost) / totalAmount) : 0;

  let costByPid: Record<number, number> = {};
  if (isSale) {
    const costByPidRows = await getProductPurchaseAgg(db, ownerId, sd, ed);
    costByPidRows.forEach((r: { productId: number | null; amt: number }) => { if (r.productId != null) costByPid[r.productId] = Number(r.amt) || 0; });
  }

  const byQty = qtyRows.slice().sort((a: { qty: number }, b: { qty: number }) => Number(b.qty) - Number(a.qty)).slice(0, 5)
    .map((r: { productId: number | null; productName: string | null; qty: number; amt: number }) => ({ product_id: r.productId, product_name: r.productName, total_qty: Number(r.qty) || 0, total_amount: Number(r.amt) || 0 }));
  const byAmount = byAmtRows.slice(0, 5).map((r: { productId: number | null; productName: string | null; amt: number }) => {
    const sale: number = Number(r.amt) || 0;
    const cost: number = isSale ? (costByPid[r.productId as number] || 0) : 0;
    const gm: number = isSale && sale > 0 ? Math.max(0, (sale - cost) / sale) : 0;
    return { product_id: r.productId, product_name: r.productName, total_amount: sale, cost, gm };
  });
  return { total_sale: totalAmount, total_cost: isSale ? totalCost : totalAmount, total_qty: totalQty, avg_gm: avgGm, by_qty: byQty, by_amount: byAmount, price_change: priceChange };
}
