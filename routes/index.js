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
    ok(res, rows);
  } catch (e) { fail400(res, e.message); }
});

router.post('/transactions', async (req, res) => {
  try {
    const { amount, type, unit, date, customer_id, product_id, note } = req.body || {};
    if (amount == null || !type || !date) return fail400(res, '缺少必要字段（金额/类型/日期）');
    const result = await db.insertReturning(
      'INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [amount, type, unit || '全公司', customer_id || null, product_id || null, date, note || '', req.user.id]
    );
    ok(res, { id: result.rows[0].id });
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
    const { name, position, hourly_rate, join_date } = req.body || {};
    if (!name) return fail400(res, '姓名必填');
    if (hourly_rate == null || hourly_rate <= 0) return fail400(res, '时薪必须大于 0');
    const result = await db.insertReturning(
      'INSERT INTO employees(name,position,hourly_rate,join_date,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [name, position || '', hourly_rate, join_date || '', req.user.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/employees/:id', async (req, res) => {
  try {
    const e = req.body || {};
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '员工不存在');
    await db.query('UPDATE employees SET name=$1,position=$2,hourly_rate=$3,join_date=$4 WHERE id=$5 AND owner_id=$6',
      [e.name ?? old.name, e.position ?? old.position, e.hourly_rate ?? old.hourly_rate, e.join_date ?? old.join_date, req.params.id, req.user.id]);
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

/* ========== 8. contracts 合同 ========== */
router.get('/contracts', async (req, res) => {
  try {
    ok(res, await db.queryAll(
      `SELECT co.*, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id WHERE co.owner_id=$1 ORDER BY co.id DESC`,
      [req.user.id]
    ));
  } catch (e) { fail400(res, e.message); }
});

router.post('/contracts', async (req, res) => {
  try {
    const { contract_no, customer_id, amount, status, start_date, end_date, note } = req.body || {};
    if (!contract_no || !customer_id || amount == null) return fail400(res, '请填写必填项（合同号/客户/金额）');
    const result = await db.insertReturning(
      'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [contract_no, customer_id, amount, status || '进行中', start_date || '', end_date || '', note || '', req.user.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/contracts/:id', async (req, res) => {
  try {
    const c = req.body || {};
    const old = await db.queryOne('SELECT * FROM contracts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!old) return fail404(res, '合同不存在');
    await db.query('UPDATE contracts SET contract_no=$1,customer_id=$2,amount=$3,status=$4,start_date=$5,end_date=$6,note=$7 WHERE id=$8 AND owner_id=$9',
      [c.contract_no ?? old.contract_no, c.customer_id ?? old.customer_id, c.amount ?? old.amount,
       c.status ?? old.status, c.start_date ?? old.start_date, c.end_date ?? old.end_date, c.note ?? old.note, req.params.id, req.user.id]);
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

module.exports = router;
