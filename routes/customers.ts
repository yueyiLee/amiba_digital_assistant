/**
 * routes/customers.ts — 客户管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/customers', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM customers WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { failErr(res, e); }
});

router.get('/customers/summary', async (req: Request, res: Response) => {
  try {
    const sql = `SELECT c.id,
      COALESCE((
        SELECT SUM(ct.amount - COALESCE((
          SELECT SUM(t.amount) FROM transactions t
          WHERE t.contract_id = ct.id AND t.amount > 0 AND t.owner_id = $1
        ), 0))
        FROM contracts ct
        WHERE ct.customer_id = c.id AND ct.direction = 'sale' AND ct.owner_id = $1
      ), 0) AS receivable,
      COALESCE((SELECT MAX(t2.date) FROM transactions t2 WHERE t2.customer_id = c.id AND t2.owner_id = $1), '') AS last_transaction_date
    FROM customers c WHERE c.owner_id = $1`;
    ok(res, await db.queryAll(sql, [req.user!.id]));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/customers', async (req: Request, res: Response) => {
  try {
    const { name, type, contact, address, notes } = (req.body || {}) as Record<string, unknown>;
    if (!name) { fail400(res, '客户名称必填'); return; }
    if (!type) { fail400(res, '客户类型必选'); return; }
    const result = await db.insertReturning(
      'INSERT INTO customers(name,type,contact,address,notes,owner_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, type, (contact as string) || '', (address as string) || '', (notes as string) || '', req.user!.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const c = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '客户不存在'); return; }
    await db.query('UPDATE customers SET name=$1,type=$2,contact=$3,address=$4,notes=$5 WHERE id=$6 AND owner_id=$7',
      [(c.name as string) ?? old.name, (c.type as string) ?? old.type, (c.contact as string) ?? old.contact, (c.address as string) ?? old.address, (c.notes as string) ?? old.notes, req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '客户不存在'); return; }
    await db.query('DELETE FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
