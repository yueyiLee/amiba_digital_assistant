/**
 * routes/inventory.ts — 库存管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/inventory', async (req: Request, res: Response) => {
  try {
    ok(res, await db.queryAll(
      `SELECT i.*, p.name AS product_name, p.category1, p.category2, p.purchase_price, p.sale_price
       FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.owner_id=$1 ORDER BY i.id`,
      [req.user!.id]
    ));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/inventory', async (req: Request, res: Response) => {
  try {
    const { product_id, quantity, avg_price } = (req.body || {}) as Record<string, unknown>;
    if (!product_id) { fail400(res, '请选择商品'); return; }
    if (quantity == null) { fail400(res, '缺少库存数量'); return; }
    const prod = await db.queryOne('SELECT id FROM products WHERE id=$1 AND owner_id=$2', [product_id as number, req.user!.id]);
    if (!prod) { fail404(res, '商品不存在'); return; }
    const exist = await db.queryOne('SELECT id FROM inventory WHERE product_id=$1 AND owner_id=$2', [product_id as number, req.user!.id]);
    if (exist) {
      await db.query('UPDATE inventory SET quantity=$1, avg_price=$2, updated_at=NOW() WHERE id=$3 AND owner_id=$4',
        [quantity, (avg_price as number) ?? 0, exist.id, req.user!.id]);
      ok(res, { id: exist.id, updated: true });
    } else {
      const r = await db.insertReturning(
        'INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4) RETURNING id',
        [product_id, quantity, (avg_price as number) ?? 0, req.user!.id]
      );
      ok(res, { id: r.rows[0].id });
    }
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const { quantity, avg_price } = (req.body || {}) as Record<string, unknown>;
    if (quantity == null) { fail400(res, '缺少库存数量'); return; }
    const old = await db.queryOne('SELECT * FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '库存记录不存在'); return; }
    await db.query('UPDATE inventory SET quantity=$1, avg_price=$2, updated_at=NOW() WHERE id=$3 AND owner_id=$4',
      [quantity, (avg_price as number) ?? old.avg_price, req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '库存记录不存在'); return; }
    await db.query('DELETE FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
