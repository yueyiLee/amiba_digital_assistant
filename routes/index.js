/**
 * routes/index.js — 业务 API 路由汇总（11 个模块，对应 PRD 第 19 章）
 * 所有业务接口均需 requireAuth 认证。
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
router.get('/transactions', (req, res) => {
  const { unit, type, startDate, endDate } = req.query;
  let sql = 'SELECT t.*, c.name AS customer_name, p.name AS product_name FROM transactions t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN products p ON t.product_id=p.id WHERE 1=1';
  const params = [];
  if (unit && unit !== '全部单元') { sql += ' AND t.unit=?'; params.push(unit); }
  if (type) { sql += ' AND t.type=?'; params.push(type); }
  if (startDate) { sql += ' AND t.date>=?'; params.push(startDate); }
  if (endDate) { sql += ' AND t.date<=?'; params.push(endDate); }
  sql += ' ORDER BY t.date DESC, t.id DESC';
  ok(res, db.prepare(sql).all(...params));
});

router.post('/transactions', (req, res) => {
  const { amount, type, unit, date, customer_id, product_id, note } = req.body || {};
  if (amount == null || !type || !date) return fail400(res, '缺少必要字段（金额/类型/日期）');
  if (type === '其他收入') { /* allow */ }
  ok(res, db.prepare(
    'INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note) VALUES(?,?,?,?,?,?,?)'
  ).run(amount, type, unit || '全公司', customer_id || null, product_id || null, date, note || ''));
});

router.delete('/transactions/:id', (req, res) => {
  const info = db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
  if (info.changes === 0) return fail404(res, '记录不存在');
  ok(res, { success: true });
});

/* ========== 2. products 商品 ========== */
router.get('/products', (req, res) => {
  ok(res, db.prepare('SELECT * FROM products ORDER BY id DESC').all());
});

router.post('/products', (req, res) => {
  const { name, brand, unit, category1, category2, purchase_price, sale_price } = req.body || {};
  if (!name || !category1) return fail400(res, '缺少必要字段（名称/一级分类）');
  const info = db.prepare(
    'INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price) VALUES(?,?,?,?,?,?,?)'
  ).run(name, brand || '', unit || '件', category1, category2 || '', purchase_price || 0, sale_price || 0);
  // 库存联动：新建商品自动建一条库存记录（初始 0）
  db.prepare('INSERT INTO inventory(product_id,quantity,avg_price) VALUES(?,?,?)')
    .run(info.lastInsertRowid, 0, purchase_price || 0);
  ok(res, { id: info.lastInsertRowid });
});

router.put('/products/:id', (req, res) => {
  const p = req.body || {};
  const old = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!old) return fail404(res, '商品不存在');
  db.prepare(`UPDATE products SET name=?,brand=?,unit=?,category1=?,category2=?,purchase_price=?,sale_price=? WHERE id=?`)
    .run(p.name ?? old.name, p.brand ?? old.brand, p.unit ?? old.unit, p.category1 ?? old.category1,
         p.category2 ?? old.category2, p.purchase_price ?? old.purchase_price, p.sale_price ?? old.sale_price, req.params.id);
  ok(res, { success: true });
});

router.delete('/products/:id', (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  if (info.changes === 0) return fail404(res, '商品不存在');
  ok(res, { success: true });
});

/* ========== 3. customers 客户 ========== */
router.get('/customers', (req, res) => {
  ok(res, db.prepare('SELECT * FROM customers ORDER BY id DESC').all());
});

router.post('/customers', (req, res) => {
  const { name, type, contact, address } = req.body || {};
  if (!name) return fail400(res, '客户名称必填');
  if (!type) return fail400(res, '客户类型必选');
  ok(res, db.prepare('INSERT INTO customers(name,type,contact,address) VALUES(?,?,?,?)')
    .run(name, type, contact || '', address || ''));
});

router.put('/customers/:id', (req, res) => {
  const c = req.body || {};
  const old = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!old) return fail404(res, '客户不存在');
  db.prepare('UPDATE customers SET name=?,type=?,contact=?,address=? WHERE id=?')
    .run(c.name ?? old.name, c.type ?? old.type, c.contact ?? old.contact, c.address ?? old.address, req.params.id);
  ok(res, { success: true });
});

router.delete('/customers/:id', (req, res) => {
  const info = db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  if (info.changes === 0) return fail404(res, '客户不存在');
  ok(res, { success: true });
});

/* ========== 4. inventory 库存 ========== */
router.get('/inventory', (req, res) => {
  ok(res, db.prepare(
    `SELECT i.*, p.name AS product_name, p.category1, p.category2, p.purchase_price, p.sale_price
     FROM inventory i JOIN products p ON i.product_id=p.id ORDER BY i.id`
  ).all());
});

router.put('/inventory/:id', (req, res) => {
  const { quantity, avg_price } = req.body || {};
  if (quantity == null) return fail400(res, '缺少库存数量');
  const old = db.prepare('SELECT * FROM inventory WHERE id=?').get(req.params.id);
  if (!old) return fail404(res, '库存记录不存在');
  db.prepare('UPDATE inventory SET quantity=?, avg_price=? WHERE id=?')
    .run(quantity, avg_price ?? old.avg_price, req.params.id);
  ok(res, { success: true });
});

/* ========== 5. settings 设置 ========== */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  ok(res, obj);
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const ins = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)');
  const tx = db.transaction(() => {
    Object.entries(body).forEach(([k, v]) => ins.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
  });
  tx();
  ok(res, { success: true });
});

/* ========== 6. categories 分类预设 ========== */
router.get('/categories', (req, res) => {
  ok(res, db.prepare('SELECT * FROM categories ORDER BY id').all());
});

/* ========== 7. employees 员工 ========== */
router.get('/employees', (req, res) => {
  ok(res, db.prepare('SELECT * FROM employees ORDER BY id DESC').all());
});

router.post('/employees', (req, res) => {
  const { name, position, hourly_rate, join_date } = req.body || {};
  if (!name) return fail400(res, '姓名必填');
  if (hourly_rate == null || hourly_rate <= 0) return fail400(res, '时薪必须大于 0');
  ok(res, db.prepare('INSERT INTO employees(name,position,hourly_rate,join_date) VALUES(?,?,?,?)')
    .run(name, position || '', hourly_rate, join_date || ''));
});

router.put('/employees/:id', (req, res) => {
  const e = req.body || {};
  const old = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id);
  if (!old) return fail404(res, '员工不存在');
  db.prepare('UPDATE employees SET name=?,position=?,hourly_rate=?,join_date=? WHERE id=?')
    .run(e.name ?? old.name, e.position ?? old.position, e.hourly_rate ?? old.hourly_rate, e.join_date ?? old.join_date, req.params.id);
  ok(res, { success: true });
});

router.delete('/employees/:id', (req, res) => {
  const info = db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id);
  if (info.changes === 0) return fail404(res, '员工不存在');
  ok(res, { success: true });
});

/* ========== 8. contracts 合同 ========== */
router.get('/contracts', (req, res) => {
  ok(res, db.prepare(
    `SELECT co.*, c.name AS customer_name FROM contracts co LEFT JOIN customers c ON co.customer_id=c.id ORDER BY co.id DESC`
  ).all());
});

router.post('/contracts', (req, res) => {
  const { contract_no, customer_id, amount, status, start_date, end_date, note } = req.body || {};
  if (!contract_no || !customer_id || amount == null) return fail400(res, '请填写必填项（合同号/客户/金额）');
  ok(res, db.prepare(
    'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,note) VALUES(?,?,?,?,?,?,?)'
  ).run(contract_no, customer_id, amount, status || '进行中', start_date || '', end_date || '', note || ''));
});

router.put('/contracts/:id', (req, res) => {
  const c = req.body || {};
  const old = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!old) return fail404(res, '合同不存在');
  db.prepare('UPDATE contracts SET contract_no=?,customer_id=?,amount=?,status=?,start_date=?,end_date=?,note=? WHERE id=?')
    .run(c.contract_no ?? old.contract_no, c.customer_id ?? old.customer_id, c.amount ?? old.amount,
         c.status ?? old.status, c.start_date ?? old.start_date, c.end_date ?? old.end_date, c.note ?? old.note, req.params.id);
  ok(res, { success: true });
});

router.delete('/contracts/:id', (req, res) => {
  const info = db.prepare('DELETE FROM contracts WHERE id=?').run(req.params.id);
  if (info.changes === 0) return fail404(res, '合同不存在');
  ok(res, { success: true });
});

/* ========== 9. workhours 月度工时（upsert） ========== */
router.get('/workhours', (req, res) => {
  const { month } = req.query;
  let sql = 'SELECT wh.*, e.name AS employee_name, e.hourly_rate FROM work_hours wh JOIN employees e ON wh.employee_id=e.id';
  const params = [];
  if (month) { sql += ' WHERE wh.month=?'; params.push(month); }
  ok(res, db.prepare(sql).all(...params));
});

router.post('/workhours', (req, res) => {
  const { employee_id, hours, month } = req.body || {};
  if (!employee_id || hours == null || !month) return fail400(res, '员工、工时、月份必填');
  if (hours < 0) return fail400(res, '工时必须为有效正数');
  // upsert
  db.prepare(`INSERT INTO work_hours(employee_id,hours,month) VALUES(?,?,?)
              ON CONFLICT(employee_id,month) DO UPDATE SET hours=excluded.hours`)
    .run(employee_id, hours, month);
  ok(res, { success: true });
});

router.delete('/workhours/:id', (req, res) => {
  db.prepare('DELETE FROM work_hours WHERE id=?').run(req.params.id);
  ok(res, { success: true });
});

/* ========== 10. salaries 工资（遗留冗余，保留兼容） ========== */
router.get('/salaries', (req, res) => {
  ok(res, db.prepare('SELECT * FROM salaries ORDER BY id DESC').all());
});

router.post('/salaries', (req, res) => {
  const { employee_id, amount, month } = req.body || {};
  ok(res, db.prepare('INSERT INTO salaries(employee_id,amount,month) VALUES(?,?,?)')
    .run(employee_id, amount || 0, month || ''));
});

router.delete('/salaries/:id', (req, res) => {
  db.prepare('DELETE FROM salaries WHERE id=?').run(req.params.id);
  ok(res, { success: true });
});

/* ========== 11. init 初始化示例数据 ========== */
router.post('/init/sample', (req, res) => {
  // 清空业务数据后重新种子（保留用户）
  db.exec(`DELETE FROM transactions; DELETE FROM work_hours; DELETE FROM salaries;
           DELETE FROM contracts; DELETE FROM inventory; DELETE FROM products;
           DELETE FROM customers; DELETE FROM employees; DELETE FROM sqlite_sequence
           WHERE name IN ('transactions','work_hours','salaries','contracts','inventory','products','customers','employees');`);
  // 重新种子
  delete require.cache[require.resolve('../db')];
  require('../db');
  ok(res, { success: true, message: '示例数据已重置' });
});

module.exports = router;
