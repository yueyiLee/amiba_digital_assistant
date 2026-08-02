/**
 * routes/products.ts — 商品管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/products', async (req: Request, res: Response) => {
  try {
    const sql = `SELECT p.*, COALESCE(i.quantity, 0) AS stock
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id AND i.owner_id = p.owner_id
      WHERE p.owner_id=$1 ORDER BY p.id DESC`;
    ok(res, await db.queryAll(sql, [req.user!.id]));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/products', async (req: Request, res: Response) => {
  try {
    const { name, brand, unit, category1, category2, purchase_price, sale_price, notes, warning_threshold, initial_stock } = (req.body || {}) as Record<string, unknown>;
    if (!name || !category1) { fail400(res, '缺少必要字段（名称/一级分类）'); return; }
    const result = await db.insertReturning(
      'INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price,notes,warning_threshold,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [name, (brand as string) || '', (unit as string) || '件', category1, (category2 as string) || '', (purchase_price as number) || 0, (sale_price as number) || 0, (notes as string) || '', (warning_threshold as number) || 0, req.user!.id]
    );
    const newId: number = result.rows[0].id as number;
    await db.query('INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4)', [newId, (initial_stock as number) || 0, (purchase_price as number) || 0, req.user!.id]);
    ok(res, { id: newId });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/products/:id', async (req: Request, res: Response) => {
  try {
    const p = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '商品不存在'); return; }
    await db.query(
      'UPDATE products SET name=$1,brand=$2,unit=$3,category1=$4,category2=$5,purchase_price=$6,sale_price=$7,notes=$8,warning_threshold=$9 WHERE id=$10 AND owner_id=$11',
      [(p.name as string) ?? old.name, (p.brand as string) ?? old.brand, (p.unit as string) ?? old.unit, (p.category1 as string) ?? old.category1,
      (p.category2 as string) ?? old.category2, (p.purchase_price as number) ?? old.purchase_price, (p.sale_price as number) ?? old.sale_price,
      (p.notes as string) ?? old.notes, (p.warning_threshold as number) ?? old.warning_threshold, req.params.id, req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/products/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '商品不存在'); return; }
    await db.query('DELETE FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
