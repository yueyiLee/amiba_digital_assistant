/**
 * routes/transactions.ts — 收支流水、支出项预设、收支类型
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== transactions 收支流水 ========== */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { unit, type, startDate, endDate } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT t.*, c.name AS customer_name, p.name AS product_name FROM transactions t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN products p ON t.product_id=p.id WHERE t.owner_id=$1';
    const params: unknown[] = [req.user!.id];
    let pi = 1;
    if (unit && unit !== '全部单元') { params.push(unit); sql += ` AND t.unit=$${++pi}`; }
    if (type) { params.push(type); sql += ` AND t.type=$${++pi}`; }
    if (startDate) { params.push(startDate); sql += ` AND t.date>=$${++pi}`; }
    if (endDate) { params.push(endDate); sql += ` AND t.date<=$${++pi}`; }
    sql += ' ORDER BY t.date DESC, t.id DESC';
    const rows = await db.queryAll(sql, params);
    const cids = [...new Set(rows.map((r) => r.contract_id).filter(Boolean))] as number[];
    const nameMap: Record<number, { display_name: string; direction: string }> = {};
    if (cids.length) {
      const cons = await db.queryAll(
        `SELECT co.id, co.date, co.direction, cu.name AS customer_name,
        (SELECT COALESCE(string_agg(p.name, ','), '') FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id=co.id) AS prod_names,
        (SELECT COALESCE(string_agg(cs.service_name, ','), '') FROM contract_services cs WHERE cs.contract_id=co.id) AS svc_names
        FROM contracts co LEFT JOIN customers cu ON co.customer_id=cu.id WHERE co.id = ANY($1::int[])`,
        [cids]
      );
      cons.forEach((co) => {
        const names: string[] = [];
        if (co.prod_names) (co.prod_names as string).split(',').forEach((n: string) => n && names.push(n));
        if (co.svc_names) (co.svc_names as string).split(',').forEach((n: string) => n && names.push(n));
        const d: string = (co.date as string) || '';
        const display_name: string = names.length
          ? `${d}-${(co.customer_name as string) || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
          : `${d}-${(co.customer_name as string) || '—'}`;
        nameMap[co.id as number] = { display_name, direction: co.direction as string };
      });
    }
    const out = rows.map((r) => ({
      ...r,
      contract_display_name: r.contract_id ? (nameMap[r.contract_id as number] ? nameMap[r.contract_id as number].display_name : null) : null,
      contract_direction: r.contract_id ? (nameMap[r.contract_id as number] ? nameMap[r.contract_id as number].direction : null) : null,
    }));
    ok(res, out);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/transactions', async (req: Request, res: Response) => {
  try {
    const { amount, type, unit, date, customer_id, product_id, note, category, contract_id } = (req.body || {}) as Record<string, unknown>;
    if (amount == null || !type || !date) { fail400(res, '缺少必要字段（金额/类型/日期）'); return; }
    if (customer_id) {
      const c = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [customer_id as number, req.user!.id]);
      if (!c) { fail400(res, '客户不存在或无权访问'); return; }
    }
    if (product_id) {
      const p = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [product_id as number, req.user!.id]);
      if (!p) { fail400(res, '商品不存在或无权访问'); return; }
    }
    if (contract_id) {
      const co = await db.queryOne('SELECT 1 FROM contracts WHERE id=$1 AND owner_id=$2', [contract_id as number, req.user!.id]);
      if (!co) { fail400(res, '合同不存在或无权访问'); return; }
    }
    const result = await db.insertReturning(
      'INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,category,contract_id,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [amount, type, (unit as string) || '全公司', customer_id || null, product_id || null, date, (note as string) || '', (category as string) || '', contract_id || null, req.user!.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const t = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '记录不存在'); return; }
    if (t.customer_id) {
      const c = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [t.customer_id as number, req.user!.id]);
      if (!c) { fail400(res, '客户不存在或无权访问'); return; }
    }
    if (t.product_id) {
      const p = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [t.product_id as number, req.user!.id]);
      if (!p) { fail400(res, '商品不存在或无权访问'); return; }
    }
    if (t.contract_id) {
      const co = await db.queryOne('SELECT 1 FROM contracts WHERE id=$1 AND owner_id=$2', [t.contract_id as number, req.user!.id]);
      if (!co) { fail400(res, '合同不存在或无权访问'); return; }
    }
    const newContract: unknown = t.contract_id === undefined ? old.contract_id : (t.contract_id || null);
    await db.query(
      'UPDATE transactions SET amount=$1,type=$2,unit=$3,customer_id=$4,product_id=$5,date=$6,note=$7,category=$8,contract_id=$9 WHERE id=$10 AND owner_id=$11',
      [(t.amount as number) ?? old.amount, (t.type as string) ?? old.type, (t.unit as string) ?? old.unit,
      t.customer_id === undefined ? old.customer_id : (t.customer_id || null),
      t.product_id === undefined ? old.product_id : (t.product_id || null),
      (t.date as string) ?? old.date, (t.note as string) ?? old.note,
      t.category === undefined ? old.category : ((t.category as string) || ''),
      newContract, req.params.id, req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '记录不存在'); return; }
    await db.query('DELETE FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== expense_items 支出项预设 ========== */
router.get('/expense-items', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll('SELECT id, kind, name, note FROM expense_items WHERE owner_id=$1 ORDER BY id', [req.user!.id]);
    ok(res, rows);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/expense-items', async (req: Request, res: Response) => {
  try {
    const { kind, name, note } = (req.body || {}) as Record<string, unknown>;
    if (!kind || !name || !String(name).trim()) { fail400(res, '缺少必要字段（类型/名称）'); return; }
    const nm: string = String(name).trim();
    const nt: string = note == null ? '' : String(note).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_items WHERE owner_id=$1 AND kind=$2 AND name=$3', [req.user!.id, kind, nm]);
    if (dup) { fail400(res, '该类别已存在'); return; }
    const result = await db.insertReturning(
      'INSERT INTO expense_items(owner_id,kind,name,note) VALUES($1,$2,$3,$4) RETURNING id',
      [req.user!.id, kind, nm, nt]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/expense-items/:id', async (req: Request, res: Response) => {
  try {
    const { name, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '名称必填'); return; }
    const old = await db.queryOne('SELECT * FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '类别不存在'); return; }
    const nm: string = String(name).trim();
    const nt: string = note == null ? '' : String(note).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_items WHERE owner_id=$1 AND kind=$2 AND name=$3 AND id<>$4', [req.user!.id, old.kind, nm, req.params.id]);
    if (dup) { fail400(res, '该类别已存在'); return; }
    await db.query('UPDATE expense_items SET name=$1, note=$2 WHERE id=$3 AND owner_id=$4', [nm, nt, req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/expense-items/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '类别不存在'); return; }
    await db.query('DELETE FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== expense_types 收支类型 ========== */
router.get('/expense-types', async (req: Request, res: Response) => {
  try {
    const { direction, enabled } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT id, name, direction, link_customer, link_product, link_cat, enabled FROM expense_types WHERE owner_id=$1';
    const params: unknown[] = [req.user!.id];
    if (direction) { params.push(direction); sql += ` AND direction=$${params.length}`; }
    if (enabled === 'true') { params.push(true); sql += ` AND enabled=$${params.length}`; }
    sql += ' ORDER BY direction, id';
    const rows = await db.queryAll(sql, params);
    ok(res, rows);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/expense-types', async (req: Request, res: Response) => {
  try {
    const { name, direction, link_customer, link_product, link_cat } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '类型名称必填'); return; }
    if (direction !== 'income' && direction !== 'expense') { fail400(res, '方向必须是 income 或 expense'); return; }
    const nm: string = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_types WHERE owner_id=$1 AND name=$2 AND direction=$3', [req.user!.id, nm, direction]);
    if (dup) { fail400(res, '该方向下已存在同名类型'); return; }
    const result = await db.insertReturning(
      'INSERT INTO expense_types(owner_id,name,direction,link_customer,link_product,link_cat,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.user!.id, nm, direction, !!link_customer, !!link_product, (link_cat as string) || '', true]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/expense-types/:id', async (req: Request, res: Response) => {
  try {
    const { name, direction, link_customer, link_product, link_cat, enabled } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '类型名称必填'); return; }
    const old = await db.queryOne('SELECT * FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '类型不存在'); return; }
    const nm: string = String(name).trim();
    const dir: string = (direction as string) || (old.direction as string);
    if (dir !== 'income' && dir !== 'expense') { fail400(res, '方向必须是 income 或 expense'); return; }
    const dup = await db.queryOne('SELECT 1 FROM expense_types WHERE owner_id=$1 AND name=$2 AND direction=$3 AND id<>$4', [req.user!.id, nm, dir, req.params.id]);
    if (dup) { fail400(res, '该方向下已存在同名类型'); return; }
    await db.query(
      'UPDATE expense_types SET name=$1, direction=$2, link_customer=$3, link_product=$4, link_cat=$5, enabled=$6 WHERE id=$7 AND owner_id=$8',
      [nm, dir, !!link_customer, !!link_product, (link_cat as string) || '', !!enabled, req.params.id, req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/expense-types/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '类型不存在'); return; }
    await db.query('DELETE FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
