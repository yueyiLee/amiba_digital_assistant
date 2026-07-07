/**
 * db.js — PostgreSQL 数据库连接与初始化（CloudBase 云函数兼容版）
 *
 * 双模式：
 *  - 云端（检测到 TENCENTCLOUD_SECRETID 等运行时临时密钥）：走 CloudBase manager-node 的
 *    executePGSql 访问环境内置 PostgreSQL（无需 pg 原生 TCP，也无需任何显式密钥）。
 *  - 本地 / 其他环境：走 pg 原生连接池（保持原有行为，便于本地开发）。
 *
 * 对上层暴露的接口（query / queryOne / queryAll / init）保持不变，路由层无需改动。
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const hasCloudCreds = !!(
  process.env.TENCENTCLOUD_SECRETID &&
  process.env.TENCENTCLOUD_SECRETKEY
);
const ENV = process.env.SCF_NAMESPACE || process.env.TCB_ENV || 'amiba-d3gk34ae899822073';

// ===== 初始化状态（供 /api/health 暴露，无需 CLS 也能观测）=====
let dbReady = false;
let dbError = null;
function setDbStatus(ready, error) { dbReady = ready; dbError = error || null; }
function getStatus() { return { ready: dbReady, error: dbError }; }

// 云端 SDK 客户端延迟创建（不在模块加载时缓存）：
// CloudBase 注入的临时凭证 (TENCENTCLOUD_SESSIONTOKEN) 会周期性过期，
// 若缓存在进程生命周期内，一段时间后 executePGSql 会报 "SecretId is not found"。
// 改为每次需要时按最新环境变量重建；遇到凭证类错误自动重建并重试一次。
let cloudApp = null;
function getCloudApp() {
  if (!cloudApp) {
    const CloudBase = require('@cloudbase/manager-node');
    cloudApp = CloudBase.init({
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN,
      envId: ENV
    });
    console.log('[DB] 使用 CloudBase executePGSql 访问内置 PostgreSQL');
  }
  return cloudApp;
}

async function cloudQuery(Sql) {
  let app = getCloudApp();
  try {
    return await app.database.executePGSql({ EnvId: ENV, Sql });
  } catch (e) {
    const m = ((e && e.message) || '').toLowerCase();
    if (m.includes('secretid') || m.includes('secretkey') || m.includes('token') ||
        m.includes('expired') || m.includes('credential') || m.includes('auth')) {
      // 临时凭证可能已过期，用最新环境变量重建客户端后重试一次
      console.warn('[DB] 凭证疑似过期，重建 SDK 客户端并重试:', e.message);
      cloudApp = null;
      app = getCloudApp();
      return await app.database.executePGSql({ EnvId: ENV, Sql });
    }
    throw e;
  }
}

const pool = new Pool({
  user: process.env.PG_USER || process.env.PGUSER || 'amoeba',
  host: process.env.PG_HOST || process.env.PGHOST || 'localhost',
  database: process.env.PG_DATABASE || process.env.PGDATABASE || 'amoeba_app',
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'amoeba123',
  port: parseInt(process.env.PG_PORT || process.env.PGPORT || '5432', 10),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// ===== 云端适配：executePGSql 的结果 → { rows: [{ col: val }] } =====
function coerce(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return v;
}
function adapt(res) {
  const cols = (res && res.Columns) || [];
  const rows = ((res && res.Rows) || []).map((s) => {
    let arr = [];
    try { arr = JSON.parse(s); } catch (e) { arr = []; }
    const obj = {};
    cols.forEach((c, i) => { obj[c] = coerce(arr[i]); });
    return obj;
  });
  return { rows };
}

// pg 风格 $1/$2 参数 → 安全的 SQL 字面量（CloudBase SDK 不支持参数数组，需转义后内联）
function quote(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function bind(text, params) {
  if (!params || params.length === 0) return text;
  return text.replace(/\$(\d+)/g, (m, i) => quote(params[Number(i) - 1]));
}

async function query(text, params) {
  if (cloudApp || hasCloudCreds) {
    const res = await cloudQuery(bind(text, params));
    return adapt(res);
  }
  const result = await pool.query(text, params);
  return result;
}

// INSERT ... RETURNING 兼容层
// CloudBase executePGSql 不支持 RETURNING 子句（执行成功但 Rows 为空）。
// 云端模式自动拆为两步：先 INSERT（去掉 RETURNING），再 SELECT 最新 id。
// 本地 pg 模式行为不变，透传原始 SQL。
async function insertReturning(text, params) {
  if (cloudApp || hasCloudCreds) {
    const insertPart = text.replace(/\s+RETURNING\s+.*$/i, '');
    await cloudQuery(bind(insertPart, params));
    const tableMatch = insertPart.match(/INTO\s+(\w+)/i);
    if (tableMatch) {
      const res = await cloudQuery(`SELECT id FROM ${tableMatch[1]} ORDER BY id DESC LIMIT 1`);
      return adapt(res);
    }
    return { rows: [{}] };
  }
  return query(text, params);
}
async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}
async function queryAll(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

// ===== 建表 SQL（与业务表结构保持一致）=====
const INIT_TABLES_SQL = `
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
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL DEFAULT 0,
    avg_price REAL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT DEFAULT '',
    hourly_rate REAL DEFAULT 0,
    join_date TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS work_hours (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    hours REAL DEFAULT 0,
    month TEXT NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(employee_id, month)
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    amount REAL DEFAULT 0,
    month TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
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
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS settings (
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT DEFAULT '',
    PRIMARY KEY(owner_id, key)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    level1 TEXT NOT NULL,
    level2 TEXT DEFAULT '',
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  );
`;

// ===== 初始化：建表 + 种子数据（多租户账号隔离）=====
// 业务数据按 owner_id 隔离；首次启动创建 admin/editor 并各自生成示例；
// 旧库（无 owner_id 列）自动 ALTER 加列并迁移（admin 保留现数据、editor 重新生成等价数据）。

// 给旧库补齐 owner_id 列（新库建表时已有，ALTER 幂等）
async function ensureOwnerColumns() {
  const tables = ['customers', 'products', 'inventory', 'contracts', 'employees', 'work_hours', 'salaries', 'transactions', 'settings', 'categories'];
  for (const t of tables) {
    try {
      await query(`ALTER TABLE ${t} ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e;
    }
  }
}

// inventory 旧库补齐 created_at / updated_at 时间戳列（供"最后编辑时间"展示）
async function ensureInventoryColumns() {
  for (const col of ['created_at', 'updated_at']) {
    try {
      await query(`ALTER TABLE inventory ADD COLUMN ${col} TIMESTAMPTZ DEFAULT NOW()`);
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e;
    }
  }
}

// 确保每一个账号都拥有服装行业默认分类（无分类的账号无法录入商品）
async function ensureDefaultCategoriesForAll() {
  const users = await queryAll('SELECT id FROM users');
  for (const u of users) {
    const chk = await queryOne('SELECT COUNT(*) AS c FROM categories WHERE owner_id=$1', [u.id]);
    if (!chk || parseInt(chk.c, 10) === 0) {
      for (const [l1, l2] of DEFAULT_CATEGORIES) {
        await query('INSERT INTO categories(owner_id,level1,level2) VALUES($1,$2,$3)', [u.id, l1, l2]);
      }
    }
  }
}

// settings 旧库主键为 key，改为复合主键 (owner_id, key)
async function fixSettingsPkey() {
  try { await query('ALTER TABLE settings DROP CONSTRAINT settings_pkey'); }
  catch (e) { if (!/does not exist/i.test(e.message || '')) throw e; }
  try { await query('ALTER TABLE settings ADD PRIMARY KEY(owner_id, key)'); }
  catch (e) { if (!/already exists/i.test(e.message || '')) throw e; }
}

// 旧库迁移：无主共享数据就地分配给 admin；为 editor 重新生成等价示例
async function migrateLegacyData() {
  const chk = await query('SELECT COUNT(*) AS c FROM transactions WHERE owner_id IS NULL');
  if (!chk.rows[0] || parseInt(chk.rows[0].c, 10) === 0) return; // 已迁移或无数据
  const admin = await queryOne("SELECT id FROM users WHERE username='admin'");
  const editor = await queryOne("SELECT id FROM users WHERE username='editor'");
  if (admin) {
    const tables = ['customers', 'products', 'inventory', 'contracts', 'employees', 'work_hours', 'salaries', 'transactions', 'settings', 'categories'];
    for (const t of tables) {
      await query(`UPDATE ${t} SET owner_id=$1 WHERE owner_id IS NULL`, [admin.id]);
    }
  }
  await fixSettingsPkey(); // 此时 settings.owner_id 已无 NULL
  if (editor) {
    const ec = await queryOne('SELECT COUNT(*) AS c FROM customers WHERE owner_id=$1', [editor.id]);
    if (!ec || parseInt(ec.c, 10) === 0) await seedForUser(editor.id, 'full');
  }
}

// 为指定用户生成示例数据。mode: 'full'(admin/editor 完整) | 'sample'(新账号核心 2-3 条)
async function seedForUser(uid, mode) {
  const full = mode === 'full';
  const today = new Date();
  const d = (n) => {
    const dt = new Date(today); dt.setDate(dt.getDate() - n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const futureD = (n) => {
    const dt = new Date(today); dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  // 每账号独立的基础设置
  const settingsRows = [['amoeba_enabled', 'true'], ['currency', '¥'], ['export_format', 'csv'], ['units', '["全公司","销售部","生产部","行政部"]']];
  for (const [k, v] of settingsRows) {
    await query('INSERT INTO settings(owner_id,key,value) VALUES($1,$2,$3)', [uid, k, v]);
  }
  // 商品分类预设（服装行业常用，所有账号默认拥有，便于直接录入商品）
  for (const [l1, l2] of DEFAULT_CATEGORIES) {
    await query('INSERT INTO categories(owner_id,level1,level2) VALUES($1,$2,$3)', [uid, l1, l2]);
  }

  // 客户
  const customers = full
    ? [['张三面料厂', '公司', '138-0000-0001', '绍兴柯桥'], ['李四成衣店', '个人', '139-0000-0002', '杭州四季青'], ['王五贸易行', '公司', '137-0000-0003', '广州白马']]
    : [['示例客户甲', '公司', '138-0000-1001', '上海'], ['示例客户乙', '个人', '139-0000-1002', '杭州'], ['示例客户丙', '公司', '137-0000-1003', '广州']];
  const custIds = [];
  for (const [name, type, contact, address] of customers) {
    const r = await insertReturning('INSERT INTO customers(name,type,contact,address,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, type, contact, address, uid]);
    custIds.push(r.rows[0].id);
  }
  const [c1, c2, c3] = custIds;

  // 商品 + 库存
  const products = full
    ? [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 320, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 150, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 80, 38], ['修身风衣', '风行', '件', '外套', '风衣', 80, 259, 40, 80], ['帆布腰带', '皮革记', '件', '配饰', '皮带', 8, 29, 200, 8]]
    : [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 120, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 60, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 40, 38]];
  for (const [name, brand, unit, cat1, cat2, pp, sp, qty, ap] of products) {
    const r = await insertReturning('INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [name, brand, unit, cat1, cat2, pp, sp, uid]);
    await query('INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4)', [r.rows[0].id, qty, ap, uid]);
  }

  if (!full) {
    // 新账号：核心表各 2-3 条示例
    const txns = [
      [1280, '销售收入', '全公司', c1, null, d(2), '示例销售尾款'],
      [-8500, '材料采购', '生产部', c2, null, d(3), '示例面料采购'],
      [-120, '杂费支出', '全公司', null, null, d(4), '示例快递费']
    ];
    for (const [amount, type, unit, cid, pid, date, note] of txns) {
      await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
    }
    return;
  }

  // full：合同 / 员工 / 工时 / 收支
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const contracts = [
    ['HT-2026-001', c1, 12000, '进行中', d(28), futureD(20)],
    ['HT-2026-002', c2, 8500, '进行中', d(25), futureD(15)],
    ['HT-2026-003', c3, 15000, '进行中', d(20), futureD(10)]
  ];
  for (const [no, cid, amt, st, sd, ed] of contracts) {
    await query('INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [no, cid, amt, st, sd, ed, uid]);
  }
  const employees = [['张师傅', '裁剪工', 35, '2024-03-01'], ['李师傅', '缝纫工', 30, '2024-05-15'], ['王小妹', '包装工', 25, '2025-01-10'], ['赵主管', '管理员', 45, '2023-06-01']];
  const empIds = [];
  for (const [name, pos, rate, jd] of employees) {
    const r = await insertReturning('INSERT INTO employees(name,position,hourly_rate,join_date,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, pos, rate, jd, uid]);
    empIds.push(r.rows[0].id);
  }
  const hours = [80, 90, 70, 80];
  for (let i = 0; i < empIds.length; i++) {
    await query('INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)', [empIds[i], hours[i], ym, uid]);
  }
  const txns = [
    [1280, '销售收入', '全公司', c1, null, d(2), '面料订单尾款'],
    [4500, '销售收入', '销售部', c2, null, d(5), '成衣批发'],
    [3200, '销售收入', '销售部', c3, null, d(8), '贸易出货'],
    [800, '现金收入', '全公司', null, null, d(10), '零散零售'],
    [2600, '其他收入', '全公司', null, null, d(15), '利息收入'],
    [-8500, '材料采购', '生产部', c1, null, d(3), '本月面料采购'],
    [-3200, '委托加工', '生产部', null, null, d(6), '外发染色加工'],
    [-120, '杂费支出', '全公司', null, null, d(4), '顺丰快递'],
    [-380, '杂费支出', '行政部', null, null, d(18), '办公用品'],
    [-5200, '税金', '全公司', null, null, d(1), '增值税']
  ];
  for (const [amount, type, unit, cid, pid, date, note] of txns) {
    await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
  }
}

async function init() {
 try {
  // 1) 建表（逐条执行；单条失败仅记录，不阻断整体）
  const stmts = INIT_TABLES_SQL.split(';').map((s) => s.trim()).filter(Boolean);
  for (const st of stmts) {
    try {
      await query(st);
    } catch (e) {
      console.error('[DB] 建表语句跳过:', st.slice(0, 50).replace(/\s+/g, ' '), '->', e.message);
    }
  }

  // 2) 旧库兼容：补齐 owner_id 列
  await ensureOwnerColumns();

  // 2.5) inventory 补齐 created_at / updated_at 时间戳列
  await ensureInventoryColumns();

  // 3) 旧库数据迁移（幂等）：无主共享数据分配给 admin，editor 重新生成等价数据
  await migrateLegacyData();

  // 3.5) 确保每个账号都拥有服装行业默认分类（无分类账号无法录入商品）
  await ensureDefaultCategoriesForAll();

  // 4) 首次启动：无用户则创建 admin/editor 并各自生成完整示例
  const r = await query('SELECT COUNT(*) AS c FROM users');
  const count = r.rows[0] ? parseInt(r.rows[0].c, 10) : 0;
  if (count === 0) {
    console.log('[DB] 首次启动，创建种子账号与示例数据...');
    const adminHash = bcrypt.hashSync('admin123', 10);
    const editorHash = bcrypt.hashSync('editor123', 10);
    await query(
      'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
      ['admin', adminHash, '系统管理员', 'admin', 'editor', editorHash, '数据录入员', 'editor']
    );
    const admin = await queryOne("SELECT id FROM users WHERE username='admin'");
    const editor = await queryOne("SELECT id FROM users WHERE username='editor'");
    await seedForUser(admin.id, 'full');
    await seedForUser(editor.id, 'full');
    console.log('[DB] 种子账号与示例数据初始化完成');
  } else {
    console.log('[DB] 数据库已存在账号，跳过账号创建（示例数据按 owner 隔离）');
  }

  setDbStatus(true);
 } catch (e) {
  console.error('[DB] init 异常:', e.message);
  setDbStatus(false, e.message);
 }
}

module.exports = { pool, query, queryOne, queryAll, insertReturning, init, getStatus, seedForUser };
