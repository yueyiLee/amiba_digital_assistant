/**
 * routes/contracts-services.ts — 合同与服务管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import { findCustomerById } from '../drizzle/queries/customers.queries.js';
import { findProductById } from '../drizzle/queries/products.queries.js';
import {
  listContracts, getContractItemsByContractIds, getContractServicesByContractIds,
  findContractById, createContract, updateContract, deleteContract,
  createContractItem, deleteContractItemsByContract,
  createContractService, deleteContractServicesByContract,
  listServices, findServiceByName, findServiceById,
  createService, updateService, deleteService,
} from '../drizzle/queries/contracts.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== contracts 合同 ========== */
router.get('/contracts', async (req: Request, res: Response) => {
  try {
    const rows = await listContracts(getDb(), req.user!.id);
    const ids: number[] = rows.map((r) => r.id);
    let itemsMap: Record<number, Record<string, unknown>[]> = {};
    let svcMap: Record<number, Record<string, unknown>[]> = {};
    if (ids.length) {
      const items = await getContractItemsByContractIds(getDb(), ids, req.user!.id);
      const svcs = await getContractServicesByContractIds(getDb(), ids, req.user!.id);
      items.forEach((it) => {
        const cid = it.contractId as number;
        (itemsMap[cid] = itemsMap[cid] || []).push(it as unknown as Record<string, unknown>);
      });
      svcs.forEach((s) => {
        const cid = s.contractId as number;
        (svcMap[cid] = svcMap[cid] || []).push(s as unknown as Record<string, unknown>);
      });
    }
    const out = rows.map((r) => {
      const its = itemsMap[r.id] || [];
      const svs = svcMap[r.id] || [];
      const names: string[] = [
        ...its.map((i) => (i.productName as string) || '未命名商品'),
        ...svs.map((s) => (s.serviceName as string) || '未命名服务'),
      ];
      const date: string = r.date || r.startDate || '';
      const displayName: string = names.length
        ? `${date}-${r.customerName || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${date}-${r.customerName || '—'}`;
      const detailAmount: number = its.reduce((s, i) => s + (Number(i.amount) || 0), 0) +
        svs.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return { ...r, items: its, services: svs, display_name: displayName, amount: (its.length || svs.length) ? detailAmount : (Number(r.amount) || 0) };
    });
    ok(res, out);
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/contracts', async (req: Request, res: Response) => {
  try {
    const { customer_id, date, direction, status, start_date, end_date, note, items, services } = (req.body || {}) as Record<string, unknown>;
    if (!customer_id) { fail400(res, '请选择客户'); return; }
    const db = getDb();
    // 前置校验（读操作，在事务外提前失败）
    const cust = await findCustomerById(db, customer_id as number, req.user!.id);
    if (!cust) { fail400(res, '客户不存在或无权访问'); return; }
    const itmArr = (Array.isArray(items) ? items : []) as Record<string, unknown>[];
    const svcArr = (Array.isArray(services) ? services : []) as Record<string, unknown>[];
    // 解析并校验 items 中的 product
    const itmWithProd: { pid: number; qty: number; price: number; amt: number }[] = [];
    for (const it of itmArr) {
      const pid: number = Number(it.product_id);
      if (!pid) continue;
      const pr = await findProductById(db, pid, req.user!.id);
      if (!pr) continue;
      const qty: number = Number(it.quantity) || 0;
      const price: number = Number(it.actual_price) || 0;
      itmWithProd.push({ pid, qty, price, amt: Number((qty * price).toFixed(2)) });
    }
    // 解析 services
    const svcWithData: { sid: number | null; sname: string; samt: number }[] = [];
    for (const sv of svcArr) {
      const sid: number | null = sv.service_id ? Number(sv.service_id) : null;
      const sname: string = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt: number = Number(sv.amount) || 0;
      if (sid) {
        const sr = await findServiceById(db, sid, req.user!.id);
        if (!sr) continue;
      }
      svcWithData.push({ sid, sname, samt });
    }
    const dir: string = direction === 'purchase' ? 'purchase' : 'sale';

    // 多步写入包裹在事务中，确保原子性
    const cid = await db.transaction(async (tx) => {
      const result = await createContract(tx, {
        customerId: customer_id as number,
        date: date as string,
        direction: dir,
        status: status as string,
        startDate: start_date as string,
        endDate: end_date as string,
        note: note as string,
        ownerId: req.user!.id,
      });
      const contractId: number = result[0].id;
      let total = 0;
      for (const it of itmWithProd) {
        await createContractItem(tx, { contractId, productId: it.pid, quantity: it.qty, actualPrice: it.price, amount: it.amt, ownerId: req.user!.id });
        total += it.amt;
      }
      for (const sv of svcWithData) {
        await createContractService(tx, { contractId, serviceId: sv.sid, serviceName: sv.sname, amount: sv.samt, ownerId: req.user!.id });
        total += sv.samt;
      }
      await updateContract(tx, contractId, req.user!.id, { amount: Number(total.toFixed(2)) });
      return contractId;
    });
    ok(res, { id: cid });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/contracts/:id', async (req: Request, res: Response) => {
  try {
    const c = (req.body || {}) as Record<string, unknown>;
    const db = getDb();
    const cid: number = Number(req.params.id);
    // 前置校验（读操作，在事务外提前失败）
    const old = await findContractById(db, cid, req.user!.id);
    if (!old) { fail404(res, '合同不存在'); return; }
    if (c.customer_id && c.customer_id !== old.customerId) {
      const cust2 = await findCustomerById(db, c.customer_id as number, req.user!.id);
      if (!cust2) { fail400(res, '客户不存在或无权访问'); return; }
    }
    const dir: string = c.direction === 'purchase' ? 'purchase' : (c.direction === 'sale' ? 'sale' : (old.direction || 'sale'));
    const useDate: string = c.date !== undefined ? ((c.date as string) || (old.startDate as string) || '') : (old.date || '');

    // 解析新 items/services（读操作在事务外）
    const itmWithProd: { pid: number; qty: number; price: number; amt: number }[] = [];
    for (const it of (Array.isArray(c.items) ? c.items : []) as Record<string, unknown>[]) {
      const pid: number = Number(it.product_id);
      if (!pid) continue;
      const pr = await findProductById(db, pid, req.user!.id);
      if (!pr) continue;
      const qty: number = Number(it.quantity) || 0;
      const price: number = Number(it.actual_price) || 0;
      itmWithProd.push({ pid, qty, price, amt: Number((qty * price).toFixed(2)) });
    }
    const svcWithData: { sid: number | null; sname: string; samt: number }[] = [];
    for (const sv of (Array.isArray(c.services) ? c.services : []) as Record<string, unknown>[]) {
      const sid: number | null = sv.service_id ? Number(sv.service_id) : null;
      const sname: string = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt: number = Number(sv.amount) || 0;
      if (sid) {
        const sr = await findServiceById(db, sid, req.user!.id);
        if (!sr) continue;
      }
      svcWithData.push({ sid, sname, samt });
    }

    // 写操作全部在事务中执行
    await db.transaction(async (tx) => {
      await updateContract(tx, cid, req.user!.id, {
        customerId: c.customer_id !== undefined ? (c.customer_id as number) : undefined,
        status: c.status !== undefined ? (c.status as string) : undefined,
        startDate: c.start_date !== undefined ? (c.start_date as string) : undefined,
        endDate: c.end_date !== undefined ? (c.end_date as string) : undefined,
        note: c.note !== undefined ? (c.note as string) : undefined,
        date: useDate,
        direction: dir,
      });
      await deleteContractItemsByContract(tx, cid, req.user!.id);
      await deleteContractServicesByContract(tx, cid, req.user!.id);
      let total = 0;
      for (const it of itmWithProd) {
        await createContractItem(tx, { contractId: cid, productId: it.pid, quantity: it.qty, actualPrice: it.price, amount: it.amt, ownerId: req.user!.id });
        total += it.amt;
      }
      for (const sv of svcWithData) {
        await createContractService(tx, { contractId: cid, serviceId: sv.sid, serviceName: sv.sname, amount: sv.samt, ownerId: req.user!.id });
        total += sv.samt;
      }
      await updateContract(tx, cid, req.user!.id, { amount: Number(total.toFixed(2)) });
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/contracts/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findContractById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '合同不存在'); return; }
    await deleteContract(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== services 服务 ========== */
router.get('/services', async (req: Request, res: Response) => {
  try {
    const { q } = req.query as Record<string, string | undefined>;
    ok(res, await listServices(getDb(), req.user!.id, q));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/services', async (req: Request, res: Response) => {
  try {
    const { name, reference_cost, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '服务名称必填'); return; }
    const nm: string = String(name).trim();
    const dup = await findServiceByName(getDb(), req.user!.id, nm);
    if (dup) { fail400(res, '该服务已存在'); return; }
    const result = await createService(getDb(), {
      ownerId: req.user!.id, name: nm,
      referenceCost: Number(reference_cost) || 0,
      note: note ? String(note).trim() : '',
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/services/:id', async (req: Request, res: Response) => {
  try {
    const { name, reference_cost, note } = (req.body || {}) as Record<string, unknown>;
    if (!name || !String(name).trim()) { fail400(res, '服务名称必填'); return; }
    const old = await findServiceById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '服务不存在'); return; }
    const nm: string = String(name).trim();
    const dup = await findServiceByName(getDb(), req.user!.id, nm);
    if (dup && dup.id !== Number(req.params.id)) { fail400(res, '该服务已存在'); return; }
    await updateService(getDb(), Number(req.params.id), req.user!.id, {
      name: nm,
      referenceCost: Number(reference_cost) || 0,
      note: note ? String(note).trim() : '',
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/services/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findServiceById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '服务不存在'); return; }
    await deleteService(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
