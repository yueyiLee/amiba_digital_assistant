/**
 * routes/settings-categories.ts — 设置与商品分类（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../drizzle/db.js';
import { settings } from '../drizzle/schema/settings.js';
import { categories } from '../drizzle/schema/categories.js';
import { ok, fail400, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== settings 设置 ========== */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const rows = await getDb().select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.ownerId, req.user!.id));
    const obj: Record<string, unknown> = {};
    rows.forEach((r) => { obj[r.key] = r.value; });
    ok(res, obj);
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getDb();
    for (const [k, v] of Object.entries(body)) {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      await db.insert(settings)
        .values({ ownerId: req.user!.id, key: k, value: val })
        .onConflictDoUpdate({
          target: [settings.ownerId, settings.key],
          set: { value: val },
        });
    }
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== categories 分类 ========== */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    ok(res, await getDb().select().from(categories)
      .where(eq(categories.ownerId, req.user!.id))
      .orderBy(categories.id));
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
