/**
 * routes/products.ts — 商品管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import {
  listProducts, findProductById, createProduct, updateProduct, deleteProduct,
} from '../drizzle/queries/products.queries.js';
import { createInventory } from '../drizzle/queries/inventory.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/products', async (req: Request, res: Response) => {
  try {
    ok(res, await listProducts(getDb(), req.user!.id));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/products', async (req: Request, res: Response) => {
  try {
    const { name, brand, unit, category1, category2, purchase_price, sale_price, notes, warning_threshold, initial_stock } = (req.body || {}) as Record<string, unknown>;
    if (!name || !category1) { fail400(res, '缺少必要字段（名称/一级分类）'); return; }
    const result = await createProduct(getDb(), {
      name: name as string,
      brand: (brand as string) || '',
      unit: (unit as string) || '件',
      category1: category1 as string,
      category2: (category2 as string) || '',
      purchasePrice: (purchase_price as number) || 0,
      salePrice: (sale_price as number) || 0,
      notes: (notes as string) || '',
      warningThreshold: (warning_threshold as number) || 0,
      ownerId: req.user!.id,
    });
    const newId: number = result[0].id;
    await createInventory(getDb(), {
      productId: newId,
      quantity: (initial_stock as number) || 0,
      avgPrice: (purchase_price as number) || 0,
      ownerId: req.user!.id,
    });
    ok(res, { id: newId });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/products/:id', async (req: Request, res: Response) => {
  try {
    const p = (req.body || {}) as Record<string, unknown>;
    const old = await findProductById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '商品不存在'); return; }
    await updateProduct(getDb(), Number(req.params.id), req.user!.id, {
      name: p.name !== undefined ? p.name as string : undefined,
      brand: p.brand !== undefined ? (p.brand as string) : undefined,
      unit: p.unit !== undefined ? (p.unit as string) : undefined,
      category1: p.category1 !== undefined ? p.category1 as string : undefined,
      category2: p.category2 !== undefined ? (p.category2 as string) : undefined,
      purchasePrice: p.purchase_price !== undefined ? (p.purchase_price as number) : undefined,
      salePrice: p.sale_price !== undefined ? (p.sale_price as number) : undefined,
      notes: p.notes !== undefined ? (p.notes as string) : undefined,
      warningThreshold: p.warning_threshold !== undefined ? (p.warning_threshold as number) : undefined,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/products/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findProductById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '商品不存在'); return; }
    await deleteProduct(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
