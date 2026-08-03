/**
 * routes/inventory.ts — 库存管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import { findProductById } from '../drizzle/queries/products.queries.js';
import {
  listInventory, findInventoryByProduct, findInventoryById,
  createInventory, updateInventory, deleteInventory,
} from '../drizzle/queries/inventory.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/inventory', async (req: Request, res: Response) => {
  try {
    ok(res, await listInventory(getDb(), req.user!.id));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/inventory', async (req: Request, res: Response) => {
  try {
    const { product_id, quantity, avg_price } = (req.body || {}) as Record<string, unknown>;
    if (!product_id) { fail400(res, '请选择商品'); return; }
    if (quantity == null) { fail400(res, '缺少库存数量'); return; }
    const prod = await findProductById(getDb(), product_id as number, req.user!.id);
    if (!prod) { fail404(res, '商品不存在'); return; }
    const exist = await findInventoryByProduct(getDb(), product_id as number, req.user!.id);
    if (exist) {
      await updateInventory(getDb(), exist.id, req.user!.id, {
        quantity: quantity as number,
        avgPrice: (avg_price as number) ?? 0,
      });
      ok(res, { id: exist.id, updated: true });
    } else {
      const r = await createInventory(getDb(), {
        productId: product_id as number,
        quantity: quantity as number,
        avgPrice: (avg_price as number) ?? 0,
        ownerId: req.user!.id,
      });
      ok(res, { id: r[0].id });
    }
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const { quantity, avg_price } = (req.body || {}) as Record<string, unknown>;
    if (quantity == null) { fail400(res, '缺少库存数量'); return; }
    const old = await findInventoryById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '库存记录不存在'); return; }
    await updateInventory(getDb(), Number(req.params.id), req.user!.id, {
      quantity: quantity as number,
      avgPrice: avg_price !== undefined ? (avg_price as number) : undefined,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findInventoryById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '库存记录不存在'); return; }
    await deleteInventory(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
