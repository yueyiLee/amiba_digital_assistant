/**
 * routes/contracts-services.ts — 合同与服务管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== contracts 合同 ========== */
router.get('/contracts', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      `SELECT co.*, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id WHERE co.owner_id=$1 ORDER BY co.id DESC`,
      [req.user!.id]
    );
    const ids: number[] = rows.map((r) => r.id as number);
    let itemsMap: Record<number, Record<string, unknown>[]> = {};
    let svcMap: Record<number, Record<string, unknown>[]> = {};
    if (ids.length) {
      const inSql: string = ids.map((_, i) => `$${i + 1}`).join(',');
      const items = await db.queryAll(
        `SELECT ci.*, p.name AS product_name FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id IN (${inSql}) AND ci.owner_id=$${ids.length + 1}`,
        [...ids, req.user!.id] as unknown[]
      );
      const svcs = await db.queryAll(
        `SELECT cs.* FROM contract_services cs WHERE cs.contract_id IN (${inSql}) AND cs.owner_id=$${ids.length + 1}`,
        [...ids, req.user!.id] as unknown[]
      );
      items.forEach((it) => { (itemsMap[it.contract_id as number] = itemsMap[it.contract_id as number] || []).push(it); });
      svcs.forEach((s) => { (svcMap[s.contract_id as number] = svcMap[s.contract_id as number] || []).push(s); });
    }
    const out = rows.map((r) => {
      const its = itemsMap[r.id as number] || [];
      const svs = svcMap[r.id as number] || [];
      const names: string[] = [...its.map((i) => (i.product_name as string) || '未命名商品'), ...svs.map((s) => (s.service_name as string) || '未命名服务')];
      const date: string = (r.date as string) || (r.start_date as string) || '';
      const displayName: string = names.length
        ? `${date}-${(r.customer_name as string) || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${date}-${(r.customer_name as string) || '—'}`;
      const detailAmount: number = its.reduce((s, i) => s + (Number(i.amount) || 0), 0) + svs.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return { ...r, items: its, services: svs, display_name: displayName, amount: (its.length || svs.length) ? detailAmount : (Number(r.amount) || 0) };
    });
    ok(res, out);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/contracts', async (req: Request, res: Response) => {
  try {
    const { customer_id, date, direction, status, start_date, end_date, note, items, services } = (req.body || {}) as Record<string, unknown>;
    if (!customer_id) { fail400(res, '请选择客户'); return; }
    const cust = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [customer_id as number, req.user!.id]);
    if (!cust) { fail400(res, '客户不存在或无权访问'); return; }
    const dir: string = direction === 'purchase' ? 'purchase' : 'sale';
    const useDate: string = (date as string) || (start_date as string) || '';
    const result = await db.insertReturning(
      'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,note,date,direction,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      ['', customer_id, 0, (status as string) || '进行中', (start_date as string) || '', (end_date as string) || '', (note as string) || '', useDate, dir, req.user!.id]
    );
    const cid: number = result.rows[0].id as number;
    let total = 0;
    for (const it of (Array.isArray(items) ? items : []) as Record<string, unknown>[]) {
      const pid: number = Number(it.product_id);
      if (!pid) continue;
      const qty: number = Number(it.quantity) || 0;
      const price: number = Number(it.actual_price) || 0;
      const amt: number = Number((qty * price).toFixed(2));
      const pr = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [pid, req.user!.id]);
      if (!pr) continue;
      await db.query('INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) VALUES($1,$2,$3,$4,$5,$6)',
        [cid, pid, qty, price, amt, req.user!.id]);
      total += amt;
    }
    for (const sv of (Array.isArray(services) ? services : []) as Record<string, unknown>[]) {
      const sid: number | null = sv.service_id ? Number(sv.service_id) : null;
      const sname: string = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt: number = Number(sv.amount) || 0;
      if (sid) {
        const sr = await db.queryOne('SELECT 1 FROM services WHERE id=$1 AND owner_id=$2', [sid, req.user!.id]);
        if (!sr) continue;
      }
      await db.query('INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
        [cid, sid, sname, samt, req.user!.id]);
      total += samt;
    }
    await db.query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number(total.toFixed(2)), cid]);
    ok(res, { id: cid });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/contracts/:id', async (req: Request, res: Response) => {
  try {
    const c = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '合同不存在'); return; }
    if (c.customer_id && c.customer_id !== old.customer_id) {
      const cust2 = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [c.customer_id as number, req.user!.id]);
      if (!cust2) { fail400(res, '客户不存在或无权访问'); return; }
    }
    const dir: string = c.direction === 'purchase' ? 'purchase' : (c.direction === 'sale' ? 'sale' : ((old.direction as string) || 'sale'));
    const useDate: string = c.date !== undefined ? ((c.date as string) || (old.start_date as string) || '') : ((old.date as string) || '');
    await db.query(
      'UPDATE contracts SET customer_id=$1,status=$2,start_date=$3,end_date=$4,note=$5,date=$6,direction=$7 WHERE id=$8 AND owner_id=$9',
      [(c.customer_id as number) ?? old.customer_id, (c.status as string) ?? old.status, (c.start_date as string) ?? old.start_date,
      (c.end_date as string) ?? old.end_date, (c.note as string) ?? old.note, useDate, dir, req.params.id, req.user!.id]
    );
    const cid: number = Number(req.params.id);
    await db.query('DELETE FROM contract_items WHERE contract_id=$1 AND owner_id=$2', [cid, req.user!.id]);
    await db.query('DELETE FROM contract_services WHERE contract_id=$1 AND owner_id=$2', [cid, req.user!.id]);
    let total = 0;
    for (const it of (Array.isArray(c.items) ? c.items : []) as Record<string, unknown>[]) {
      const pid: number = Number(it.product_id);
      if (!pid) continue;
      const qty: number = Number(it.quantity) || 0;
      const price: number = Number(it.actual_price) || 0;
      const amt: number = Number((qty * price).toFixed(2));
      const pr = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [pid, req.user!.id]);
      if (!pr) continue;
      await db.query('INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) VALUES($1,$2,$3,$4,$5,$6)',
        [cid, pid, qty, price, amt, req.user!.id]);
      total += amt;
    }
    for (const sv of (Array.isArray(c.services) ? c.services : []) as Record<string, unknown>[]) {
      const sid: number | null = sv.service_id ? Number(sv.service_id) : null;
      const sname: string = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt: number = Number(sv.amount) || 0;
      if (sid) {
        const sr = await db.queryOne('SELECT 1 FROM services WHERE id=$1 AND owner_id=$2', [sid, req.user!.id]);
        if (!sr) continue;
      }
      await db.query('INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
        [cid, sid, sname, samt, req.user!.id]);
      total += samt;
    }
    await db.query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number(total.toFixed(2)), cid]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/contracts/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '合同不存在'); return; }
    await db.query('DELETE FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== services 服务 ========== */
router.get('/services', async (req: Request, res: Response) => {
  try {
    const { q } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT id, name, reference_cost, note FROM services WHERE owner_id=$1';
    const params: unknown[] = [req.user!.id];
    if (q) { params.push('%' + q + '%'); sql += ` AND name ILIKE $${params.length}`; }
    sql += ' ORDER BY id DESC';
    ok(res, await db.queryAll(sql, params));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/services', async (req: Request, res: Response) => {
  try {
    const { name, reference_cost, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '服务名称必填'); return; }
    const nm: string = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM services WHERE owner_id=$1 AND name=$2', [req.user!.id, nm]);
    if (dup) { fail400(res, '该服务已存在'); return; }
    const result = await db.insertReturning(
      'INSERT INTO services(owner_id,name,reference_cost,note) VALUES($1,$2,$3,$4) RETURNING id',
      [req.user!.id, nm, Number(reference_cost) || 0, note ? String(note).trim() : '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/services/:id', async (req: Request, res: Response) => {
  try {
    const { name, reference_cost, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '服务名称必填'); return; }
    const old = await db.queryOne('SELECT * FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '服务不存在'); return; }
    const nm: string = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM services WHERE owner_id=$1 AND name=$2 AND id<>$3', [req.user!.id, nm, req.params.id]);
    if (dup) { fail400(res, '该服务已存在'); return; }
    await db.query('UPDATE services SET name=$1, reference_cost=$2, note=$3 WHERE id=$4 AND owner_id=$5',
      [nm, Number(reference_cost) || 0, note ? String(note).trim() : '', req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/services/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '服务不存在'); return; }
    await db.query('DELETE FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
