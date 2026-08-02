/**
 * routes/exchange.ts — 汇率接口
 * 从 Frankfurter API（欧洲央行数据）获取实时汇率，免费无需 key。
 * 含离线降级：API 不可用时返回内置参考汇率。
 */
import express, { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

const router: Router = express.Router();

interface RateData {
  base: string;
  rates: Record<string, number>;
  date: string;
  source: string;
  isRealtime: boolean;
  error?: string;
}

// 内置参考汇率（离线降级用，以 CNY 为基准）
// 注意：原始 JS 中 FALLBACK_RATES 同时包含汇率值和 date 属性，
// 降级时 rates 字段直接赋值为该对象（含 date），前端可能依赖此结构。
const FALLBACK_RATES: Record<string, unknown> = {
  CNY: 1,
  USD: 0.1475,
  EUR: 0.1288,
  date: '内置参考汇率',
};
const FALLBACK_DATE = '内置参考汇率';

let cachedRates: RateData | null = null;
let cacheTime: number = 0;
const CACHE_TTL: number = 60 * 60 * 1000; // 1 小时缓存

router.get('/rate', requireAuth, async (req: Request, res: Response) => {
  const base: string = (req.query.base as string || 'CNY').toUpperCase();
  const now: number = Date.now();

  if (cachedRates && (now - cacheTime) < CACHE_TTL) {
    res.json(cachedRates);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=USD,EUR,CNY`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error('API 返回 ' + resp.status);
    const data = await resp.json() as { base: string; rates: Record<string, number>; date: string };

    cachedRates = {
      base: data.base,
      rates: { ...data.rates, [data.base]: 1 },
      date: data.date,
      source: '欧洲央行 (Frankfurter API)',
      isRealtime: true,
    };
    cacheTime = now;
    res.json(cachedRates);
  } catch (err: unknown) {
    // 保持与原始 JS 一致：降级时 rates 包含 date 键
    cachedRates = {
      base: 'CNY',
      rates: FALLBACK_RATES as unknown as Record<string, number>,
      date: FALLBACK_DATE,
      source: '内置参考汇率（离线）',
      isRealtime: false,
      error: (err as Error).message,
    };
    cacheTime = now;
    res.json(cachedRates);
  }
});

export = router;
