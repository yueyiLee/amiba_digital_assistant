/**
 * routes/settings-categories.ts — 设置与商品分类
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== settings 设置 ========== */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll('SELECT key, value FROM settings WHERE owner_id=$1', [req.user!.id]);
    const obj: Record<string, unknown> = {};
    rows.forEach((r) => { obj[r.key as string] = r.value; });
    ok(res, obj);
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) {
      await db.query(
        'INSERT INTO settings(owner_id, key, value) VALUES($1,$2,$3) ON CONFLICT(owner_id, key) DO UPDATE SET value=excluded.value',
        [req.user!.id, k, typeof v === 'object' ? JSON.stringify(v) : String(v)]
      );
    }
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== categories 分类 ========== */
router.get('/categories', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM categories WHERE owner_id=$1 ORDER BY id', [req.user!.id])); }
  catch (e: unknown) { failErr(res, e); }
});

export = router;
