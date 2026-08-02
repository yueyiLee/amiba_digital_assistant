/**
 * routes/index.ts — 业务 API 路由汇总（11 个模块，PostgreSQL 版，多租户账号隔离）
 * 所有业务接口均需 requireAuth 认证，全部按 req.user.id(owner_id) 隔离。
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { requireAuth } from '../middleware/auth';

const router: Router = express.Router();
router.use(requireAuth);

const ok = (res: Response, data: unknown): void => { res.json(data); };
const fail400 = (res: Response, msg: string): void => { res.status(400).json({ error: msg }); };
const fail404 = (res: Response, msg: string): void => { res.status(404).json({ error: msg }); };

/* ========== 1. transactions 收支流水 ========== */
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
        FROM contracts co LEFT JOIN customers cu ON co.customer_id=cu.id WHERE co.id = ANY($1)`,
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 1b. expense_items 支出项预设 ========== */
router.get('/expense-items', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll('SELECT id, kind, name, note FROM expense_items WHERE owner_id=$1 ORDER BY id', [req.user!.id]);
    ok(res, rows);
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/expense-items/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '类别不存在'); return; }
    await db.query('DELETE FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 1c. expense_types 收支类型 ========== */
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/expense-types/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '类型不存在'); return; }
    await db.query('DELETE FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '记录不存在'); return; }
    await db.query('DELETE FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 2. products 商品 ========== */
router.get('/products', async (req: Request, res: Response) => {
  try {
    const sql = `SELECT p.*, COALESCE(i.quantity, 0) AS stock
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id AND i.owner_id = p.owner_id
      WHERE p.owner_id=$1 ORDER BY p.id DESC`;
    ok(res, await db.queryAll(sql, [req.user!.id]));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/products/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '商品不存在'); return; }
    await db.query('DELETE FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 3. customers 客户 ========== */
router.get('/customers', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM customers WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const c = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '客户不存在'); return; }
    await db.query('UPDATE customers SET name=$1,type=$2,contact=$3,address=$4,notes=$5 WHERE id=$6 AND owner_id=$7',
      [(c.name as string) ?? old.name, (c.type as string) ?? old.type, (c.contact as string) ?? old.contact, (c.address as string) ?? old.address, (c.notes as string) ?? old.notes, req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '客户不存在'); return; }
    await db.query('DELETE FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 4. inventory 库存 ========== */
router.get('/inventory', async (req: Request, res: Response) => {
  try {
    ok(res, await db.queryAll(
      `SELECT i.*, p.name AS product_name, p.category1, p.category2, p.purchase_price, p.sale_price
       FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.owner_id=$1 ORDER BY i.id`,
      [req.user!.id]
    ));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '库存记录不存在'); return; }
    await db.query('DELETE FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 5. settings 设置 ========== */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll('SELECT key, value FROM settings WHERE owner_id=$1', [req.user!.id]);
    const obj: Record<string, unknown> = {};
    rows.forEach((r) => { obj[r.key as string] = r.value; });
    ok(res, obj);
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) {
      await db.query(
        'INSERT INTO settings(owner_id, key, value) VALUES($1,$2,$3) ON CONFLICT(owner_id, key) DO UPDATE SET value=excluded.value',
        [req.user!.id, k, typeof v === 'object' ? JSON.stringify(v) : String(v)]
      );
    }
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 6. categories 分类 ========== */
router.get('/categories', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM categories WHERE owner_id=$1 ORDER BY id', [req.user!.id])); }
  catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 7. employees 员工 ========== */
router.get('/employees', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM employees WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.post('/employees', async (req: Request, res: Response) => {
  try {
    const { name, position, hourly_rate, join_date, status, leave_date } = (req.body || {}) as Record<string, unknown>;
    if (!name) { fail400(res, '姓名必填'); return; }
    if (hourly_rate == null || (hourly_rate as number) <= 0) { fail400(res, '时薪必须大于 0'); return; }
    const result = await db.insertReturning(
      'INSERT INTO employees(name,position,hourly_rate,join_date,status,leave_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, (position as string) || '', hourly_rate, (join_date as string) || '', (status as string) || 'active', (leave_date as string) || '', req.user!.id]
    );
    const newId: number = result.rows[0].id as number;
    const today: string = new Date().toISOString().slice(0, 10);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId, 'active', '入职', (position as string) || '', (hourly_rate as number) || 0, (join_date as string) || today, '新增入职', req.user!.id]
    );
    ok(res, { id: newId });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.put('/employees/:id', async (req: Request, res: Response) => {
  try {
    const e = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '员工不存在'); return; }
    await db.query('UPDATE employees SET name=$1,position=$2,hourly_rate=$3,join_date=$4,leave_date=$5 WHERE id=$6 AND owner_id=$7',
      [(e.name as string) ?? old.name, (e.position as string) ?? old.position, (e.hourly_rate as number) ?? old.hourly_rate, (e.join_date as string) ?? old.join_date, (e.leave_date as string) ?? (old.leave_date as string) ?? '', req.params.id, req.user!.id]);
    const needUpdateHistory: boolean = e.position !== undefined || e.hourly_rate !== undefined || e.join_date !== undefined;
    if (needUpdateHistory) {
      await db.query(
        `UPDATE employee_status_history h
         SET position = COALESCE($1, h.position), hourly_rate = COALESCE($2, h.hourly_rate), changed_date = COALESCE($3, h.changed_date)
         WHERE h.id = (
           SELECT id FROM employee_status_history
           WHERE employee_id=$4 AND owner_id=$5 AND status='active'
           ORDER BY changed_date DESC, id DESC LIMIT 1
         )`,
        [e.position !== undefined ? ((e.position as string) || '') : null,
        e.hourly_rate !== undefined ? ((e.hourly_rate as number) || 0) : null,
        e.join_date !== undefined ? ((e.join_date as string) || '') : null,
        Number(req.params.id), req.user!.id]
      );
    }
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.get('/employees/:id/status-history', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 ORDER BY changed_date ASC, id ASC',
      [req.params.id, req.user!.id]
    );
    ok(res, rows);
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.get('/employee-status-history-all', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE owner_id=$1 ORDER BY employee_id ASC, changed_date ASC, id ASC',
      [req.user!.id]
    );
    ok(res, rows);
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.patch('/employees/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, leave_date, note, position, hourly_rate, changed_date } = (req.body || {}) as Record<string, unknown>;
    if (!status || !['active', 'left'].includes(status as string)) { fail400(res, 'status 必须是 active 或 left'); return; }
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '员工不存在'); return; }
    const today: string = new Date().toISOString().slice(0, 10);
    const changedDate: string = status === 'left'
      ? ((leave_date as string) || (changed_date as string) || (old.leave_date as string) || today)
      : ((changed_date as string) || today);
    const newLeave: string = status === 'left' ? changedDate : '';
    const changeType: string = ((old.status as string) || 'active') === 'left' ? '复职' : '离职';
    const snapPos: string = (position !== undefined && position !== null) ? (position as string) : ((old.position as string) || '');
    const snapRate: number = (hourly_rate !== undefined && hourly_rate !== null) ? (hourly_rate as number) : ((old.hourly_rate as number) || 0);

    const hasHistory = await db.queryOne('SELECT 1 FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 LIMIT 1', [req.params.id, req.user!.id]);
    if (!hasHistory) {
      const startDate: string = (old.join_date as string) || changedDate;
      await db.query(
        'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.params.id, 'active', '入职', (old.position as string) || '', (old.hourly_rate as number) || 0, startDate, '系统自动补全入职状态', req.user!.id]
      );
    }

    await db.query('UPDATE employees SET status=$1, leave_date=$2 WHERE id=$3 AND owner_id=$4',
      [status, newLeave, req.params.id, req.user!.id]);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id, status, changeType, status === 'left' ? '' : snapPos, status === 'left' ? 0 : snapRate, changedDate, (note as string) || '', req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/employees/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '员工不存在'); return; }
    await db.query('DELETE FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 8. contracts 合同 ========== */
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/contracts/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '合同不存在'); return; }
    await db.query('DELETE FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 8b. services 服务 ========== */
router.get('/services', async (req: Request, res: Response) => {
  try {
    const { q } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT id, name, reference_cost, note FROM services WHERE owner_id=$1';
    const params: unknown[] = [req.user!.id];
    if (q) { params.push('%' + q + '%'); sql += ` AND name ILIKE $${params.length}`; }
    sql += ' ORDER BY id DESC';
    ok(res, await db.queryAll(sql, params));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
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
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/services/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '服务不存在'); return; }
    await db.query('DELETE FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 9. workhours 月度工时 ========== */
router.get('/workhours', async (req: Request, res: Response) => {
  try {
    const { month } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT wh.*, e.name AS employee_name, e.hourly_rate FROM work_hours wh JOIN employees e ON wh.employee_id=e.id WHERE wh.owner_id=$1';
    const params: unknown[] = [req.user!.id];
    if (month) { sql += ' AND wh.month=$2'; params.push(month); }
    ok(res, await db.queryAll(sql, params));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.post('/workhours', async (req: Request, res: Response) => {
  try {
    const { employee_id, hours, month } = (req.body || {}) as Record<string, unknown>;
    if (!employee_id || hours == null || !month) { fail400(res, '员工、工时、月份必填'); return; }
    if ((hours as number) < 0) { fail400(res, '工时必须为有效正数'); return; }
    const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id as number, req.user!.id]);
    if (!emp) { fail404(res, '员工不存在'); return; }
    await db.query(
      `INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(employee_id,month) DO UPDATE SET hours=excluded.hours`,
      [employee_id, hours, month, req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/workhours/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '工时记录不存在'); return; }
    await db.query('DELETE FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 10. salaries 工资 ========== */
router.get('/salaries', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM salaries WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.post('/salaries', async (req: Request, res: Response) => {
  try {
    const { employee_id, amount, month } = (req.body || {}) as Record<string, unknown>;
    if (employee_id) {
      const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id as number, req.user!.id]);
      if (!emp) { fail404(res, '员工不存在'); return; }
    }
    const result = await db.insertReturning(
      'INSERT INTO salaries(employee_id,amount,month,owner_id) VALUES($1,$2,$3,$4) RETURNING id',
      [employee_id, (amount as number) || 0, (month as string) || '', req.user!.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.delete('/salaries/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '工资记录不存在'); return; }
    await db.query('DELETE FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 11. init 重置示例数据 ========== */
router.post('/init/sample', async (req: Request, res: Response) => {
  try {
    const uid: number = req.user!.id;
    await db.query('DELETE FROM transactions WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM work_hours WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM salaries WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM contracts WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM services WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM inventory WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM products WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM customers WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM employees WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM categories WHERE owner_id=$1', [uid]);
    await db.query('DELETE FROM settings WHERE owner_id=$1', [uid]);
    await db.seedForUser(uid, 'full');
    ok(res, { success: true, message: '示例数据已重置' });
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 候选合同推荐 ========== */
router.get('/contracts/suggest', async (req: Request, res: Response) => {
  try {
    const { direction, customer_id, date } = req.query as Record<string, string | undefined>;
    let sql = `SELECT co.id, co.date, co.direction, c.name AS customer_name,
      (SELECT COALESCE(string_agg(p.name, ','), '') FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id=co.id) AS prod_names,
      (SELECT COALESCE(string_agg(cs.service_name, ','), '') FROM contract_services cs WHERE cs.contract_id=co.id) AS svc_names
      FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id WHERE co.owner_id=$1`;
    const params: unknown[] = [req.user!.id];
    let pi = 1;
    if (direction) { params.push(direction); sql += ` AND co.direction=$${++pi}`; }
    if (customer_id) { params.push(customer_id); sql += ` AND co.customer_id=$${++pi}`; }
    sql += ' ORDER BY co.id DESC';
    const rows = await db.queryAll(sql, params);
    const list: Record<string, unknown>[] = rows.map((co) => {
      const names: string[] = [];
      if (co.prod_names) (co.prod_names as string).split(',').forEach((n: string) => n && names.push(n));
      if (co.svc_names) (co.svc_names as string).split(',').forEach((n: string) => n && names.push(n));
      const d: string = (co.date as string) || '';
      const display_name: string = names.length
        ? `${d}-${(co.customer_name as string) || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${d}-${(co.customer_name as string) || '—'}`;
      return { id: co.id, display_name, date: d, direction: co.direction, customer_name: co.customer_name };
    });
    if (date) {
      list.forEach((x) => {
        const diff: number = Math.abs((new Date(x.date as string).getTime() - new Date(date).getTime()) / 86400000);
        (x as Record<string, unknown>)._diff = isNaN(diff) ? 9999 : diff;
      });
      list.sort((a, b) => ((a as Record<string, unknown>)._diff as number) - ((b as Record<string, unknown>)._diff as number));
    }
    ok(res, list);
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 分析聚合函数 ========== */

const numOf = (v: unknown): number => Number(v ?? 0) || 0;

function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const parts: number[] = String(dateStr).split('-').map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return 0;
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayLocal.getTime() - localDate.getTime()) / 86400000);
}

function buildTxFilter(ownerId: number, sd: string, ed: string, unit?: string | null): { where: string; params: unknown[] } {
  const useUnit: boolean = !!(unit && unit !== '全部单元');
  return {
    where: `t.owner_id=$1 AND t.date BETWEEN $2 AND $3${useUnit ? ' AND t.unit=$4' : ''}`,
    params: useUnit ? [ownerId, sd, ed, unit] : [ownerId, sd, ed],
  };
}

async function productAnalysis(ownerId: number, direction: string, sd: string, ed: string) {
  const isSale: boolean = direction === 'sale';
  const totalAmtRow = isSale
    ? await db.queryOne(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE owner_id=$1 AND type='销售收入' AND amount>0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed])
    : await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalAmount: number = Number(totalAmtRow && totalAmtRow.s) || 0;

  const byAmtRows = isSale
    ? await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(t.amount) AS amt FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.owner_id=$1 AND t.type='销售收入' AND t.amount>0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed])
    : await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(ABS(t.amount)) AS amt FROM transactions t LEFT JOIN products p ON t.product_id = p.id WHERE t.owner_id=$1 AND t.type='材料采购' AND t.amount<0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed]);

  const qtyRows = await db.queryAll(`SELECT ci.product_id, p.name AS product_name, SUM(ci.quantity) AS qty, SUM(ci.quantity * ci.actual_price) AS amt FROM contract_items ci JOIN contracts co ON ci.contract_id = co.id LEFT JOIN products p ON ci.product_id = p.id WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4 GROUP BY ci.product_id, p.name ORDER BY amt DESC`, [ownerId, direction, sd, ed]);

  const series = await db.queryAll(`SELECT ci.product_id, p.name AS product_name, co.date, ci.actual_price FROM contract_items ci JOIN contracts co ON ci.contract_id = co.id LEFT JOIN products p ON ci.product_id = p.id WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4 ORDER BY ci.product_id, co.date`, [ownerId, direction, sd, ed]);
  const byPid: Record<number, { date: string; price: number; name: string }[]> = {};
  series.forEach((s) => {
    if (s.product_id == null) return;
    (byPid[s.product_id as number] = byPid[s.product_id as number] || []).push({ date: s.date as string, price: Number(s.actual_price) || 0, name: s.product_name as string });
  });
  const priceChange = Object.values(byPid).map((arr) => {
    const prices: number[] = arr.map((x) => x.price).filter((v) => v > 0);
    if (prices.length < 2) return null;
    const min: number = Math.min(...prices), max: number = Math.max(...prices);
    const change: number = min > 0 ? (max - min) / min : 0;
    return { product_name: arr[0].name, change, min, max, samples: arr.length };
  }).filter(Boolean).sort((a, b) => (b as { change: number }).change - (a as { change: number }).change).slice(0, 5);

  const costRow = await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS c FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalCost: number = Number(costRow && costRow.c) || 0;
  const totalQty: number = qtyRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const avgGm: number = isSale && totalAmount > 0 ? Math.max(0, (totalAmount - totalCost) / totalAmount) : 0;

  let costByPid: Record<number, number> = {};
  if (isSale) {
    const costByPidRows = await db.queryAll(`SELECT product_id, SUM(ABS(amount)) AS cost FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND product_id IS NOT NULL AND date BETWEEN $2 AND $3 GROUP BY product_id`, [ownerId, sd, ed]);
    costByPidRows.forEach((r) => { costByPid[r.product_id as number] = Number(r.cost) || 0; });
  }

  const byQty = qtyRows.slice().sort((a, b) => Number(b.qty) - Number(a.qty)).slice(0, 5)
    .map((r) => ({ product_id: r.product_id, product_name: r.product_name, total_qty: Number(r.qty) || 0, total_amount: Number(r.amt) || 0 }));
  const byAmount = byAmtRows.slice(0, 5).map((r) => {
    const sale: number = Number(r.amt) || 0;
    const cost: number = isSale ? (costByPid[r.product_id as number] || 0) : 0;
    const gm: number = isSale && sale > 0 ? Math.max(0, (sale - cost) / sale) : 0;
    return { product_id: r.product_id, product_name: r.product_name, total_amount: sale, cost, gm };
  });
  return { total_sale: totalAmount, total_cost: isSale ? totalCost : totalAmount, total_qty: totalQty, avg_gm: avgGm, by_qty: byQty, by_amount: byAmount, price_change: priceChange };
}

router.get('/analysis/product-sales', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user!.id, 'sale', sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

router.get('/analysis/product-purchase', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user!.id, 'purchase', sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 分析驾驶舱 ========== */
const COCKPIT_ALERT_RULES = {
  customerRecvRed: 80000,
  customerRecvYellow: 40000,
  productMargin: 0.15,
  productStockAge: 60,
  cashGap: -20000,
};
const COCKPIT_ALERT_LIMIT = 10;

interface AlertItem {
  level: string;
  title: string;
  sub: string;
  value: string;
  jumpTo: string;
}

function fmtCny(v: number): string {
  return `¥${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
}

async function cockpitAnalysis(ownerId: number, sd: string, ed: string, unit?: string | null) {
  const { where: txWhere, params: txParams } = buildTxFilter(ownerId, sd, ed, unit);

  const typeRows = await db.queryAll(
    `SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${txWhere} GROUP BY t.type`,
    txParams
  );
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type as string] = numOf(r.raw); absAmt[r.type as string] = numOf(r.abs_amt); });

  const salesIncome: number = raw['销售收入'] || 0;
  const cashIncome: number = raw['现金收入'] || 0;
  const otherIncome: number = raw['其他收入'] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt['材料采购'] || 0;
  const processCost: number = absAmt['委托加工'] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt['杂费支出'] || 0;
  const cashExpense: number = absAmt['现金支出'] || 0;
  const taxCost: number = absAmt['税金'] || 0;
  const receivable: number = salesIncome - cashIncome;
  const addedValue: number = totalIncome - consumeCost - miscCost;
  const totalExpense: number = materialCost + processCost + miscCost + taxCost;
  const payable: number = totalExpense - cashExpense;

  const smk: string = String(sd).slice(0, 7), emk: string = String(ed).slice(0, 7);
  const salaryRow = await db.queryOne(
    `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
    [ownerId, smk, emk]
  );
  const totalSalary: number = numOf(salaryRow && salaryRow.salary);
  const totalHours: number = numOf(salaryRow && salaryRow.hours);
  const profit: number = addedValue - totalSalary - taxCost;
  const netCashFlow: number = cashIncome - cashExpense;

  const invRow = await db.queryOne(`SELECT COALESCE(SUM(quantity * avg_price), 0) AS v FROM inventory WHERE owner_id=$1`, [ownerId]);
  const inventoryValue: number = numOf(invRow && invRow.v);

  const custRows = await db.queryAll(
    `SELECT t.customer_id, c.name AS customer_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount WHEN t.type='现金收入' THEN -t.amount ELSE 0 END), 0) AS recv FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE ${txWhere} AND t.customer_id IS NOT NULL GROUP BY t.customer_id, c.name`,
    txParams
  );

  const prodRows = await db.queryAll(
    `SELECT t.product_id, p.name AS product_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN products p ON p.id = t.product_id WHERE ${txWhere} AND t.product_id IS NOT NULL GROUP BY t.product_id, p.name`,
    txParams
  );
  const productMetrics = prodRows.map((r) => {
    const sale: number = numOf(r.sale), cost: number = numOf(r.cost);
    return { id: r.product_id, name: r.product_name, sale, cost, gm: sale > 0 ? (sale - cost) / sale : 0 };
  });

  const staleRows = await db.queryAll(
    `SELECT i.product_id, p.name AS product_name, i.quantity, EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 86400 AS days FROM inventory i LEFT JOIN products p ON p.id = i.product_id WHERE i.owner_id=$1 AND i.quantity > 0 AND i.updated_at IS NOT NULL`,
    [ownerId]
  );

  const alerts: AlertItem[] = [];
  custRows.forEach((r) => {
    const recv: number = numOf(r.recv);
    if (recv >= COCKPIT_ALERT_RULES.customerRecvRed) {
      alerts.push({ level: 'red', title: `客户【${r.customer_name}】应收 ${fmtCny(recv)}`, sub: '超过预警阈值，建议立即跟进回款', value: fmtCny(recv), jumpTo: 'customer' });
    } else if (recv >= COCKPIT_ALERT_RULES.customerRecvYellow) {
      alerts.push({ level: 'yellow', title: `客户【${r.customer_name}】应收 ${fmtCny(recv)}`, sub: '需保持关注', value: fmtCny(recv), jumpTo: 'customer' });
    }
  });
  productMetrics.forEach((r) => {
    if (r.sale > 0 && r.gm < COCKPIT_ALERT_RULES.productMargin) {
      const pct: string = `${(r.gm * 100).toFixed(1)}%`;
      alerts.push({ level: 'red', title: `商品【${r.name}】毛利率 ${pct}`, sub: '毛利率跌破健康线', value: pct, jumpTo: 'product' });
    }
  });
  staleRows.forEach((r) => {
    const days: number = Math.floor(numOf(r.days));
    if (days > COCKPIT_ALERT_RULES.productStockAge) {
      alerts.push({ level: 'yellow', title: `商品【${(r.product_name as string) || '未知商品'}】库存呆滞 ${days} 天`, sub: '建议盘点/促销/调拨', value: `${days} 天`, jumpTo: 'product' });
    }
  });
  if (netCashFlow < COCKPIT_ALERT_RULES.cashGap) {
    alerts.push({ level: 'red', title: `净现金流 ${fmtCny(netCashFlow)}`, sub: '现金缺口较大，关注回款', value: fmtCny(netCashFlow), jumpTo: 'overview' });
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC LIMIT 1`,
    txParams
  );
  const topCustomer = custRows.length > 0 ? custRows.slice().sort((a, b) => numOf(b.sale) - numOf(a.sale))[0] : undefined;
  const topProduct = productMetrics.length > 0 ? productMetrics.slice().sort((a, b) => b.sale - a.sale)[0] : undefined;
  const topUnit = unitRows.length > 0 ? unitRows[0] : undefined;

  const tops = [
    { label: 'Top 客户贡献', name: topCustomer ? (topCustomer.customer_name as string) : '', value: topCustomer ? fmtCny(numOf(topCustomer.sale)) : '', jumpTo: 'customer' },
    { label: 'Top 商品销售', name: topProduct ? (topProduct.name as string) : '', value: topProduct ? fmtCny(topProduct.sale) : '', jumpTo: 'product' },
    { label: '单元附加价值排行', name: topUnit ? (topUnit.unit as string) : '', value: topUnit ? fmtCny(numOf(topUnit.added_value)) : '', jumpTo: 'amoeba' },
  ];

  return {
    kpi: { total_sales: salesIncome, total_profit: profit, receivable, payable, net_cash_flow: netCashFlow, inventory_value: inventoryValue, profit_rate: salesIncome > 0 ? (profit / salesIncome) * 100 : 0, added_value: addedValue, total_hours: totalHours, total_salary: totalSalary },
    alerts: alerts.slice(0, COCKPIT_ALERT_LIMIT),
    alert_count: { red: alerts.filter((a) => a.level === 'red').length, yellow: alerts.filter((a) => a.level === 'yellow').length },
    tops,
    unit_hours_available: false,
  };
}

router.get('/analysis/cockpit', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, unit } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await cockpitAnalysis(req.user!.id, sd, ed, unit));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 客户分析 ========== */
async function customerAnalysis(ownerId: number, sd: string, ed: string) {
  const totalRow = await db.queryOne('SELECT COUNT(*) AS total FROM customers WHERE owner_id=$1', [ownerId]);
  const totalCount: number = Number(totalRow?.total) || 0;

  const activeRow = await db.queryOne(`SELECT COUNT(DISTINCT t.customer_id) AS active FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const activeCount: number = Number(activeRow?.active) || 0;

  const recvRow = await db.queryOne(`SELECT COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS cash FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalSale: number = numOf(recvRow?.sale);
  const totalCash: number = numOf(recvRow?.cash);
  const totalReceivable: number = totalSale - totalCash;

  const custAggRows = await db.queryAll(
    `SELECT t.customer_id, c.name AS customer_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS cash, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.customer_id, c.name ORDER BY sale DESC`,
    [ownerId, sd, ed]
  );

  const lastDateMap: Record<number, string> = {};
  if (custAggRows.length > 0) {
    const cids: number[] = custAggRows.map((r) => r.customer_id as number);
    const lastRows = await db.queryAll(`SELECT customer_id, MAX(date) AS last_date FROM transactions WHERE owner_id=$1 AND customer_id = ANY($2::int[]) GROUP BY customer_id`, [ownerId, cids]);
    lastRows.forEach((r) => { lastDateMap[r.customer_id as number] = r.last_date as string; });
  }

  const top5 = custAggRows.slice(0, 5).map((r) => {
    const sale: number = numOf(r.sale);
    const cash: number = numOf(r.cash);
    const cost: number = numOf(r.cost);
    const recv: number = sale - cash;
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const lastDate: string = lastDateMap[r.customer_id as number] || '';
    const ageDays: number = daysSince(lastDate);
    return { customer_id: r.customer_id, customer_name: r.customer_name, sale, cash, receivable: recv, gm, last_date: lastDate, age_days: ageDays };
  });

  const allCustAging = await db.queryAll(
    `SELECT t.customer_id, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) AS recv, MAX(t.date) AS last_date FROM transactions t WHERE t.owner_id=$1 AND t.customer_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.customer_id HAVING COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.type='现金收入' THEN t.amount ELSE 0 END), 0) > 0`,
    [ownerId, sd, ed]
  );
  const allAging = { within30: 0, within60: 0, over60: 0 };
  allCustAging.forEach((r) => {
    const recv: number = numOf(r.recv);
    const lastDate: string = (r.last_date as string) || '';
    const ageDays: number = daysSince(lastDate);
    if (ageDays <= 30) allAging.within30 += recv;
    else if (ageDays <= 60) allAging.within60 += recv;
    else allAging.over60 += recv;
  });
  const allAgingTotal: number = allAging.within30 + allAging.within60 + allAging.over60;

  const allCust = custAggRows.map((r) => ({ name: r.customer_name as string, sale: numOf(r.sale) }));
  const grandSale: number = allCust.reduce((s, c) => s + c.sale, 0);
  allCust.sort((a, b) => b.sale - a.sale);
  let cum = 0;
  const tiers: { name: string; sale: number; tier: string }[] = [];
  allCust.forEach((c) => {
    cum += c.sale;
    const pct: number = grandSale > 0 ? cum / grandSale : 0;
    let tier: string;
    if (pct <= 0.2) tier = 'A';
    else if (pct <= 0.5) tier = 'B';
    else tier = 'C';
    tiers.push({ name: c.name, sale: c.sale, tier });
  });

  const tierSummary: Record<string, number> = { A: 0, B: 0, C: 0 };
  const tierAmounts: Record<string, number> = { A: 0, B: 0, C: 0 };
  tiers.forEach((t) => { tierSummary[t.tier]++; tierAmounts[t.tier] += t.sale; });

  return {
    kpi: { customer_count: totalCount, active_count: activeCount, total_receivable: totalReceivable },
    top5,
    aging: { buckets: allAging, total: allAgingTotal },
    tiers: { list: tiers, summary: tierSummary, amounts: tierAmounts },
  };
}

router.get('/analysis/customer', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await customerAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 商品分析（小程序） ========== */
async function productMiniAnalysis(ownerId: number, sd: string, ed: string) {
  const salesData = await productAnalysis(ownerId, 'sale', sd, ed);

  const skuRow = await db.queryOne('SELECT COUNT(*) AS cnt FROM products WHERE owner_id=$1', [ownerId]);
  const skuCount: number = Number(skuRow?.cnt) || 0;

  const invRow = await db.queryOne('SELECT COALESCE(SUM(quantity * avg_price), 0) AS v FROM inventory WHERE owner_id=$1', [ownerId]);
  const inventoryValue: number = numOf(invRow?.v);

  const topRows = await db.queryAll(
    `SELECT t.product_id, p.name AS product_name, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t JOIN products p ON p.id = t.product_id WHERE t.owner_id=$1 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3 GROUP BY t.product_id, p.name ORDER BY sale DESC LIMIT 10`,
    [ownerId, sd, ed]
  );

  const pids: number[] = topRows.map((r) => r.product_id as number);
  const stockMap: Record<number, number> = {};
  if (pids.length > 0) {
    const stockRows = await db.queryAll(`SELECT product_id, COALESCE(quantity, 0) AS qty FROM inventory WHERE owner_id=$1 AND product_id = ANY($2::int[])`, [ownerId, pids]);
    stockRows.forEach((r) => { stockMap[r.product_id as number] = Number(r.qty) || 0; });
  }

  const costAvgMap: Record<number, number> = {};
  if (pids.length > 0) {
    const avgRows = await db.queryAll(`SELECT product_id, AVG(ABS(amount)) AS avg_cost FROM transactions WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND product_id = ANY($2::int[]) GROUP BY product_id`, [ownerId, pids]);
    avgRows.forEach((r) => { costAvgMap[r.product_id as number] = Number(r.avg_cost) || 0; });
  }

  const topProducts = topRows.map((r) => {
    const sale: number = numOf(r.sale);
    const cost: number = numOf(r.cost);
    const gm: number = sale > 0 ? (sale - cost) / sale : 0;
    const stock: number = stockMap[r.product_id as number] || 0;
    const daysDiff: number = Math.max(1, Math.ceil((new Date(ed).getTime() - new Date(sd).getTime()) / 86400000));
    const dailySale: number = sale / daysDiff;
    const turnoverDays: number = dailySale > 0 ? Math.round(stock / dailySale) : 0;
    return { product_id: r.product_id, product_name: r.product_name, sale, gm, stock, turnover_days: turnoverDays };
  });

  const ALL_PRODUCTS = await db.queryAll(
    `SELECT p.id, p.name, p.warning_threshold, COALESCE(i.quantity, 0) AS stock FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.owner_id = p.owner_id WHERE p.owner_id=$1`,
    [ownerId]
  );

  const gmMap: Record<number, number> = {};
  topProducts.forEach((p) => { gmMap[p.product_id as number] = p.gm; });

  if (ALL_PRODUCTS.length > 0) {
    const allPids: number[] = ALL_PRODUCTS.map((p) => p.id as number);
    const gmRows = await db.queryAll(
      `SELECT t.product_id, COALESCE(SUM(CASE WHEN t.type='销售收入' THEN t.amount ELSE 0 END), 0) AS sale, COALESCE(SUM(CASE WHEN t.type='材料采购' THEN ABS(t.amount) ELSE 0 END), 0) AS cost FROM transactions t WHERE t.owner_id=$1 AND t.product_id = ANY($2::int[]) AND t.date BETWEEN $3 AND $4 GROUP BY t.product_id`,
      [ownerId, allPids, sd, ed]
    );
    gmRows.forEach((r) => {
      if (!gmMap[r.product_id as number]) {
        const s: number = numOf(r.sale), c: number = numOf(r.cost);
        gmMap[r.product_id as number] = s > 0 ? (s - c) / s : 0;
      }
    });
  }

  const MARGIN_THRESHOLD = 0.15;
  const alerts: Record<string, unknown>[] = [];

  ALL_PRODUCTS.forEach((p) => {
    const gm = gmMap[p.id as number];
    if (gm !== undefined && gm < MARGIN_THRESHOLD) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `毛利率 ${(gm * 100).toFixed(1)}% 跌破 ${(MARGIN_THRESHOLD * 100).toFixed(0)}%`, type: 'low_margin' });
    }
    if ((p.warning_threshold as number) > 0 && (p.stock as number) <= (p.warning_threshold as number)) {
      alerts.push({ level: 'red', product_name: p.name, product_id: p.id, reason: `库存 ${p.stock} ≤ 安全线 ${p.warning_threshold}，建议补货`, type: 'low_stock' });
    }
  });

  topProducts.forEach((p) => {
    if (p.turnover_days > 90) {
      alerts.push({ level: 'yellow', product_name: p.product_name, product_id: p.product_id, reason: `周转 ${p.turnover_days} 天，库存呆滞风险`, type: 'slow_turnover' });
    }
  });

  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  return {
    kpi: { sku_count: skuCount, inventory_value: inventoryValue, avg_gm: salesData.avg_gm },
    top_products: topProducts,
    alerts,
    alert_count: { red: alerts.filter((a) => a.level === 'red').length, yellow: alerts.filter((a) => a.level === 'yellow').length },
  };
}

router.get('/analysis/product', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await productMiniAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 合同分析 ========== */
async function contractAnalysis(ownerId: number, sd: string, ed: string) {
  const overviewRow = await db.queryOne(`SELECT COUNT(*) AS total_count, COALESCE(SUM(co.amount), 0) AS total_amount FROM contracts co WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalAmount: number = numOf(overviewRow?.total_amount);

  const statusRows = await db.queryAll(`SELECT co.status, COUNT(*) AS cnt, COALESCE(SUM(co.amount), 0) AS amt FROM contracts co WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3 GROUP BY co.status`, [ownerId, sd, ed]);
  const statusMap: Record<string, { count: number; amount: number }> = {};
  statusRows.forEach((r) => { statusMap[r.status as string] = { count: Number(r.cnt), amount: numOf(r.amt) }; });
  const inProgress = statusMap['进行中'] || { count: 0, amount: 0 };
  const completed = statusMap['已完结'] || { count: 0, amount: 0 };
  const dunning = statusMap['催收中'] || { count: 0, amount: 0 };

  const paidRow = await db.queryOne(`SELECT COALESCE(SUM(t.amount), 0) AS paid FROM transactions t WHERE t.owner_id=$1 AND t.contract_id IS NOT NULL AND t.amount > 0 AND t.date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalPaid: number = numOf(paidRow?.paid);
  const executionRate: number = totalAmount > 0 ? totalPaid / totalAmount : 0;
  const unpaidAmount: number = Math.max(0, totalAmount - totalPaid);

  const contractRows = await db.queryAll(`SELECT co.id, co.date, co.status, co.amount, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id = c.id WHERE co.owner_id=$1 AND co.date BETWEEN $2 AND $3 ORDER BY co.id DESC`, [ownerId, sd, ed]);
  const cids: number[] = contractRows.map((r) => r.id as number);

  const paidMap: Record<number, number> = {};
  if (cids.length > 0) {
    const paidRows = await db.queryAll(`SELECT contract_id, COALESCE(SUM(amount), 0) AS paid FROM transactions WHERE owner_id=$1 AND contract_id = ANY($2::int[]) AND amount > 0 AND date BETWEEN $3 AND $4 GROUP BY contract_id`, [ownerId, cids, sd, ed]);
    paidRows.forEach((r) => { paidMap[r.contract_id as number] = numOf(r.paid); });
  }

  const lastPaidMap: Record<number, string> = {};
  if (cids.length > 0) {
    const lastRows = await db.queryAll(`SELECT contract_id, MAX(date) AS last_date FROM transactions WHERE owner_id=$1 AND contract_id = ANY($2::int[]) AND amount > 0 GROUP BY contract_id`, [ownerId, cids]);
    lastRows.forEach((r) => { lastPaidMap[r.contract_id as number] = r.last_date as string; });
  }

  const contractList = contractRows.map((r) => {
    const paid: number = paidMap[r.id as number] || 0;
    const unpaid: number = Math.max(0, numOf(r.amount) - paid);
    const lastDate: string = lastPaidMap[r.id as number] || (r.date as string) || '';
    const ageDays: number = daysSince(lastDate);
    return { id: r.id, customer_name: (r.customer_name as string) || '—', date: (r.date as string) || '', amount: numOf(r.amount), paid, unpaid, status: (r.status as string) || '进行中', age_days: ageDays };
  });

  return {
    kpi: { total_amount: totalAmount, execution_rate: executionRate, unpaid_amount: unpaidAmount, status_summary: { in_progress: { count: inProgress.count, amount: inProgress.amount }, completed: { count: completed.count, amount: completed.amount }, dunning: { count: dunning.count, amount: dunning.amount } } },
    contracts: contractList,
  };
}

router.get('/analysis/contract', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await contractAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 费用分析 ========== */
async function expenseAnalysis(ownerId: number, sd: string, ed: string) {
  const composeRows = await db.queryAll(
    `SELECT t.type AS name, COALESCE(SUM(ABS(t.amount)), 0) AS amount FROM transactions t WHERE t.owner_id=$1 AND t.amount < 0 AND t.date BETWEEN $2 AND $3 GROUP BY t.type ORDER BY amount DESC`,
    [ownerId, sd, ed]
  );
  const compose = composeRows.map((r) => ({ name: r.name as string, amount: numOf(r.amount) }));
  const totalExpense: number = compose.reduce((s, r) => s + r.amount, 0);

  const trendData: { month: string; amount: number }[] = [];
  const endParts: number[] = String(ed).split('-').map(Number);
  const endYear: number = endParts[0], endMonth: number = endParts[1];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(endYear, endMonth - 1 - i, 1);
    const ms: string = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const mEndStr: string = `${mEnd.getFullYear()}-${String(mEnd.getMonth() + 1).padStart(2, '0')}-${String(mEnd.getDate()).padStart(2, '0')}`;
    const monthRow = await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS amt FROM transactions WHERE owner_id=$1 AND amount < 0 AND date BETWEEN $2 AND $3`, [ownerId, ms + '-01', mEndStr]);
    trendData.push({ month: ms, amount: numOf(monthRow?.amt) });
  }

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(ABS(t.amount)), 0) AS amount FROM transactions t WHERE t.owner_id=$1 AND t.amount < 0 AND t.date BETWEEN $2 AND $3 GROUP BY COALESCE(t.unit, '全公司') ORDER BY amount DESC`,
    [ownerId, sd, ed]
  );
  const units = unitRows.map((r) => ({ unit: r.unit as string, amount: numOf(r.amount) }));
  const unitTotal: number = units.reduce((s, r) => s + r.amount, 0);

  return { compose, total_expense: totalExpense, trend: trendData, units, unit_total: unitTotal };
}

router.get('/analysis/expense', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await expenseAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

/* ========== 阿米巴核算 ========== */
async function amoebaAnalysis(ownerId: number, sd: string, ed: string) {
  const { where: txWhere, params: txParams } = buildTxFilter(ownerId, sd, ed, null);

  const typeRows = await db.queryAll(`SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${txWhere} GROUP BY t.type`, txParams);
  const raw: Record<string, number> = {};
  const absAmt: Record<string, number> = {};
  typeRows.forEach((r) => { raw[r.type as string] = numOf(r.raw); absAmt[r.type as string] = numOf(r.abs_amt); });

  const salesIncome: number = raw['销售收入'] || 0;
  const cashIncome: number = raw['现金收入'] || 0;
  const otherIncome: number = raw['其他收入'] || 0;
  const totalIncome: number = salesIncome + cashIncome + otherIncome;
  const materialCost: number = absAmt['材料采购'] || 0;
  const processCost: number = absAmt['委托加工'] || 0;
  const consumeCost: number = materialCost + processCost;
  const miscCost: number = absAmt['杂费支出'] || 0;
  const addedValue: number = totalIncome - consumeCost - miscCost;

  const smk: string = String(sd).slice(0, 7), emk: string = String(ed).slice(0, 7);
  const salaryRow = await db.queryOne(
    `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
    [ownerId, smk, emk]
  );
  const totalSalary: number = numOf(salaryRow?.salary);
  const totalHours: number = numOf(salaryRow?.hours);

  const hourlyAddedValue: number = totalHours > 0 ? addedValue / totalHours : 0;
  const hourlyLaborCost: number = totalHours > 0 ? totalSalary / totalHours : 0;
  const breakeven: number = addedValue - totalSalary;

  const prevSd = new Date(Number(String(sd).slice(0, 4)), Number(String(sd).slice(5, 7)) - 2, 1);
  const prevEd = new Date(Number(String(ed).slice(0, 4)), Number(String(ed).slice(5, 7)) - 1, 0);
  const prevSdStr: string = `${prevSd.getFullYear()}-${String(prevSd.getMonth() + 1).padStart(2, '0')}-${String(prevSd.getDate()).padStart(2, '0')}`;
  const prevEdStr: string = `${prevEd.getFullYear()}-${String(prevEd.getMonth() + 1).padStart(2, '0')}-${String(prevEd.getDate()).padStart(2, '0')}`;

  let prevHourlyAddedValue: number | null = null;
  try {
    const prevFilter = buildTxFilter(ownerId, prevSdStr, prevEdStr, null);
    const prevTypeRows = await db.queryAll(`SELECT t.type AS type, COALESCE(SUM(t.amount), 0) AS raw, COALESCE(SUM(ABS(t.amount)), 0) AS abs_amt FROM transactions t WHERE ${prevFilter.where} GROUP BY t.type`, prevFilter.params);
    const pRaw: Record<string, number> = {};
    const pAbs: Record<string, number> = {};
    prevTypeRows.forEach((r) => { pRaw[r.type as string] = numOf(r.raw); pAbs[r.type as string] = numOf(r.abs_amt); });
    const pAdded: number = (pRaw['销售收入'] || 0) + (pRaw['现金收入'] || 0) + (pRaw['其他收入'] || 0) - ((pAbs['材料采购'] || 0) + (pAbs['委托加工'] || 0)) - (pAbs['杂费支出'] || 0);

    const pSmk: string = String(prevSdStr).slice(0, 7), pEmk: string = String(prevEdStr).slice(0, 7);
    const prevSalRow = await db.queryOne(
      `SELECT COALESCE(SUM(wh.hours * e.hourly_rate), 0) AS salary, COALESCE(SUM(wh.hours), 0) AS hours FROM work_hours wh JOIN employees e ON e.id = wh.employee_id WHERE wh.owner_id=$1 AND wh.month BETWEEN $2 AND $3 AND COALESCE(e.status, 'active') = 'active'`,
      [ownerId, pSmk, pEmk]
    );
    const prevHours: number = numOf(prevSalRow?.hours);
    if (prevHours > 0) prevHourlyAddedValue = pAdded / prevHours;
  } catch (_e: unknown) { /* 上月数据缺失不影响当期 */ }

  const unitRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC`,
    txParams
  );
  const unitValues = unitRows.map((r) => ({ unit: r.unit as string, added_value: numOf(r.added_value) }));

  const unitContribRows = await db.queryAll(
    `SELECT COALESCE(t.unit, '全公司') AS unit, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount ELSE 0 END), 0) AS sales, COALESCE(SUM(CASE WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN ABS(t.amount) ELSE 0 END), 0) AS expense, COALESCE(SUM(CASE WHEN t.type IN ('销售收入','现金收入','其他收入') THEN t.amount WHEN t.type IN ('材料采购','委托加工','杂费支出') THEN -ABS(t.amount) ELSE 0 END), 0) AS added_value FROM transactions t WHERE ${txWhere} GROUP BY COALESCE(t.unit, '全公司') ORDER BY added_value DESC`,
    txParams
  );
  const unitContribs = unitContribRows.map((r) => ({ unit: r.unit as string, sales: numOf(r.sales), expense: numOf(r.expense), added_value: numOf(r.added_value), hours: null, hourly_value: null }));

  return {
    kpi: { added_value: addedValue, total_hours: totalHours, hourly_labor_cost: hourlyLaborCost, breakeven: breakeven },
    hourly_added_value: hourlyAddedValue,
    prev_hourly_added_value: prevHourlyAddedValue,
    unit_values: unitValues,
    unit_contribs: unitContribs,
    unit_hours_available: false,
  };
}

router.get('/analysis/amoeba', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    const sd: string = startDate || '0001-01-01', ed: string = endDate || '9999-12-31';
    ok(res, await amoebaAnalysis(req.user!.id, sd, ed));
  } catch (e: unknown) { fail400(res, (e as Error).message); }
});

export = router;
