/**
 * db.js — 数据库初始化层
 * 基于 better-sqlite3（同步 SQLite），匹配 PRD 中"写后即刷新 + 同步读取"的缓存模式。
 * 包含 10 张业务表 + users 用户表（用户管理新增）。
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new Database(DB_PATH);

// 启用外键约束（PRD 18.1：PRAGMA foreign_keys = ON）
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ========== 建表语句 ========== */
const CREATE_TABLES = `
-- 用户表（用户管理新增）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'viewer'  -- admin / editor / viewer
                CHECK(role IN ('admin','editor','viewer')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 收支流水表（核心数据源）
CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  amount      REAL    NOT NULL,            -- 收入为正，支出为负
  type        TEXT    NOT NULL,            -- 销售收入/现金收入/材料采购/委托加工/杂费支出/税金/其他收入
  unit        TEXT    NOT NULL DEFAULT '全公司',
  customer_id INTEGER,
  product_id  INTEGER,
  date        TEXT    NOT NULL,            -- YYYY-MM-DD
  note        TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 客户表
CREATE TABLE IF NOT EXISTS customers (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    NOT NULL,
  type    TEXT    NOT NULL DEFAULT '个人',  -- 个人 / 公司
  contact TEXT    DEFAULT '',
  address TEXT    DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 商品表
CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  brand          TEXT    DEFAULT '',
  unit           TEXT    DEFAULT '件',
  category1      TEXT    NOT NULL,
  category2      TEXT    DEFAULT '',
  purchase_price REAL    DEFAULT 0,
  sale_price     REAL    DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 库存表（与 products 1:1）
CREATE TABLE IF NOT EXISTS inventory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE,
  quantity   REAL    DEFAULT 0,
  avg_price  REAL    DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 合同表
CREATE TABLE IF NOT EXISTS contracts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no TEXT    NOT NULL,
  customer_id INTEGER,
  amount      REAL    NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT '进行中',
  start_date  TEXT    DEFAULT '',
  end_date    TEXT    DEFAULT '',
  note        TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

-- 员工表
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  position    TEXT    DEFAULT '',
  hourly_rate REAL    NOT NULL DEFAULT 0,   -- 时薪 ¥/小时
  join_date   TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 月度工时表（按月 upsert）
CREATE TABLE IF NOT EXISTS work_hours (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  hours       REAL    NOT NULL DEFAULT 0,
  month       TEXT    NOT NULL,             -- YYYY-MM
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(employee_id, month),
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- 工资表（遗留冗余，前端不再用于指标计算）
CREATE TABLE IF NOT EXISTS salaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER,
  amount      REAL    DEFAULT 0,
  month       TEXT    NOT NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- 设置表（键值对）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 商品分类预设表
CREATE TABLE IF NOT EXISTS categories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  level1  TEXT NOT NULL,
  level2  TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_workhours_month ON work_hours(month);
`;

db.exec(CREATE_TABLES);

/* ========== 种子数据 ========== */
function seedData() {
  // 仅在 settings 为空时初始化（首次启动）
  const hasSettings = db.prepare('SELECT COUNT(*) as c FROM settings').get();
  const hasUsers = db.prepare('SELECT COUNT(*) as c FROM users').get();

  // ---- 默认设置 ----
  if (hasSettings.c === 0) {
    const ins = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)');
    ins.run('amoeba_enabled', 'true');
    ins.run('units', JSON.stringify(['全公司', '销售部', '生产部', '行政部']));
    ins.run('active_units', JSON.stringify(['全公司', '销售部', '生产部']));
    ins.run('currency', '¥');
    ins.run('export_format', 'CSV');
  }

  // ---- 默认管理员账户 ----
  if (hasUsers.c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users(username, password_hash, display_name, role) VALUES(?,?,?,?)')
      .run('admin', hash, '系统管理员', 'admin');
    const hash2 = bcrypt.hashSync('editor123', 10);
    db.prepare('INSERT INTO users(username, password_hash, display_name, role) VALUES(?,?,?,?)')
      .run('editor', hash2, '数据录入员', 'editor');
  }

  // ---- 商品分类预设（22 条）----
  const hasCat = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (hasCat.c === 0) {
    const cats = [
      ['上衣', '短袖'], ['上衣', '长袖'], ['上衣', '外套'], ['上衣', '卫衣'],
      ['裤子', '长裤'], ['裤子', '短裤'], ['裤子', '牛仔裤'],
      ['裙子', '连衣裙'], ['裙子', '半身裙'], ['裙子', '短裙'],
      ['外套', '夹克'], ['外套', '风衣'], ['外套', '羽绒服'],
      ['配饰', '帽子'], ['配饰', '围巾'], ['配饰', '手套'], ['配饰', '皮带'],
      ['鞋类', '运动鞋'], ['鞋类', '皮鞋'], ['鞋类', '凉鞋'],
      ['箱包', '手提包'], ['箱包', '双肩包']
    ];
    const insCat = db.prepare('INSERT INTO categories(level1, level2) VALUES(?,?)');
    const tx = db.transaction((rows) => rows.forEach(r => insCat.run(r[0], r[1])));
    tx(cats);
  }

  // ---- 示例业务数据 ----
  const hasTx = db.prepare('SELECT COUNT(*) as c FROM transactions').get();
  if (hasTx.c === 0) {
    const today = new Date();
    const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    // 生成过去 N 天的日期（确保数据落在近30天窗口内）
    const d = (daysAgo) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - daysAgo);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    // 未来 N 天的日期（合同结束日期等）
    const futureD = (daysAhead) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + daysAhead);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };

    // 客户
    const insCust = db.prepare('INSERT INTO customers(name,type,contact,address) VALUES(?,?,?,?)');
    const c1 = insCust.run('张三面料厂', '公司', '138-0000-0001', '绍兴柯桥').lastInsertRowid;
    const c2 = insCust.run('李四成衣店', '个人', '139-0000-0002', '杭州四季青').lastInsertRowid;
    const c3 = insCust.run('王五贸易行', '公司', '137-0000-0003', '广州白马').lastInsertRowid;

    // 商品 + 库存（1:1）
    const insProd = db.prepare('INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price) VALUES(?,?,?,?,?,?,?)');
    const insInv = db.prepare('INSERT INTO inventory(product_id,quantity,avg_price) VALUES(?,?,?)');
    const mkProd = (name, brand, cat1, cat2, pp, sp, qty) => {
      const pid = insProd.run(name, brand, '件', cat1, cat2, pp, sp).lastInsertRowid;
      insInv.run(pid, qty, pp);
      return pid;
    };
    mkProd('纯棉T恤', '棉尚', '上衣', '短袖', 25, 69, 320);
    mkProd('牛仔长裤', '酷牛', '裤子', '牛仔裤', 45, 129, 150);
    mkProd('针织卫衣', '暖绒', '上衣', '卫衣', 38, 99, 80);
    mkProd('修身风衣', '风行', '外套', '风衣', 80, 259, 40);
    mkProd('帆布腰带', '皮革记', '配饰', '皮带', 8, 29, 200);

    // 合同（开始日期在过去，结束日期在未来）
    const insCon = db.prepare('INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date) VALUES(?,?,?,?,?,?)');
    insCon.run('HT-2026-001', c1, 12000, '进行中', d(28), futureD(20));
    insCon.run('HT-2026-002', c2, 8500, '进行中', d(25), futureD(15));
    insCon.run('HT-2026-003', c3, 15000, '进行中', d(20), futureD(10));

    // 员工
    const insEmp = db.prepare('INSERT INTO employees(name,position,hourly_rate,join_date) VALUES(?,?,?,?)');
    const e1 = insEmp.run('张师傅', '裁剪工', 35, '2024-03-01').lastInsertRowid;
    const e2 = insEmp.run('李师傅', '缝纫工', 30, '2024-05-15').lastInsertRowid;
    const e3 = insEmp.run('王小妹', '包装工', 25, '2025-01-10').lastInsertRowid;
    const e4 = insEmp.run('赵主管', '管理员', 45, '2023-06-01').lastInsertRowid;

    // 工时（当月）
    const insWh = db.prepare('INSERT INTO work_hours(employee_id,hours,month) VALUES(?,?,?)');
    insWh.run(e1, 80, ym);
    insWh.run(e2, 90, ym);
    insWh.run(e3, 70, ym);
    insWh.run(e4, 80, ym);

    // 收支流水（日期分布在过去25天内，确保30天趋势图有数据）
    const insTx = db.prepare('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note) VALUES(?,?,?,?,?,?,?)');
    // 收入
    insTx.run(1280, '销售收入', '全公司', c1, null, d(2), '面料订单尾款');
    insTx.run(4500, '销售收入', '销售部', c2, null, d(5), '成衣批发');
    insTx.run(3200, '销售收入', '销售部', c3, null, d(8), '贸易出货');
    insTx.run(800, '现金收入', '全公司', null, null, d(10), '零散零售');
    insTx.run(2600, '其他收入', '全公司', null, null, d(15), '利息收入');
    // 支出（负数）
    insTx.run(-8500, '材料采购', '生产部', c1, null, d(3), '本月面料采购');
    insTx.run(-3200, '委托加工', '生产部', null, null, d(6), '外发染色加工');
    insTx.run(-120, '杂费支出', '全公司', null, null, d(4), '顺丰快递');
    insTx.run(-380, '杂费支出', '行政部', null, null, d(18), '办公用品');
    insTx.run(-5200, '税金', '全公司', null, null, d(1), '增值税');
  }
}

seedData();

module.exports = db;
