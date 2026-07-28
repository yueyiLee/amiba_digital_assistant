/**
 * routes/index.js — 业务 API 路由汇总（11 个模块，PostgreSQL 版，多租户账号隔离）
 * 所有业务接口均需 requireAuth 认证，全部按 req.user.id(owner_id) 隔离。
 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ok = (res, data) => res.json(data);
const fail400 = (res, msg) => res.status(400).json({ error: msg });
const fail404 = (res, msg) => res.status(404).json({ error: msg });

/* ========== 1. transactions 收支流水 ========== */
router.get('/transactions', async (req, res) => {
  try {
    const { unit, type, startDate, endDate } = req.query;
    let sql = 'SELECT t.*, c.name AS customer_name, p.name AS product_name FROM transactions t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN products p ON t.product_id=p.id WHERE t.owner_id=$1';
    const params = [req.user.id];
    let pi = 1;
    if (unit && unit !== '全部单元') { params.push(unit); sql += ` AND t.unit=$${++pi}`; }
    if (type) { params.push(type); sql += ` AND t.type=$${++pi}`; }
    if (startDate) { params.push(startDate); sql += ` AND t.date>=$${++pi}`; }
    if (endDate) { params.push(endDate); sql += ` AND t.date<=$${++pi}`; }
    sql += ' ORDER BY t.date DESC, t.id DESC';
    const rows = await db.queryAll(sql, params);
    // 注入关联合同的拼接名（日期-客户[-商品等]）
    const cids = [...new Set(rows.map(r => r.contract_id).filter(Boolean))];
    const nameMap = {};
    if (cids.length) {
      const cons = await db.queryAll(`SELECT co.id, co.date, co.direction, cu.name AS customer_name,
        (SELECT COALESCE(string_agg(p.name, ','), '') FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id=co.id) AS prod_names,
        (SELECT COALESCE(string_agg(cs.service_name, ','), '') FROM contract_services cs WHERE cs.contract_id=co.id) AS svc_names
        FROM contracts co LEFT JOIN customers cu ON co.customer_id=cu.id WHERE co.id = ANY($1)`, [cids]);
      cons.forEach(co => {
        const names = [];
        if (co.prod_names) co.prod_names.split(',').forEach(n => n && names.push(n));
        if (co.svc_names) co.svc_names.split(',').forEach(n => n && names.push(n));
        const d = co.date || '';
        const display_name = names.length
          ? `${d}-${co.customer_name || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
          : `${d}-${co.customer_name || '—'}`;
        nameMap[co.id] = { display_name, direction: co.direction };
      });
    }
    const out = rows.map(r => ({
      ...r,
      contract_display_name: r.contract_id ? (nameMap[r.contract_id] ? nameMap[r.contract_id].display_name : null) : null,
      contract_direction: r.contract_id ? (nameMap[r.contract_id] ? nameMap[r.contract_id].direction : null) : null
    }));
    ok(res, out);
  } catch (e) { fail400(res, e.message); }
});

router.post('/transactions', async (req, res) => {
  try {
    const { amount, type, unit, date, customer_id, product_id, note, category, contract_id } = req.body || {};
    if (amount == null || !type || !date) return fail400(res, '缺少必要字段（金额/类型/日期）');
    // 归属校验：客户/商品/合同必须是当前账号自己的，杜绝跨账号引用泄露
    if (customer_id) {
      const c = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [customer_id, req.user.id]);
      if (!c) return fail400(res, '客户不存在或无权访问');
    }
    if (product_id) {
      const p = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [product_id, req.user.id]);
      if (!p) return fail400(res, '商品不存在或无权访问');
    }
    if (contract_id) {
      const co = await db.queryOne('SELECT 1 FROM contracts WHERE id=$1 AND owner_id=$2', [contract_id, req.user.id]);
      if (!co) return fail400(res, '合同不存在或无权访问');
    }
    const result = await db.insertReturning(
      'INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,category,contract_id,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [amount, type, unit || '全公司', customer_id || null, product_id || null, date, note || '', category || '', contract_id || null, req.user.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/transactions/:id', async (req, res) => {
  try {
    const t = req.body || {};
    const old = await db.queryOne('SELECT * FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '记录不存在');
    // 归属校验：客户/商品/合同必须是当前账号自己的
    if (t.customer_id) {
      const c = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [t.customer_id, req.user.id]);
      if (!c) return fail400(res, '客户不存在或无权访问');
    }
    if (t.product_id) {
      const p = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [t.product_id, req.user.id]);
      if (!p) return fail400(res, '商品不存在或无权访问');
    }
    if (t.contract_id) {
      const co = await db.queryOne('SELECT 1 FROM contracts WHERE id=$1 AND owner_id=$2', [t.contract_id, req.user.id]);
      if (!co) return fail400(res, '合同不存在或无权访问');
    }
    const newContract = t.contract_id === undefined ? old.contract_id : (t.contract_id || null);
    await db.query(
      'UPDATE transactions SET amount=$1,type=$2,unit=$3,customer_id=$4,product_id=$5,date=$6,note=$7,category=$8,contract_id=$9 WHERE id=$10 AND owner_id=$11',
      [t.amount ?? old.amount, t.type ?? old.type, t.unit ?? old.unit,
       t.customer_id === undefined ? old.customer_id : (t.customer_id || null),
       t.product_id === undefined ? old.product_id : (t.product_id || null),
       t.date ?? old.date, t.note ?? old.note,
       t.category === undefined ? old.category : (t.category || ''),
       newContract, req.params.id, req.user.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 1b. expense_items 支出项预设（委托加工/杂费，账号隔离，支持前台配置） ========== */
router.get('/expense-items', async (req, res) => {
  try {
    const rows = await db.queryAll('SELECT id, kind, name, note FROM expense_items WHERE owner_id=$1 ORDER BY id', [req.user.id]);
    ok(res, rows);
  } catch (e) { fail400(res, e.message); }
});

router.post('/expense-items', async (req, res) => {
  try {
    const { kind, name, note } = req.body || {};
    if (!kind || !name || !String(name).trim()) return fail400(res, '缺少必要字段（类型/名称）');
    const nm = String(name).trim();
    const nt = note == null ? '' : String(note).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_items WHERE owner_id=$1 AND kind=$2 AND name=$3', [req.user.id, kind, nm]);
    if (dup) return fail400(res, '该类别已存在');
    const result = await db.insertReturning(
      'INSERT INTO expense_items(owner_id,kind,name,note) VALUES($1,$2,$3,$4) RETURNING id',
      [req.user.id, kind, nm, nt]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/expense-items/:id', async (req, res) => {
  try {
    const { name, note } = req.body || {};
    if (!name || !String(name).trim()) return fail400(res, '名称必填');
    const old = await db.queryOne('SELECT * FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '类别不存在');
    const nm = String(name).trim();
    const nt = note == null ? '' : String(note).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_items WHERE owner_id=$1 AND kind=$2 AND name=$3 AND id<>$4', [req.user.id, old.kind, nm, req.params.id]);
    if (dup) return fail400(res, '该类别已存在');
    await db.query('UPDATE expense_items SET name=$1, note=$2 WHERE id=$3 AND owner_id=$4', [nm, nt, req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/expense-items/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '类别不存在');
    await db.query('DELETE FROM expense_items WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 1c. expense_types 收支类型（可配置：方向/联动/启停，账号隔离） ========== */
router.get('/expense-types', async (req, res) => {
  try {
    const { direction, enabled } = req.query;
    let sql = 'SELECT id, name, direction, link_customer, link_product, link_cat, enabled FROM expense_types WHERE owner_id=$1';
    const params = [req.user.id];
    if (direction) { params.push(direction); sql += ` AND direction=$${params.length}`; }
    if (enabled === 'true') { params.push(true); sql += ` AND enabled=$${params.length}`; }
    sql += ' ORDER BY direction, id';
    const rows = await db.queryAll(sql, params);
    ok(res, rows);
  } catch (e) { fail400(res, e.message); }
});

router.post('/expense-types', async (req, res) => {
  try {
    const { name, direction, link_customer, link_product, link_cat } = req.body || {};
    if (!name || !String(name).trim()) return fail400(res, '类型名称必填');
    if (direction !== 'income' && direction !== 'expense') return fail400(res, '方向必须是 income 或 expense');
    const nm = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM expense_types WHERE owner_id=$1 AND name=$2 AND direction=$3', [req.user.id, nm, direction]);
    if (dup) return fail400(res, '该方向下已存在同名类型');
    const result = await db.insertReturning(
      'INSERT INTO expense_types(owner_id,name,direction,link_customer,link_product,link_cat,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.user.id, nm, direction, !!link_customer, !!link_product, link_cat || '', true]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/expense-types/:id', async (req, res) => {
  try {
    const { name, direction, link_customer, link_product, link_cat, enabled } = req.body || {};
    if (!name || !String(name).trim()) return fail400(res, '类型名称必填');
    const old = await db.queryOne('SELECT * FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '类型不存在');
    const nm = String(name).trim();
    const dir = direction || old.direction;
    if (dir !== 'income' && dir !== 'expense') return fail400(res, '方向必须是 income 或 expense');
    const dup = await db.queryOne('SELECT 1 FROM expense_types WHERE owner_id=$1 AND name=$2 AND direction=$3 AND id<>$4', [req.user.id, nm, dir, req.params.id]);
    if (dup) return fail400(res, '该方向下已存在同名类型');
    await db.query(
      'UPDATE expense_types SET name=$1, direction=$2, link_customer=$3, link_product=$4, link_cat=$5, enabled=$6 WHERE id=$7 AND owner_id=$8',
      [nm, dir, !!link_customer, !!link_product, link_cat || '', !!enabled, req.params.id, req.user.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/expense-types/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '类型不存在');
    await db.query('DELETE FROM expense_types WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '记录不存在');
    await db.query('DELETE FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 2. products 商品 ========== */
router.get('/products', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM products WHERE owner_id=$1 ORDER BY id DESC', [req.user.id])); }
  catch (e) { fail400(res, e.message); }
});

router.post('/products', async (req, res) => {
  try {
    const { name, brand, unit, category1, category2, purchase_price, sale_price } = req.body || {};
    if (!name || !category1) return fail400(res, '缺少必要字段（名称/一级分类）');
    const result = await db.insertReturning(
      'INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [name, brand || '', unit || '件', category1, category2 || '', purchase_price || 0, sale_price || 0, req.user.id]
    );
    const newId = result.rows[0].id;
    await db.query('INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4)', [newId, 0, purchase_price || 0, req.user.id]);
    ok(res, { id: newId });
  } catch (e) { fail400(res, e.message); }
});

router.put('/products/:id', async (req, res) => {
  try {
    const p = req.body || {};
    const old = await db.queryOne('SELECT * FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '商品不存在');
    await db.query(
      'UPDATE products SET name=$1,brand=$2,unit=$3,category1=$4,category2=$5,purchase_price=$6,sale_price=$7 WHERE id=$8 AND owner_id=$9',
      [p.name ?? old.name, p.brand ?? old.brand, p.unit ?? old.unit, p.category1 ?? old.category1,
       p.category2 ?? old.category2, p.purchase_price ?? old.purchase_price, p.sale_price ?? old.sale_price, req.params.id, req.user.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '商品不存在');
    await db.query('DELETE FROM products WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 3. customers 客户 ========== */
router.get('/customers', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM customers WHERE owner_id=$1 ORDER BY id DESC', [req.user.id])); }
  catch (e) { fail400(res, e.message); }
});

router.post('/customers', async (req, res) => {
  try {
    const { name, type, contact, address } = req.body || {};
    if (!name) return fail400(res, '客户名称必填');
    if (!type) return fail400(res, '客户类型必选');
    const result = await db.insertReturning(
      'INSERT INTO customers(name,type,contact,address,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [name, type, contact || '', address || '', req.user.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/customers/:id', async (req, res) => {
  try {
    const c = req.body || {};
    const old = await db.queryOne('SELECT * FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '客户不存在');
    await db.query('UPDATE customers SET name=$1,type=$2,contact=$3,address=$4 WHERE id=$5 AND owner_id=$6',
      [c.name ?? old.name, c.type ?? old.type, c.contact ?? old.contact, c.address ?? old.address, req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '客户不存在');
    await db.query('DELETE FROM customers WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 4. inventory 库存 ========== */
router.get('/inventory', async (req, res) => {
  try {
    ok(res, await db.queryAll(
      `SELECT i.*, p.name AS product_name, p.category1, p.category2, p.purchase_price, p.sale_price
       FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.owner_id=$1 ORDER BY i.id`,
      [req.user.id]
    ));
  } catch (e) { fail400(res, e.message); }
});

// 手动添加/更新库存：按 (product_id, owner_id) upsert（同一商品仅一条库存记录）
router.post('/inventory', async (req, res) => {
  try {
    const { product_id, quantity, avg_price } = req.body || {};
    if (!product_id) return fail400(res, '请选择商品');
    if (quantity == null) return fail400(res, '缺少库存数量');
    const prod = await db.queryOne('SELECT id FROM products WHERE id=$1 AND owner_id=$2', [product_id, req.user.id]);
    if (!prod) return fail404(res, '商品不存在');
    const exist = await db.queryOne('SELECT id FROM inventory WHERE product_id=$1 AND owner_id=$2', [product_id, req.user.id]);
    if (exist) {
      await db.query('UPDATE inventory SET quantity=$1, avg_price=$2, updated_at=NOW() WHERE id=$3 AND owner_id=$4',
        [quantity, avg_price ?? 0, exist.id, req.user.id]);
      ok(res, { id: exist.id, updated: true });
    } else {
      const r = await db.insertReturning(
        'INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4) RETURNING id',
        [product_id, quantity, avg_price ?? 0, req.user.id]
      );
      ok(res, { id: r.rows[0].id });
    }
  } catch (e) { fail400(res, e.message); }
});

router.put('/inventory/:id', async (req, res) => {
  try {
    const { quantity, avg_price } = req.body || {};
    if (quantity == null) return fail400(res, '缺少库存数量');
    const old = await db.queryOne('SELECT * FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '库存记录不存在');
    await db.query('UPDATE inventory SET quantity=$1, avg_price=$2, updated_at=NOW() WHERE id=$3 AND owner_id=$4',
      [quantity, avg_price ?? old.avg_price, req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/inventory/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '库存记录不存在');
    await db.query('DELETE FROM inventory WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 5. settings 设置（每账号独立） ========== */
router.get('/settings', async (req, res) => {
  try {
    const rows = await db.queryAll('SELECT key, value FROM settings WHERE owner_id=$1', [req.user.id]);
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    ok(res, obj);
  } catch (e) { fail400(res, e.message); }
});

router.put('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    for (const [k, v] of Object.entries(body)) {
      await db.query(
        'INSERT INTO settings(owner_id, key, value) VALUES($1,$2,$3) ON CONFLICT(owner_id, key) DO UPDATE SET value=excluded.value',
        [req.user.id, k, typeof v === 'object' ? JSON.stringify(v) : String(v)]
      );
    }
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 6. categories 分类预设（每账号独立） ========== */
router.get('/categories', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM categories WHERE owner_id=$1 ORDER BY id', [req.user.id])); }
  catch (e) { fail400(res, e.message); }
});

/* ========== 7. employees 员工 ========== */
router.get('/employees', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM employees WHERE owner_id=$1 ORDER BY id DESC', [req.user.id])); }
  catch (e) { fail400(res, e.message); }
});

router.post('/employees', async (req, res) => {
  try {
    const { name, position, hourly_rate, join_date, status, leave_date } = req.body || {};
    if (!name) return fail400(res, '姓名必填');
    if (hourly_rate == null || hourly_rate <= 0) return fail400(res, '时薪必须大于 0');
    const result = await db.insertReturning(
      'INSERT INTO employees(name,position,hourly_rate,join_date,status,leave_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, position || '', hourly_rate, join_date || '', status || 'active', leave_date || '', req.user.id]
    );
    const newId = result.rows[0].id;
    // 写入「入职」状态变更记录（含变更后岗位/时薪快照）
    const today = new Date().toISOString().slice(0, 10);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId, 'active', '入职', position || '', hourly_rate || 0, join_date || today, '新增入职', req.user.id]
    );
    ok(res, { id: newId });
  } catch (e) { fail400(res, e.message); }
});

router.put('/employees/:id', async (req, res) => {
  try {
    const e = req.body || {};
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '员工不存在');
    // 状态变更必须通过 PATCH /status 单独处理，此处仅更新基础属性
    await db.query('UPDATE employees SET name=$1,position=$2,hourly_rate=$3,join_date=$4,leave_date=$5 WHERE id=$6 AND owner_id=$7',
      [e.name ?? old.name, e.position ?? old.position, e.hourly_rate ?? old.hourly_rate, e.join_date ?? old.join_date, e.leave_date ?? old.leave_date ?? '', req.params.id, req.user.id]);
    // 同步刷新「最近一条在岗状态记录」的岗位/时薪/变更登记日期快照，使员工信息页与工时页展示信息与历史绑定
    const needUpdateHistory = e.position !== undefined || e.hourly_rate !== undefined || e.join_date !== undefined;
    if (needUpdateHistory) {
      await db.query(
        `UPDATE employee_status_history h
         SET position = COALESCE($1, h.position), hourly_rate = COALESCE($2, h.hourly_rate), changed_date = COALESCE($3, h.changed_date)
         WHERE h.id = (
           SELECT id FROM employee_status_history
           WHERE employee_id=$4 AND owner_id=$5 AND status='active'
           ORDER BY changed_date DESC, id DESC LIMIT 1
         )`,
        [e.position !== undefined ? (e.position || '') : null,
         e.hourly_rate !== undefined ? (e.hourly_rate || 0) : null,
         e.join_date !== undefined ? (e.join_date || '') : null,
         Number(req.params.id), req.user.id]
      );
    }
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

// 状态变更历史：为离职/复职提供可追溯的时间线，支撑按月在岗判断
router.get('/employees/:id/status-history', async (req, res) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 ORDER BY changed_date ASC, id ASC',
      [req.params.id, req.user.id]
    );
    ok(res, rows);
  } catch (e) { fail400(res, e.message); }
});

// 全量状态历史：前端缓存层一次性拉取当前账号下所有员工的状态变更
router.get('/employee-status-history-all', async (req, res) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE owner_id=$1 ORDER BY employee_id ASC, changed_date ASC, id ASC',
      [req.user.id]
    );
    ok(res, rows);
  } catch (e) { fail400(res, e.message); }
});

// 标记离职 / 复职（软状态切换，不删除数据，历史工时与工资保留）
router.patch('/employees/:id/status', async (req, res) => {
  try {
    const { status, leave_date, note, position, hourly_rate, changed_date } = req.body || {};
    if (!status || !['active', 'left'].includes(status)) return fail400(res, 'status 必须是 active 或 left');
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '员工不存在');
    const today = new Date().toISOString().slice(0, 10);
    const changedDate = status === 'left'
      ? (leave_date || changed_date || old.leave_date || today)
      : (changed_date || today);
    const newLeave = status === 'left' ? changedDate : '';
    // change_type：由旧状态推导（active→left 为离职；left→active 为复职）
    const changeType = (old.status || 'active') === 'left' ? '复职' : '离职';
    // 岗位/时薪快照：优先用请求体（编辑弹窗提交的最新值），否则用员工当前值
    const snapPos = (position !== undefined && position !== null) ? position : (old.position || '');
    const snapRate = (hourly_rate !== undefined && hourly_rate !== null) ? hourly_rate : (old.hourly_rate || 0);

    // 幂等补全：该员工首次变更时，先补一条从入职日期开始的 active 记录，确保后续可按月在岗判断完整
    const hasHistory = await db.queryOne('SELECT 1 FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 LIMIT 1', [req.params.id, req.user.id]);
    if (!hasHistory) {
      const startDate = old.join_date || changedDate;
      await db.query(
        'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.params.id, 'active', '入职', old.position || '', old.hourly_rate || 0, startDate, '系统自动补全入职状态', req.user.id]
      );
    }

    await db.query('UPDATE employees SET status=$1, leave_date=$2 WHERE id=$3 AND owner_id=$4',
      [status, newLeave, req.params.id, req.user.id]);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id, status, changeType, status === 'left' ? '' : snapPos, status === 'left' ? 0 : snapRate, changedDate, note || '', req.user.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/employees/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '员工不存在');
    await db.query('DELETE FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 8. contracts 合同（含商品明细 / 服务费明细，拼接合同名） ========== */
router.get('/contracts', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT co.*, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id WHERE co.owner_id=$1 ORDER BY co.id DESC`,
      [req.user.id]
    );
    const ids = rows.map(r => r.id);
    let itemsMap = {}, svcMap = {};
    if (ids.length) {
      const inSql = ids.map((_, i) => `$${i + 1}`).join(',');
      const items = await db.queryAll(
        `SELECT ci.*, p.name AS product_name FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id IN (${inSql}) AND ci.owner_id=$${ids.length + 1}`,
        [...ids, req.user.id]
      );
      const svcs = await db.queryAll(
        `SELECT cs.* FROM contract_services cs WHERE cs.contract_id IN (${inSql}) AND cs.owner_id=$${ids.length + 1}`,
        [...ids, req.user.id]
      );
      items.forEach(it => { (itemsMap[it.contract_id] = itemsMap[it.contract_id] || []).push(it); });
      svcs.forEach(s => { (svcMap[s.contract_id] = svcMap[s.contract_id] || []).push(s); });
    }
    const out = rows.map(r => {
      const its = itemsMap[r.id] || [];
      const svs = svcMap[r.id] || [];
      const names = [...its.map(i => i.product_name || '未命名商品'), ...svs.map(s => s.service_name || '未命名服务')];
      const date = r.date || r.start_date || '';
      const displayName = names.length
        ? `${date}-${r.customer_name || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${date}-${r.customer_name || '—'}`;
      const detailAmount = its.reduce((s, i) => s + (Number(i.amount) || 0), 0) + svs.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return { ...r, items: its, services: svs, display_name: displayName, amount: (its.length || svs.length) ? detailAmount : (Number(r.amount) || 0) };
    });
    ok(res, out);
  } catch (e) { fail400(res, e.message); }
});

router.post('/contracts', async (req, res) => {
  try {
    const { customer_id, date, direction, status, start_date, end_date, note, items, services } = req.body || {};
    if (!customer_id) return fail400(res, '请选择客户');
    const cust = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [customer_id, req.user.id]);
    if (!cust) return fail400(res, '客户不存在或无权访问');
    const dir = direction === 'purchase' ? 'purchase' : 'sale';
    const useDate = date || start_date || '';
    const result = await db.insertReturning(
      'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,note,date,direction,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      ['', customer_id, 0, status || '进行中', start_date || '', end_date || '', note || '', useDate, dir, req.user.id]
    );
    const cid = result.rows[0].id;
    let total = 0;
    // 商品明细
    for (const it of (Array.isArray(items) ? items : [])) {
      const pid = Number(it.product_id);
      if (!pid) continue;
      const qty = Number(it.quantity) || 0;
      const price = Number(it.actual_price) || 0;
      const amt = Number((qty * price).toFixed(2));
      const pr = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [pid, req.user.id]);
      if (!pr) continue; // 归属校验：跳过非本账号商品
      await db.query(
        'INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) VALUES($1,$2,$3,$4,$5,$6)',
        [cid, pid, qty, price, amt, req.user.id]
      );
      total += amt;
    }
    // 服务费明细（service_id 可选：手动填 service_name 也允许）
    for (const sv of (Array.isArray(services) ? services : [])) {
      const sid = sv.service_id ? Number(sv.service_id) : null;
      const sname = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt = Number(sv.amount) || 0;
      if (sid) {
        const sr = await db.queryOne('SELECT 1 FROM services WHERE id=$1 AND owner_id=$2', [sid, req.user.id]);
        if (!sr) continue;
      }
      await db.query(
        'INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
        [cid, sid, sname, samt, req.user.id]
      );
      total += samt;
    }
    await db.query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number(total.toFixed(2)), cid]);
    ok(res, { id: cid });
  } catch (e) { fail400(res, e.message); }
});

router.put('/contracts/:id', async (req, res) => {
  try {
    const c = req.body || {};
    const old = await db.queryOne('SELECT * FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '合同不存在');
    if (c.customer_id && c.customer_id !== old.customer_id) {
      const cust2 = await db.queryOne('SELECT 1 FROM customers WHERE id=$1 AND owner_id=$2', [c.customer_id, req.user.id]);
      if (!cust2) return fail400(res, '客户不存在或无权访问');
    }
    const dir = c.direction === 'purchase' ? 'purchase' : (c.direction === 'sale' ? 'sale' : (old.direction || 'sale'));
    const useDate = c.date !== undefined ? (c.date || old.start_date || '') : (old.date || '');
    await db.query(
      'UPDATE contracts SET customer_id=$1,status=$2,start_date=$3,end_date=$4,note=$5,date=$6,direction=$7 WHERE id=$8 AND owner_id=$9',
      [c.customer_id ?? old.customer_id, c.status ?? old.status, c.start_date ?? old.start_date,
       c.end_date ?? old.end_date, c.note ?? old.note, useDate, dir, req.params.id, req.user.id]
    );
    // 全量替换明细（幂等：先删后插）
    const cid = Number(req.params.id);
    await db.query('DELETE FROM contract_items WHERE contract_id=$1 AND owner_id=$2', [cid, req.user.id]);
    await db.query('DELETE FROM contract_services WHERE contract_id=$1 AND owner_id=$2', [cid, req.user.id]);
    let total = 0;
    for (const it of (Array.isArray(c.items) ? c.items : [])) {
      const pid = Number(it.product_id);
      if (!pid) continue;
      const qty = Number(it.quantity) || 0;
      const price = Number(it.actual_price) || 0;
      const amt = Number((qty * price).toFixed(2));
      const pr = await db.queryOne('SELECT 1 FROM products WHERE id=$1 AND owner_id=$2', [pid, req.user.id]);
      if (!pr) continue;
      await db.query('INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) VALUES($1,$2,$3,$4,$5,$6)',
        [cid, pid, qty, price, amt, req.user.id]);
      total += amt;
    }
    for (const sv of (Array.isArray(c.services) ? c.services : [])) {
      const sid = sv.service_id ? Number(sv.service_id) : null;
      const sname = String(sv.service_name || '').trim() || (sid ? '' : '服务费');
      const samt = Number(sv.amount) || 0;
      if (sid) {
        const sr = await db.queryOne('SELECT 1 FROM services WHERE id=$1 AND owner_id=$2', [sid, req.user.id]);
        if (!sr) continue;
      }
      await db.query('INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
        [cid, sid, sname, samt, req.user.id]);
      total += samt;
    }
    await db.query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number(total.toFixed(2)), cid]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/contracts/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '合同不存在');
    await db.query('DELETE FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 8b. services 服务（与杂费类别 expense_items 独立，勿混用） ========== */
router.get('/services', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = 'SELECT id, name, reference_cost, note FROM services WHERE owner_id=$1';
    const params = [req.user.id];
    if (q) { params.push('%' + q + '%'); sql += ` AND name ILIKE $${params.length}`; }
    sql += ' ORDER BY id DESC';
    ok(res, await db.queryAll(sql, params));
  } catch (e) { fail400(res, e.message); }
});

router.post('/services', async (req, res) => {
  try {
    const { name, reference_cost, note } = req.body || {};
    if (!name || !String(name).trim()) return fail400(res, '服务名称必填');
    const nm = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM services WHERE owner_id=$1 AND name=$2', [req.user.id, nm]);
    if (dup) return fail400(res, '该服务已存在');
    const result = await db.insertReturning(
      'INSERT INTO services(owner_id,name,reference_cost,note) VALUES($1,$2,$3,$4) RETURNING id',
      [req.user.id, nm, Number(reference_cost) || 0, note ? String(note).trim() : '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/services/:id', async (req, res) => {
  try {
    const { name, reference_cost, note } = req.body || {};
    if (!name || !String(name).trim()) return fail400(res, '服务名称必填');
    const old = await db.queryOne('SELECT * FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '服务不存在');
    const nm = String(name).trim();
    const dup = await db.queryOne('SELECT 1 FROM services WHERE owner_id=$1 AND name=$2 AND id<>$3', [req.user.id, nm, req.params.id]);
    if (dup) return fail400(res, '该服务已存在');
    await db.query('UPDATE services SET name=$1, reference_cost=$2, note=$3 WHERE id=$4 AND owner_id=$5',
      [nm, Number(reference_cost) || 0, note ? String(note).trim() : '', req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '服务不存在');
    await db.query('DELETE FROM services WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 9. workhours 月度工时（upsert） ========== */
router.get('/workhours', async (req, res) => {
  try {
    const { month } = req.query;
    let sql = 'SELECT wh.*, e.name AS employee_name, e.hourly_rate FROM work_hours wh JOIN employees e ON wh.employee_id=e.id WHERE wh.owner_id=$1';
    const params = [req.user.id];
    if (month) { sql += ' AND wh.month=$2'; params.push(month); }
    ok(res, await db.queryAll(sql, params));
  } catch (e) { fail400(res, e.message); }
});

router.post('/workhours', async (req, res) => {
  try {
    const { employee_id, hours, month } = req.body || {};
    if (!employee_id || hours == null || !month) return fail400(res, '员工、工时、月份必填');
    if (hours < 0) return fail400(res, '工时必须为有效正数');
    const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id, req.user.id]);
    if (!emp) return fail404(res, '员工不存在');
    await db.query(
      `INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(employee_id,month) DO UPDATE SET hours=excluded.hours`,
      [employee_id, hours, month, req.user.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/workhours/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '工时记录不存在');
    await db.query('DELETE FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 10. salaries 工资 ========== */
router.get('/salaries', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM salaries WHERE owner_id=$1 ORDER BY id DESC', [req.user.id])); }
  catch (e) { fail400(res, e.message); }
});

router.post('/salaries', async (req, res) => {
  try {
    const { employee_id, amount, month } = req.body || {};
    if (employee_id) {
      const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id, req.user.id]);
      if (!emp) return fail404(res, '员工不存在');
    }
    const result = await db.insertReturning(
      'INSERT INTO salaries(employee_id,amount,month,owner_id) VALUES($1,$2,$3,$4) RETURNING id',
      [employee_id, amount || 0, month || '', req.user.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/salaries/:id', async (req, res) => {
  try {
    const exist = await db.queryOne('SELECT id FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!exist) return fail404(res, '工资记录不存在');
    await db.query('DELETE FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 11. init 重置当前账号示例数据 ========== */
router.post('/init/sample', async (req, res) => {
  try {
    const uid = req.user.id;
    // 清空当前用户的业务数据（子表先于父表）
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
    // 重新生成完整示例
    await db.seedForUser(uid, 'full');
    ok(res, { success: true, message: '示例数据已重置' });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 8b. 候选合同推荐（一键补关联） ========== */
router.get('/contracts/suggest', async (req, res) => {
  try {
    const { direction, customer_id, date } = req.query; // direction: 'sale' | 'purchase'
    let sql = `SELECT co.id, co.date, co.direction, c.name AS customer_name,
      (SELECT COALESCE(string_agg(p.name, ','), '') FROM contract_items ci LEFT JOIN products p ON ci.product_id=p.id WHERE ci.contract_id=co.id) AS prod_names,
      (SELECT COALESCE(string_agg(cs.service_name, ','), '') FROM contract_services cs WHERE cs.contract_id=co.id) AS svc_names
      FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id WHERE co.owner_id=$1`;
    const params = [req.user.id];
    let pi = 1;
    if (direction) { params.push(direction); sql += ` AND co.direction=$${++pi}`; }
    if (customer_id) { params.push(customer_id); sql += ` AND co.customer_id=$${++pi}`; }
    sql += ' ORDER BY co.id DESC';
    const rows = await db.queryAll(sql, params);
    const list = rows.map(co => {
      const names = [];
      if (co.prod_names) co.prod_names.split(',').forEach(n => n && names.push(n));
      if (co.svc_names) co.svc_names.split(',').forEach(n => n && names.push(n));
      const d = co.date || '';
      const display_name = names.length
        ? `${d}-${co.customer_name || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${d}-${co.customer_name || '—'}`;
      return { id: co.id, display_name, date: d, direction: co.direction, customer_name: co.customer_name };
    });
    // 日期相近排序（客户已通过 SQL 过滤优先）
    if (date) {
      list.forEach(x => {
        const diff = Math.abs((new Date(x.date) - new Date(date)) / 86400000);
        x._diff = isNaN(diff) ? 9999 : diff;
      });
      list.sort((a, b) => a._diff - b._diff);
    }
    ok(res, list);
  } catch (e) { fail400(res, e.message); }
});

/* ========== 8c. 商品分析聚合（收入类 / 支出类，基于 contract_items） ========== */
async function productAnalysis(ownerId, direction, sd, ed) {
  const isSale = direction === 'sale';
  // 1) 总额走 transactions（合同可能未补全，但收支记录一定有）。
  //    销售：type='销售收入' AND amount>0；
  //    采购：type='材料采购' AND amount<0（用 abs 累加）。
  //    不强制 product_id：历史录入的销售收入可能没填商品，但金额依然要计入"销售总额"。
  const totalAmtRow = isSale
    ? await db.queryOne(`SELECT COALESCE(SUM(amount), 0) AS s FROM transactions
        WHERE owner_id=$1 AND type='销售收入' AND amount>0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed])
    : await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM transactions
        WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalAmount = Number(totalAmtRow && totalAmtRow.s) || 0;

  // 2) 按商品聚合金额（TOP5 来源）——只聚合"已选商品"的交易
  const byAmtRows = isSale
    ? await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(t.amount) AS amt
        FROM transactions t LEFT JOIN products p ON t.product_id = p.id
        WHERE t.owner_id=$1 AND t.type='销售收入' AND t.amount>0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3
        GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed])
    : await db.queryAll(`SELECT t.product_id, p.name AS product_name, SUM(ABS(t.amount)) AS amt
        FROM transactions t LEFT JOIN products p ON t.product_id = p.id
        WHERE t.owner_id=$1 AND t.type='材料采购' AND t.amount<0 AND t.product_id IS NOT NULL AND t.date BETWEEN $2 AND $3
        GROUP BY t.product_id, p.name ORDER BY amt DESC LIMIT 100`, [ownerId, sd, ed]);

  // 3) 数量、价格变动仍走合同（因为 transactions 没有 quantity 字段）
  const qtyRows = await db.queryAll(`SELECT ci.product_id, p.name AS product_name,
      SUM(ci.quantity) AS qty, SUM(ci.quantity * ci.actual_price) AS amt
      FROM contract_items ci
      JOIN contracts co ON ci.contract_id = co.id
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4
      GROUP BY ci.product_id, p.name ORDER BY amt DESC`, [ownerId, direction, sd, ed]);

  const series = await db.queryAll(`SELECT ci.product_id, p.name AS product_name, co.date, ci.actual_price
      FROM contract_items ci
      JOIN contracts co ON ci.contract_id = co.id
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE co.owner_id=$1 AND co.direction=$2 AND co.date BETWEEN $3 AND $4
      ORDER BY ci.product_id, co.date`, [ownerId, direction, sd, ed]);
  const byPid = {};
  series.forEach(s => { (byPid[s.product_id] = byPid[s.product_id] || []).push({ date: s.date, price: Number(s.actual_price) || 0, name: s.product_name }); });
  const priceChange = Object.values(byPid).map(arr => {
    const prices = arr.map(x => x.price).filter(v => v > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices), max = Math.max(...prices);
    const change = min > 0 ? (max - min) / min : 0;
    return { product_name: arr[0].name, change, min, max, samples: arr.length };
  }).filter(Boolean).sort((a, b) => b.change - a.change).slice(0, 5);

  // 4) 成本/毛利率：销售类的"对应成本"=同期材料采购 abs(amount)（不强制商品）
  //    采购类的 total_cost 即为自身
  const costRow = await db.queryOne(`SELECT COALESCE(SUM(ABS(amount)), 0) AS c FROM transactions
      WHERE owner_id=$1 AND type='材料采购' AND amount<0 AND date BETWEEN $2 AND $3`, [ownerId, sd, ed]);
  const totalCost = Number(costRow && costRow.c) || 0;
  const totalQty = qtyRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const avgGm = isSale && totalAmount > 0 ? Math.max(0, (totalAmount - totalCost) / totalAmount) : 0;

  // 5) 输出
  const byQty = qtyRows.slice().sort((a, b) => Number(b.qty) - Number(a.qty)).slice(0, 5)
    .map(r => ({ product_id: r.product_id, product_name: r.product_name, total_qty: Number(r.qty) || 0, total_amount: Number(r.amt) || 0 }));
  const byAmount = byAmtRows.slice(0, 5)
    .map(r => ({ product_id: r.product_id, product_name: r.product_name, total_amount: Number(r.amt) || 0 }));
  return {
    total_sale: totalAmount,
    total_cost: isSale ? totalCost : totalAmount,
    total_qty: totalQty,
    avg_gm: avgGm,
    by_qty: byQty,
    by_amount: byAmount,
    price_change: priceChange
  };
}

router.get('/analysis/product-sales', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const sd = startDate || '0001-01-01', ed = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user.id, 'sale', sd, ed));
  } catch (e) { fail400(res, e.message); }
});

router.get('/analysis/product-purchase', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const sd = startDate || '0001-01-01', ed = endDate || '9999-12-31';
    ok(res, await productAnalysis(req.user.id, 'purchase', sd, ed));
  } catch (e) { fail400(res, e.message); }
});

module.exports = router;
