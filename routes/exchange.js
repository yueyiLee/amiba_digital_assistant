/**
 * routes/exchange.js — 汇率接口
 * 从 Frankfurter API（欧洲央行数据）获取实时汇率，免费无需 key。
 * 含离线降级：API 不可用时返回内置参考汇率。
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 内置参考汇率（离线降级用，以 CNY 为基准）
const FALLBACK_RATES = {
  CNY: 1,
  USD: 0.1475,
  EUR: 0.1288,
  date: '内置参考汇率'
};

let cachedRates = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 小时缓存

router.get('/rate', requireAuth, async (req, res) => {
  const base = (req.query.base || 'CNY').toUpperCase();
  const now = Date.now();

  // 使用缓存
  if (cachedRates && (now - cacheTime) < CACHE_TTL) {
    return res.json(cachedRates);
  }

  // 尝试从 Frankfurter API 获取
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=USD,EUR,CNY`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error('API 返回 ' + resp.status);
    const data = await resp.json();

    cachedRates = {
      base: data.base,
      rates: { ...data.rates, [data.base]: 1 },
      date: data.date,
      source: '欧洲央行 (Frankfurter API)',
      isRealtime: true
    };
    cacheTime = now;
    return res.json(cachedRates);
  } catch (err) {
    // 降级到内置汇率
    cachedRates = {
      base: 'CNY',
      rates: FALLBACK_RATES,
      date: FALLBACK_RATES.date,
      source: '内置参考汇率（离线）',
      isRealtime: false,
      error: err.message
    };
    cacheTime = now;
    return res.json(cachedRates);
  }
});

module.exports = router;
