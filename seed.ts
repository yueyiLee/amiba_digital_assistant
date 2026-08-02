/**
 * seed.ts — 种子数据与示例数据初始化
 *
 * 将数据库初始化时所需的种子账号创建、默认字典（分类/支出项/收支类型）
 * 以及示例业务数据（客户/产品/合同/员工等）抽取到本模块，保持 db.ts 只负责
 * 建表与数据迁移。路由层也可直接调用 seedForUser 为新账号生成示例数据。
 */
import bcrypt from 'bcryptjs';
import { query, queryOne, insertReturning } from './db';

// 服装行业默认商品分类（系统预设，所有账号同步拥有，便于直接录入商品）
export const DEFAULT_CATEGORIES: [string, string][] = [
  ['上衣', '短袖'], ['上衣', '长袖'], ['上衣', '卫衣'], ['上衣', '衬衫'],
  ['裤子', '牛仔裤'], ['裤子', '休闲裤'], ['裤子', '西裤'],
  ['外套', '风衣'], ['外套', '棉服'], ['外套', '羽绒服'],
  ['裙装', '连衣裙'], ['裙装', '半身裙'],
  ['针织', '毛衣'], ['针织', '针织衫'],
  ['配饰', '皮带'], ['配饰', '帽子'], ['配饰', '围巾'], ['配饰', '袜子'],
  ['原材料', '纱线'], ['原材料', '坯布'],
  ['成品面料', ''],
];

// 支出项细分预设
export const DEFAULT_EXPENSE_ITEMS: [string, string][] = [
  ['processing', '染色费'], ['processing', '制造费用'], ['processing', '后整理费'],
  ['misc', '培训费'], ['misc', '差旅费'], ['misc', '水电费'], ['misc', '维修费用'],
  ['misc', '产品运营费用'], ['misc', '车辆费用'], ['misc', '库存利息'], ['misc', '其他管理杂费'],
  ['misc', '医保社保保费'], ['misc', '门店租金'], ['misc', '物业费'],
  ['misc', '机器设备折旧费'], ['misc', '财务费用'], ['misc', '预提所得税'],
];

// 收支类型预设
export const DEFAULT_EXPENSE_TYPES: [string, string, boolean, boolean, string][] = [
  ['材料采购', 'expense', true, true, ''],
  ['委托加工', 'expense', true, false, 'processing'],
  ['杂费支出', 'expense', false, false, 'misc'],
  ['税金', 'expense', false, false, ''],
  ['现金支出', 'expense', true, true, ''],
  ['销售收入', 'income', true, true, ''],
  ['现金收入', 'income', true, true, ''],
  ['其他收入', 'income', true, true, ''],
];

/**
 * 为指定用户生成种子/示例数据。
 * @param uid  目标用户 owner_id
 * @param mode 'full' 生成完整示例数据；'sample' 仅生成精简示例
 */
export async function seedForUser(uid: number, mode: 'full' | 'sample'): Promise<void> {
  const full: boolean = mode === 'full';
  const today: Date = new Date();
  const d = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() - n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const futureD = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  const settingsRows: [string, string][] = [['amoeba_enabled', 'true'], ['currency', '¥'], ['export_format', 'csv'], ['units', '["全公司","销售部","生产部","行政部"]']];
  for (const [k, v] of settingsRows) {
    await query('INSERT INTO settings(owner_id,key,value) VALUES($1,$2,$3)', [uid, k, v]);
  }
  for (const [l1, l2] of DEFAULT_CATEGORIES) {
    await query('INSERT INTO categories(owner_id,level1,level2) VALUES($1,$2,$3)', [uid, l1, l2]);
  }
  for (const [kind, name] of DEFAULT_EXPENSE_ITEMS) {
    await query('INSERT INTO expense_items(owner_id,kind,name) VALUES($1,$2,$3)', [uid, kind, name]);
  }
  for (const [name, direction, lc, lp, lcat] of DEFAULT_EXPENSE_TYPES) {
    await query(
      'INSERT INTO expense_types(owner_id,name,direction,link_customer,link_product,link_cat,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid, name, direction, lc, lp, lcat, true]
    );
  }

  const customers: [string, string, string, string][] = full
    ? [['张三面料厂', '公司', '138-0000-0001', '绍兴柯桥'], ['李四成衣店', '个人', '139-0000-0002', '杭州四季青'], ['王五贸易行', '公司', '137-0000-0003', '广州白马']]
    : [['示例客户甲', '公司', '138-0000-1001', '上海'], ['示例客户乙', '个人', '139-0000-1002', '杭州'], ['示例客户丙', '公司', '137-0000-1003', '广州']];
  const custIds: number[] = [];
  for (const [name, type, contact, address] of customers) {
    const r = await insertReturning('INSERT INTO customers(name,type,contact,address,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, type, contact, address, uid]);
    custIds.push(r.rows[0].id as number);
  }
  const [c1, c2, c3] = custIds;

  const products: [string, string, string, string, string, number, number, number, number][] = full
    ? [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 320, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 150, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 80, 38], ['修身风衣', '风行', '件', '外套', '风衣', 80, 259, 40, 80], ['帆布腰带', '皮革记', '件', '配饰', '皮带', 8, 29, 200, 8]]
    : [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 120, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 60, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 40, 38]];
  for (const [name, brand, unit, cat1, cat2, pp, sp, qty, ap] of products) {
    const r = await insertReturning('INSERT INTO products(name,brand,unit,category1,category2,purchase_price,sale_price,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [name, brand, unit, cat1, cat2, pp, sp, uid]);
    await query('INSERT INTO inventory(product_id,quantity,avg_price,owner_id) VALUES($1,$2,$3,$4)', [r.rows[0].id, qty, ap, uid]);
  }

  if (!full) {
    const txns: [number, string, string, number | null, null, string, string][] = [
      [1280, '销售收入', '全公司', c1, null, d(2), '示例销售尾款'],
      [-8500, '材料采购', '生产部', c2, null, d(3), '示例面料采购'],
      [-120, '杂费支出', '全公司', null, null, d(4), '示例快递费'],
    ];
    for (const [amount, type, unit, cid, pid, date, note] of txns) {
      await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
    }
    return;
  }

  const ym: string = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const contracts: [string, number, number, string, string, string][] = [
    ['HT-2026-001', c1, 12000, '进行中', d(28), futureD(20)],
    ['HT-2026-002', c2, 8500, '进行中', d(25), futureD(15)],
    ['HT-2026-003', c3, 15000, '进行中', d(20), futureD(10)],
  ];
  for (const [no, cid, amt, st, sd, ed] of contracts) {
    await query('INSERT INTO contracts(contract_no,customer_id,amount,status,start_date,end_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [no, cid, amt, st, sd, ed, uid]);
  }

  const svcSeed: [string, number, string][] = [['染色服务', 2.5, '按米计费的染色加工'], ['设计打样', 60, '款式设计打样'], ['物流配送', 8, '同城配送费']];
  const svcIds: number[] = [];
  for (const [nm, rc, nt] of svcSeed) {
    const r = await insertReturning('INSERT INTO services(name,reference_cost,note,owner_id) VALUES($1,$2,$3,$4) RETURNING id', [nm, rc, nt, uid]);
    svcIds.push(r.rows[0].id as number);
  }

  const firstC = await queryOne('SELECT id FROM contracts WHERE owner_id=$1 ORDER BY id ASC LIMIT 1', [uid]);
  if (firstC) {
    await query("UPDATE contracts SET direction='sale', date=start_date, contract_no='' WHERE id=$1", [firstC.id]);
    await query(
      'INSERT INTO contract_items(contract_id,product_id,quantity,actual_price,amount,owner_id) SELECT $1, id, 100, 69, 6900, $2 FROM products WHERE owner_id=$2 AND name=$3 LIMIT 1',
      [firstC.id, uid, '纯棉T恤']
    );
    await query('INSERT INTO contract_services(contract_id,service_id,service_name,amount,owner_id) VALUES($1,$2,$3,$4,$5)',
      [firstC.id, svcIds[0], '染色服务', 250, uid]);
    const sumI = await queryOne('SELECT COALESCE(SUM(amount),0) AS s FROM contract_items WHERE contract_id=$1 AND owner_id=$2', [firstC.id, uid]);
    const sumS = await queryOne('SELECT COALESCE(SUM(amount),0) AS s FROM contract_services WHERE contract_id=$1 AND owner_id=$2', [firstC.id, uid]);
    await query('UPDATE contracts SET amount=$1 WHERE id=$2', [Number((sumI?.s as number) || 0) + Number((sumS?.s as number) || 0), firstC.id]);
  }

  const employees: [string, string, number, string][] = [['张师傅', '裁剪工', 35, '2024-03-01'], ['李师傅', '缝纫工', 30, '2024-05-15'], ['王小妹', '包装工', 25, '2025-01-10'], ['赵主管', '管理员', 45, '2023-06-01']];
  const empIds: number[] = [];
  for (const [name, pos, rate, jd] of employees) {
    const r = await insertReturning('INSERT INTO employees(name,position,hourly_rate,join_date,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, pos, rate, jd, uid]);
    empIds.push(r.rows[0].id as number);
  }
  const hours: number[] = [80, 90, 70, 80];
  for (let i = 0; i < empIds.length; i++) {
    await query('INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)', [empIds[i], hours[i], ym, uid]);
  }

  const txns: [number, string, string, number | null, null, string, string][] = [
    [1280, '销售收入', '全公司', c1, null, d(2), '面料订单尾款'],
    [4500, '销售收入', '销售部', c2, null, d(5), '成衣批发'],
    [3200, '销售收入', '销售部', c3, null, d(8), '贸易出货'],
    [800, '现金收入', '全公司', null, null, d(10), '零散零售'],
    [2600, '其他收入', '全公司', null, null, d(15), '利息收入'],
    [-8500, '材料采购', '生产部', c1, null, d(3), '本月面料采购'],
    [-3200, '委托加工', '生产部', null, null, d(6), '外发染色加工'],
    [-120, '杂费支出', '全公司', null, null, d(4), '顺丰快递'],
    [-380, '杂费支出', '行政部', null, null, d(18), '办公用品'],
    [-5200, '税金', '全公司', null, null, d(1), '增值税'],
  ];
  for (const [amount, type, unit, cid, pid, date, note] of txns) {
    await query('INSERT INTO transactions(amount,type,unit,customer_id,product_id,date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [amount, type, unit, cid, pid, date, note, uid]);
  }
}

/**
 * 首次启动种子账号创建：仅当 users 表为空时创建 admin/editor 并生成完整示例数据。
 */
export async function seedAccounts(): Promise<void> {
  const r = await query('SELECT COUNT(*) AS c FROM users');
  const count: number = r.rows[0] ? parseInt(String(r.rows[0].c), 10) : 0;
  if (count === 0) {
    console.log('[DB] 首次启动，创建种子账号与示例数据...');
    const adminHash: string = bcrypt.hashSync('admin123', 10);
    const editorHash: string = bcrypt.hashSync('editor123', 10);
    await query(
      'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
      ['admin', adminHash, '系统管理员', 'admin', 'editor', editorHash, '数据录入员', 'admin']
    );
    const admin = await queryOne("SELECT id FROM users WHERE username='admin'") as { id: number } | null;
    const editor = await queryOne("SELECT id FROM users WHERE username='editor'") as { id: number } | null;
    if (admin) await seedForUser(admin.id, 'full');
    if (editor) await seedForUser(editor.id, 'full');
    console.log('[DB] 种子账号与示例数据初始化完成');
  } else {
    console.log('[DB] 数据库已存在账号，跳过账号创建（示例数据按 owner 隔离）');
  }
}
