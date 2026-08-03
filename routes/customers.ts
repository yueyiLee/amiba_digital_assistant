/**
 * routes/customers.ts — 客户管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import {
  listCustomers, getCustomerSummary, findCustomerById,
  createCustomer, updateCustomer, deleteCustomer,
} from '../drizzle/queries/customers.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/customers', async (req: Request, res: Response) => {
  try { ok(res, await listCustomers(getDb(), req.user!.id)); }
  catch (e: unknown) { failErr(res, e); }
});

router.get('/customers/summary', async (req: Request, res: Response) => {
  try {
    ok(res, await getCustomerSummary(getDb(), req.user!.id));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/customers', async (req: Request, res: Response) => {
  try {
    const { name, type, contact, address, notes } = (req.body || {}) as Record<string, unknown>;
    if (!name) { fail400(res, '客户名称必填'); return; }
    if (!type) { fail400(res, '客户类型必选'); return; }
    const result = await createCustomer(getDb(), {
      name: name as string,
      type: type as string,
      contact: (contact as string) || '',
      address: (address as string) || '',
      notes: (notes as string) || '',
      ownerId: req.user!.id,
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const c = (req.body || {}) as Record<string, unknown>;
    const old = await findCustomerById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '客户不存在'); return; }
    await updateCustomer(getDb(), Number(req.params.id), req.user!.id, {
      name: c.name !== undefined ? c.name as string : undefined,
      type: c.type !== undefined ? c.type as string : undefined,
      contact: c.contact !== undefined ? (c.contact as string) : undefined,
      address: c.address !== undefined ? (c.address as string) : undefined,
      notes: c.notes !== undefined ? (c.notes as string) : undefined,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findCustomerById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '客户不存在'); return; }
    await deleteCustomer(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
