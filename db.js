/**
 * db.js — PostgreSQL 数据库连接与初始化
 * 从 SQLite 迁移至 PostgreSQL，使用 pg 连接池。
 * 所有查询均为异步，通过 db.query() 返回 { rows }。
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  user: process.env.PGUSER || 'amoeba',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'amoeba_app',
  password: process.env.PGPASSWORD || 'amoeba123',
  port: process.env.PGPORT || 5432,
});

/** 执行查询，返回 rows 数组 */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

/** 查询单行 */
async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

/** 查询多行 */
async function queryAll(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** 初始化：建表 + 种子数据 */
async function init() {
  const client = await pool.connect();
  try {
    // ========== 建表 ==========
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        role TEXT DEFAULT 'viewer',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT '个人',
        contact TEXT DEFAULT '',
        address TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT DEFAULT '',
        unit TEXT DEFAULT '件',
        category1 TEXT DEFAULT '',
        category2 TEXT DEFAULT '',
        purchase_price REAL DEFAULT 0,
        sale_price REAL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity REAL DEFAULT 0,
        avg_price REAL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        contract_no TEXT NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        amount REAL DEFAULT 0,
        status TEXT DEFAULT '进行中',
        start_date TEXT DEFAULT '',
        end_date TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        position TEXT DEFAULT '',
        hourly_rate REAL DEFAULT 0,
        join_date TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS work_hours (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        hours REAL DEFAULT 0,
        month TEXT NOT NULL,
        UNIQUE(employee_id, month)
      );

      CREATE TABLE IF NOT EXISTS salaries (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        amount REAL DEFAULT 0,
        month TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        unit TEXT DEFAULT '全公司',
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        date TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        level1 TEXT NOT NULL,
        level2 TEXT DEFAULT ''
      );
    `);

    // ========== 种子数据（仅首次启动） ==========
    const userCount = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(userCount.rows[0].c) > 0) {
      console.log('[DB] 数据库已存在数据，跳过种子初始化');
      return;
    }

    console.log('[DB] 首次启动，初始化种子数据...');

    // 用户
    const adminHash = bcrypt.hashSync('admin123', 10);
    const editorHash = bcrypt.hashSync('editor123', 10);
    await client.query(
      'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
      ['admin', adminHash, '系统管理员', 'admin', 'editor', editorHash, '数据录入员', 'editor']
    );

    // 客户
    const custRes = await client.query(
      'INSERT INTO customers(name,type,contact,address) VALUES($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12) RETURNING id',
      ['张三面料厂', '公司', '138-0000-0001', '绍兴柯桥',
       '李四成衣店', '个人', '139-0000-0002', '杭州四季青',
       '王五贸易行', '公司', '137-0000-0003', '广州白马']
    );
    const c1 = custRes.rows[0].id, c2 = custRes.rows[1].id, c3 = custRes.rows[2].id;

    // 商品 + 库存
    const prodRes = await client.query(
      'INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price) VALUES($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14),($15,$16,$17,$18,$19,$20,$21),($22,$23,$24,$25,$26,$27,$28),($29,$30,$31,$32,$33,$34,$35) RETURNING id',
      ['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69,
       '牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129,
       '针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99,
       '修身风衣', '风行', '件', '外套', '风衣', 80, 259,
       '帆布腰带', '皮革记', '件', '配饰', '皮带', 8, 29]
    );
    const prodIds = prodRes.rows.map(r => r.id);
    for (let i = 0; i < prodIds.length; i++) {
      const quantities = [320, 150, 80, 40, 200];
      const prices = [25, 45, 38, 80, 8];
      await client.query('INSERT INTO inventory(product_id,quantity,avg_price) VALUES($1,$2,$3)', [prodIds[i], quantities[i], prices[i]]);
    }

    // 合同
    const today = new Date();
    const d = (daysAgo) => {
      const dt = new Date(today); dt.setDate(dt.getDate() - daysAgo);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    };
    const futureD = (daysAhead) => {
      const dt = new Date(today); dt.setDate(dt.getDate() + daysAhead);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    };
    await client.query(
      'INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12),($13,$14,$15,$16,$17,$18)',
      ['HT-2026-001', c1, 12000, '进行中', d(28), futureD(20),
       'HT-2026-002', c2, 8500, '进行中', d(25), futureD(15),
       'HT-2026-003', c3, 15000, '进行中', d(20), futureD(10)]
    );

    // 员工
    const empRes = await client.query(
      'INSERT INTO employees(name,position,hourly_rate,join_date) VALUES($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12),($13,$14,$15,$16) RETURNING id',
      ['张师傅', '裁剪工', 35, '2024-03-01',
       '李师傅', '缝纫工', 30, '2024-05-15',
       '王小妹', '包装工', 25, '2025-01-10',
       '赵主管', '管理员', 45, '2023-06-01']
    );
    const e1 = empRes.rows[0].id, e2 = empRes.rows[1].id, e3 = empRes.rows[2].id, e4 = empRes.rows[3].id;

    // 工时
    const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    await client.query(
      'INSERT INTO work_hours(employee_id,hours,month) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)',
      [e1, 80, ym, e2, 90, ym, e3, 70, ym, e4, 80, ym]
    );

    // 收支流水（日期在过去 25 天内）
    await client.query(
      `INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note) VALUES
       ($1,$2,$3,$4,$5,$6,$7),
       ($8,$9,$10,$11,$12,$13,$14),
       ($15,$16,$17,$18,$19,$20,$21),
       ($22,$23,$24,$25,$26,$27,$28),
       ($29,$30,$31,$32,$33,$34,$35),
       ($36,$37,$38,$39,$40,$41,$42),
       ($43,$44,$45,$46,$47,$48,$49),
       ($50,$51,$52,$53,$54,$55,$56),
       ($57,$58,$59,$60,$61,$62,$63),
       ($64,$65,$66,$67,$68,$69,$70)`,
      [
        1280, '销售收入', '全公司', c1, null, d(2), '面料订单尾款',
        4500, '销售收入', '销售部', c2, null, d(5), '成衣批发',
        3200, '销售收入', '销售部', c3, null, d(8), '贸易出货',
        800, '现金收入', '全公司', null, null, d(10), '零散零售',
        2600, '其他收入', '全公司', null, null, d(15), '利息收入',
        -8500, '材料采购', '生产部', c1, null, d(3), '本月面料采购',
        -3200, '委托加工', '生产部', null, null, d(6), '外发染色加工',
        -120, '杂费支出', '全公司', null, null, d(4), '顺丰快递',
        -380, '杂费支出', '行政部', null, null, d(18), '办公用品',
        -5200, '税金', '全公司', null, null, d(1), '增值税'
      ]
    );

    // 设置
    await client.query(
      `INSERT INTO settings(key, value) VALUES
       ('amoeba_enabled','true'),
       ('currency','¥'),
       ('export_format','csv'),
       ('units','["全公司","销售部","生产部","行政部"]')`
    );

    // 分类
    await client.query(
      `INSERT INTO categories(level1, level2) VALUES
       ('上衣','短袖'),('上衣','长袖'),('上衣','卫衣'),
       ('裤子','牛仔裤'),('裤子','休闲裤'),
       ('外套','风衣'),('外套','棉服'),
       ('配饰','皮带'),('配饰','帽子')`
    );

    console.log('[DB] 种子数据初始化完成');
  } finally {
    client.release();
  }
}

module.exports = { pool, query, queryOne, queryAll, init };
