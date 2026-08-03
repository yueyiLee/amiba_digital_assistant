/**
 * routes/transactions.ts — 收支流水、支出项预设、收支类型（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import {
  listTransactions, findTransactionById, createTransaction,
  updateTransaction, deleteTransaction, getContractDisplayNames,
  listExpenseItems, findExpenseItemByKindName, findExpenseItemById,
  createExpenseItem, updateExpenseItem, deleteExpenseItem,
  listExpenseTypes, findExpenseTypeById, findExpenseTypeByNameDir,
  createExpenseType, updateExpenseType, deleteExpenseType,
} from '../drizzle/queries/transactions.queries.js';
import { findCustomerById } from '../drizzle/queries/customers.queries.js';
import { findProductById } from '../drizzle/queries/products.queries.js';
import { findContractById } from '../drizzle/queries/contracts.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== transactions 收支流水 ========== */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { unit, type, startDate, endDate } = req.query as Record<string, string | undefined>;
    const rows = await listTransactions(getDb(), req.user!.id, { unit, type, startDate, endDate });
    const cids = [...new Set(rows.map((r) => r.contractId).filter(Boolean))] as number[];
    let nameMap: Record<number, { display_name: string; direction: string }> = {};
    if (cids.length) {
      nameMap = await getContractDisplayNames(getDb(), cids);
    }
    const out = rows.map((r) => ({
      ...r,
      contract_display_name: r.contractId ? (nameMap[r.contractId] ? nameMap[r.contractId].display_name : null) : null,
      contract_direction: r.contractId ? (nameMap[r.contractId] ? nameMap[r.contractId].direction : null) : null,
    }));
    ok(res, out);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/transactions', async (req: Request, res: Response) => {
  try {
    const { amount, type, unit, date, customer_id, product_id, note, category, contract_id } = (req.body || {}) as Record<string, unknown>;
    if (amount == null || !type || !date) { fail400(res, '缺少必要字段（金额/类型/日期）'); return; }
    const db = getDb();
    if (customer_id) {
      const c = await findCustomerById(db, customer_id as number, req.user!.id);
      if (!c) { fail400(res, '客户不存在或无权访问'); return; }
    }
    if (product_id) {
      const p = await findProductById(db, product_id as number, req.user!.id);
      if (!p) { fail400(res, '商品不存在或无权访问'); return; }
    }
    if (contract_id) {
      const co = await findContractById(db, contract_id as number, req.user!.id);
      if (!co) { fail400(res, '合同不存在或无权访问'); return; }
    }
    const result = await createTransaction(db, {
      amount: amount as number, type: type as string, unit: (unit as string) || '全公司',
      customerId: (customer_id as number) || null, productId: (product_id as number) || null,
      contractId: (contract_id as number) || null, date: date as string,
      note: (note as string) || '', category: (category as string) || '', ownerId: req.user!.id,
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const t = (req.body || {}) as Record<string, unknown>;
    const db = getDb();
    const old = await findTransactionById(db, Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '记录不存在'); return; }
    if (t.customer_id) {
      const c = await findCustomerById(db, t.customer_id as number, req.user!.id);
      if (!c) { fail400(res, '客户不存在或无权访问'); return; }
    }
    if (t.product_id) {
      const p = await findProductById(db, t.product_id as number, req.user!.id);
      if (!p) { fail400(res, '商品不存在或无权访问'); return; }
    }
    if (t.contract_id) {
      const co = await findContractById(db, t.contract_id as number, req.user!.id);
      if (!co) { fail400(res, '合同不存在或无权访问'); return; }
    }
    const newContract: unknown = t.contract_id === undefined ? old.contractId : (t.contract_id || null);
    await updateTransaction(db, Number(req.params.id), req.user!.id, {
      amount: t.amount !== undefined ? (t.amount as number) : undefined,
      type: t.type !== undefined ? (t.type as string) : undefined,
      unit: t.unit !== undefined ? (t.unit as string) : undefined,
      customerId: t.customer_id === undefined ? undefined : ((t.customer_id as number) || null),
      productId: t.product_id === undefined ? undefined : ((t.product_id as number) || null),
      contractId: newContract as number | null | undefined,
      date: t.date !== undefined ? (t.date as string) : undefined,
      note: t.note !== undefined ? (t.note as string) : undefined,
      category: t.category !== undefined ? ((t.category as string) || '') : undefined,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findTransactionById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '记录不存在'); return; }
    await deleteTransaction(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== expense_items 支出项预设 ========== */
router.get('/expense-items', async (req: Request, res: Response) => {
  try { ok(res, await listExpenseItems(getDb(), req.user!.id)); }
  catch (e: unknown) { failErr(res, e); }
});

router.post('/expense-items', async (req: Request, res: Response) => {
  try {
    const { kind, name, note } = (req.body || {}) as Record<string, unknown>;
    if (!kind || !name || !String(name).trim()) { fail400(res, '缺少必要字段（类型/名称）'); return; }
    const nm: string = String(name).trim();
    const nt: string = note == null ? '' : String(note).trim();
    const dup = await findExpenseItemByKindName(getDb(), req.user!.id, kind as string, nm);
    if (dup) { fail400(res, '该类别已存在'); return; }
    const result = await createExpenseItem(getDb(), {
      ownerId: req.user!.id, kind: kind as string, name: nm, note: nt,
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/expense-items/:id', async (req: Request, res: Response) => {
  try {
    const { name, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '名称必填'); return; }
    const old = await findExpenseItemById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '类别不存在'); return; }
    const nm: string = String(name).trim();
    const nt: string = note == null ? '' : String(note).trim();
    const dup = await findExpenseItemByKindName(getDb(), req.user!.id, old.kind, nm);
    if (dup && dup.id !== Number(req.params.id)) { fail400(res, '该类别已存在'); return; }
    await updateExpenseItem(getDb(), Number(req.params.id), req.user!.id, { name: nm, note: nt });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/expense-items/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findExpenseItemById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '类别不存在'); return; }
    await deleteExpenseItem(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== expense_types 收支类型 ========== */
router.get('/expense-types', async (req: Request, res: Response) => {
  try {
    const { direction, enabled } = req.query as Record<string, string | undefined>;
    ok(res, await listExpenseTypes(getDb(), req.user!.id, {
      direction, enabled: enabled === 'true',
    }));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/expense-types', async (req: Request, res: Response) => {
  try {
    const { name, direction, link_customer, link_product, link_cat } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '类型名称必填'); return; }
    if (direction !== 'income' && direction !== 'expense') { fail400(res, '方向必须是 income 或 expense'); return; }
    const nm: string = String(name).trim();
    const dup = await findExpenseTypeByNameDir(getDb(), req.user!.id, nm, direction as string);
    if (dup) { fail400(res, '该方向下已存在同名类型'); return; }
    const result = await createExpenseType(getDb(), {
      ownerId: req.user!.id, name: nm, direction: direction as string,
      linkCustomer: !!link_customer, linkProduct: !!link_product,
      linkCat: (link_cat as string) || '',
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/expense-types/:id', async (req: Request, res: Response) => {
  try {
    const { name, direction, link_customer, link_product, link_cat, enabled } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '类型名称必填'); return; }
    const old = await findExpenseTypeById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '类型不存在'); return; }
    const nm: string = String(name).trim();
    const dir: string = (direction as string) || old.direction;
    if (dir !== 'income' && dir !== 'expense') { fail400(res, '方向必须是 income 或 expense'); return; }
    const dup = await findExpenseTypeByNameDir(getDb(), req.user!.id, nm, dir);
    if (dup && dup.id !== Number(req.params.id)) { fail400(res, '该方向下已存在同名类型'); return; }
    await updateExpenseType(getDb(), Number(req.params.id), req.user!.id, {
      name: nm, direction: dir, linkCustomer: !!link_customer,
      linkProduct: !!link_product, linkCat: (link_cat as string) || '',
      enabled: enabled !== undefined ? !!enabled : undefined,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/expense-types/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findExpenseTypeById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '类型不存在'); return; }
    await deleteExpenseType(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
