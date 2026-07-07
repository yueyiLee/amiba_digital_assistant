/**
 * routes/index.js — 业务 API 路由汇总（11 个模块，PostgreSQL 版）
 * 所有业务接口均需 requireAuth 认证，全部异步处理。
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
    let sql = 'SELECT t.*, c.name AS customer_name, p.name AS product_name FROM transactions t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN products p ON t.product_id=p.id WHERE 1=1';
    const params = [];
    let pi = 0;
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
      'INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [amount, type, unit || '全公司', customer_id || null, product_id || null, date, note || '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM transactions WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return fail404(res, '记录不存在');
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 2. products 商品 ========== */
router.get('/products', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM products ORDER BY id DESC')); }
  catch (e) { fail400(res, e.message); }
});

router.post('/products', async (req, res) => {
  try {
    const { name, brand, unit, category1, category2, purchase_price, sale_price } = req.body || {};
    if (!name || !category1) return fail400(res, '缺少必要字段（名称/一级分类）');
    const result = await db.insertReturning(
      'INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, brand || '', unit || '件', category1, category2 || '', purchase_price || 0, sale_price || 0]
    );
    const newId = result.rows[0].id;
    await db.query('INSERT INTO inventory(product_id,quantity,avg_price) VALUES($1,$2,$3)', [newId, 0, purchase_price || 0]);
    ok(res, { id: newId });
  } catch (e) { fail400(res, e.message); }
});

router.put('/products/:id', async (req, res) => {
  try {
    const p = req.body || {};
    const old = await db.queryOne('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!old) return fail404(res, '商品不存在');
    await db.query(
      'UPDATE products SET name=$1,brand=$2,unit=$3,category1=$4,category2=$5,purchase_price=$6,sale_price=$7 WHERE id=$8',
      [p.name ?? old.name, p.brand ?? old.brand, p.unit ?? old.unit, p.category1 ?? old.category1,
       p.category2 ?? old.category2, p.purchase_price ?? old.purchase_price, p.sale_price ?? old.sale_price, req.params.id]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return fail404(res, '商品不存在');
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 3. customers 客户 ========== */
router.get('/customers', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM customers ORDER BY id DESC')); }
  catch (e) { fail400(res, e.message); }
});

router.post('/customers', async (req, res) => {
  try {
    const { name, type, contact, address } = req.body || {};
    if (!name) return fail400(res, '客户名称必填');
    if (!type) return fail400(res, '客户类型必选');
    const result = await db.insertReturning(
      'INSERT INTO customers(name,type,contact,address) VALUES($1,$2,$3,$4) RETURNING id',
      [name, type, contact || '', address || '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/customers/:id', async (req, res) => {
  try {
    const c = req.body || {};
    const old = await db.queryOne('SELECT * FROM customers WHERE id=$1', [req.params.id]);
    if (!old) return fail404(res, '客户不存在');
    await db.query('UPDATE customers SET name=$1,type=$2,contact=$3,address=$4 WHERE id=$5',
      [c.name ?? old.name, c.type ?? old.type, c.contact ?? old.contact, c.address ?? old.address, req.params.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM customers WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return fail404(res, '客户不存在');
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 4. inventory 库存 ========== */
router.get('/inventory', async (req, res) => {
  try {
    ok(res, await db.queryAll(
      `SELECT i.*, p.name AS product_name, p.category1, p.category2, p.purchase_price, p.sale_price
       FROM inventory i JOIN products p ON i.product_id=p.id ORDER BY i.id`
    ));
  } catch (e) { fail400(res, e.message); }
});

router.put('/inventory/:id', async (req, res) => {
  try {
    const { quantity, avg_price } = req.body || {};
    if (quantity == null) return fail400(res, '缺少库存数量');
    const old = await db.queryOne('SELECT * FROM inventory WHERE id=$1', [req.params.id]);
    if (!old) return fail404(res, '库存记录不存在');
    await db.query('UPDATE inventory SET quantity=$1, avg_price=$2 WHERE id=$3',
      [quantity, avg_price ?? old.avg_price, req.params.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 5. settings 设置 ========== */
router.get('/settings', async (req, res) => {
  try {
    const rows = await db.queryAll('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    ok(res, obj);
  } catch (e) { fail400(res, e.message); }
});

router.put('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(body)) {
        await client.query(
          'INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 6. categories 分类预设 ========== */
router.get('/categories', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM categories ORDER BY id')); }
  catch (e) { fail400(res, e.message); }
});

/* ========== 7. employees 员工 ========== */
router.get('/employees', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM employees ORDER BY id DESC')); }
  catch (e) { fail400(res, e.message); }
});

router.post('/employees', async (req, res) => {
  try {
    const { name, position, hourly_rate, join_date } = req.body || {};
    if (!name) return fail400(res, '姓名必填');
    if (hourly_rate == null || hourly_rate <= 0) return fail400(res, '时薪必须大于 0');
    const result = await db.insertReturning(
      'INSERT INTO employees(name,position,hourly_rate,join_date) VALUES($1,$2,$3,$4) RETURNING id',
      [name, position || '', hourly_rate, join_date || '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/employees/:id', async (req, res) => {
  try {
    const e = req.body || {};
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1', [req.params.id]);
    if (!old) return fail404(res, '员工不存在');
    await db.query('UPDATE employees SET name=$1,position=$2,hourly_rate=$3,join_date=$4 WHERE id=$5',
      [e.name ?? old.name, e.position ?? old.position, e.hourly_rate ?? old.hourly_rate, e.join_date ?? old.join_date, req.params.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/employees/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return fail404(res, '员工不存在');
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 8. contracts 合同 ========== */
router.get('/contracts', async (req, res) => {
  try {
    ok(res, await db.queryAll(
      `SELECT co.*, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id ORDER BY co.id DESC`
    ));
  } catch (e) { fail400(res, e.message); }
});

router.post('/contracts', async (req, res) => {
  try {
    const { contract_no, customer_id, amount, status, start_date, end_date, note } = req.body || {};
    if (!contract_no || !customer_id || amount == null) return fail400(res, '请填写必填项（合同号/客户/金额）');
    const result = await db.insertReturning(
      'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [contract_no, customer_id, amount, status || '进行中', start_date || '', end_date || '', note || '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.put('/contracts/:id', async (req, res) => {
  try {
    const c = req.body || {};
    const old = await db.queryOne('SELECT * FROM contracts WHERE id=$1', [req.params.id]);
    if (!old) return fail404(res, '合同不存在');
    await db.query('UPDATE contracts SET contract_no=$1,customer_id=$2,amount=$3,status=$4,start_date=$5,end_date=$6,note=$7 WHERE id=$8',
      [c.contract_no ?? old.contract_no, c.customer_id ?? old.customer_id, c.amount ?? old.amount,
       c.status ?? old.status, c.start_date ?? old.start_date, c.end_date ?? old.end_date, c.note ?? old.note, req.params.id]);
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/contracts/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM contracts WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return fail404(res, '合同不存在');
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

/* ========== 9. workhours 月度工时（upsert） ========== */
router.get('/workhours', async (req, res) => {
  try {
    const { month } = req.query;
    let sql = 'SELECT wh.*, e.name AS employee_name, e.hourly_rate FROM work_hours wh JOIN employees e ON wh.employee_id=e.id';
    const params = [];
    if (month) { sql += ' WHERE wh.month=$1'; params.push(month); }
    ok(res, await db.queryAll(sql, params));
  } catch (e) { fail400(res, e.message); }
});

router.post('/workhours', async (req, res) => {
  try {
    const { employee_id, hours, month } = req.body || {};
    if (!employee_id || hours == null || !month) return fail400(res, '员工、工时、月份必填');
    if (hours < 0) return fail400(res, '工时必须为有效正数');
    await db.query(
      `INSERT INTO work_hours(employee_id,hours,month) VALUES($1,$2,$3)
       ON CONFLICT(employee_id,month) DO UPDATE SET hours=excluded.hours`,
      [employee_id, hours, month]
    );
    ok(res, { success: true });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/workhours/:id', async (req, res) => {
  try { await db.query('DELETE FROM work_hours WHERE id=$1', [req.params.id]); ok(res, { success: true }); }
  catch (e) { fail400(res, e.message); }
});

/* ========== 10. salaries 工资 ========== */
router.get('/salaries', async (req, res) => {
  try { ok(res, await db.queryAll('SELECT * FROM salaries ORDER BY id DESC')); }
  catch (e) { fail400(res, e.message); }
});

router.post('/salaries', async (req, res) => {
  try {
    const { employee_id, amount, month } = req.body || {};
    const result = await db.insertReturning(
      'INSERT INTO salaries(employee_id,amount,month) VALUES($1,$2,$3) RETURNING id',
      [employee_id, amount || 0, month || '']
    );
    ok(res, { id: result.rows[0].id });
  } catch (e) { fail400(res, e.message); }
});

router.delete('/salaries/:id', async (req, res) => {
  try { await db.query('DELETE FROM salaries WHERE id=$1', [req.params.id]); ok(res, { success: true }); }
  catch (e) { fail400(res, e.message); }
});

/* ========== 11. init 初始化示例数据 ========== */
router.post('/init/sample', async (req, res) => {
  try {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // 清空业务数据（保留用户）
      await client.query('DELETE FROM transactions');
      await client.query('DELETE FROM work_hours');
      await client.query('DELETE FROM salaries');
      await client.query('DELETE FROM contracts');
      await client.query('DELETE FROM inventory');
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM customers');
      await client.query('DELETE FROM employees');
      await client.query('DELETE FROM settings');
      await client.query('DELETE FROM categories');
      // 重置序列
      await client.query("SELECT setval(pg_get_serial_sequence('transactions','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('work_hours','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('salaries','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('contracts','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('inventory','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('products','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('customers','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('employees','id'), 1, false)");
      await client.query("SELECT setval(pg_get_serial_sequence('categories','id'), 1, false)");
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    // 重新种子
    await db.init();

    ok(res, { success: true, message: '示例数据已重置' });
  } catch (e) { fail400(res, e.message); }
});

module.exports = router;
