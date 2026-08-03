/**
 * seed.ts — 种子数据与示例数据初始化（Drizzle ORM 版）
 *
 * 将数据库初始化时所需的种子账号创建、默认字典（分类/支出项/收支类型）
 * 以及示例业务数据（客户/产品/合同/员工等）抽取到本模块，保持 db.ts 只负责
 * 建表与数据迁移。路由层也可直接调用 seedForUser 为新账号生成示例数据。
 *
 * 自 v1.2 起，内部优先使用 Drizzle 查询，同时保留原生 SQL 作为后备。
 */
import bcrypt from 'bcryptjs';
import { sql, eq } from 'drizzle-orm';
import { getDb } from './drizzle/db.js';
import { users } from './drizzle/schema/users.js';
import {
  seedSettings, seedCategories, seedExpenseItems, seedExpenseTypes,
  seedCustomers, seedProducts, seedContracts, seedServices,
  seedEmployees, seedWorkHours, seedTransactions,
  findFirstContract, insertContractItemForProduct,
  insertContractService, updateContractAmount,
} from './drizzle/queries/seed.queries.js';
import type { SeedTransactionRow } from './drizzle/queries/seed.queries.js';
import { rootLogger } from './logger';

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
  const db = getDb();
  const today: Date = new Date();
  const d = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() - n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const futureD = (n: number): string => {
    const dt = new Date(today); dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  // 默认字典数据
  await seedSettings(db, uid);
  await seedCategories(db, uid, DEFAULT_CATEGORIES);
  await seedExpenseItems(db, uid, DEFAULT_EXPENSE_ITEMS);
  await seedExpenseTypes(db, uid, DEFAULT_EXPENSE_TYPES);

  // 客户数据
  const customersData: [string, string, string, string][] = full
    ? [['张三面料厂', '公司', '138-0000-0001', '绍兴柯桥'], ['李四成衣店', '个人', '139-0000-0002', '杭州四季青'], ['王五贸易行', '公司', '137-0000-0003', '广州白马']]
    : [['示例客户甲', '公司', '138-0000-1001', '上海'], ['示例客户乙', '个人', '139-0000-1002', '杭州'], ['示例客户丙', '公司', '137-0000-1003', '广州']];
  const custIds = await seedCustomers(db, uid, customersData);
  const [c1, c2, c3] = custIds;

  // 商品数据
  const productsData: [string, string, string, string, string, number, number, number, number][] = full
    ? [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 320, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 150, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 80, 38], ['修身风衣', '风行', '件', '外套', '风衣', 80, 259, 40, 80], ['帆布腰带', '皮革记', '件', '配饰', '皮带', 8, 29, 200, 8]]
    : [['纯棉T恤', '棉尚', '件', '上衣', '短袖', 25, 69, 120, 25], ['牛仔长裤', '酷牛', '件', '裤子', '牛仔裤', 45, 129, 60, 45], ['针织卫衣', '暖绒', '件', '上衣', '卫衣', 38, 99, 40, 38]];
  await seedProducts(db, uid, productsData);

  if (!full) {
    const txns: SeedTransactionRow[] = [
      { amount: 1280, type: '销售收入', unit: '全公司', customerId: c1, date: d(2), note: '示例销售尾款' },
      { amount: -8500, type: '材料采购', unit: '生产部', customerId: c2, date: d(3), note: '示例面料采购' },
      { amount: -120, type: '杂费支出', unit: '全公司', customerId: null, date: d(4), note: '示例快递费' },
    ];
    await seedTransactions(db, uid, txns);
    return;
  }

  const ym: string = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const contractsData: [string, number, number, string, string, string][] = [
    ['HT-2026-001', c1, 12000, '进行中', d(28), futureD(20)],
    ['HT-2026-002', c2, 8500, '进行中', d(25), futureD(15)],
    ['HT-2026-003', c3, 15000, '进行中', d(20), futureD(10)],
  ];
  await seedContracts(db, uid, contractsData);

  const svcSeed: [string, number, string][] = [['染色服务', 2.5, '按米计费的染色加工'], ['设计打样', 60, '款式设计打样'], ['物流配送', 8, '同城配送费']];
  const svcIds = await seedServices(db, uid, svcSeed);

  const firstC = await findFirstContract(db, uid);
  if (firstC) {
    const { contracts } = await import('./drizzle/schema/contracts.js');
    await db.update(contracts)
      .set({ direction: 'sale', date: sql`start_date`, contractNo: '' })
      .where(eq(contracts.id, firstC.id));
    await insertContractItemForProduct(db, firstC.id, uid, '纯棉T恤');
    await insertContractService(db, firstC.id, svcIds[0], '染色服务', 250, uid);
    await updateContractAmount(db, firstC.id);
  }

  const employeesData: [string, string, number, string][] = [['张师傅', '裁剪工', 35, '2024-03-01'], ['李师傅', '缝纫工', 30, '2024-05-15'], ['王小妹', '包装工', 25, '2025-01-10'], ['赵主管', '管理员', 45, '2023-06-01']];
  const empIds = await seedEmployees(db, uid, employeesData);
  const hours: number[] = [80, 90, 70, 80];
  await seedWorkHours(db, uid, empIds, hours, ym);

  const txns: SeedTransactionRow[] = [
    { amount: 1280, type: '销售收入', unit: '全公司', customerId: c1, date: d(2), note: '面料订单尾款' },
    { amount: 4500, type: '销售收入', unit: '销售部', customerId: c2, date: d(5), note: '成衣批发' },
    { amount: 3200, type: '销售收入', unit: '销售部', customerId: c3, date: d(8), note: '贸易出货' },
    { amount: 800, type: '现金收入', unit: '全公司', customerId: null, date: d(10), note: '零散零售' },
    { amount: 2600, type: '其他收入', unit: '全公司', customerId: null, date: d(15), note: '利息收入' },
    { amount: -8500, type: '材料采购', unit: '生产部', customerId: c1, date: d(3), note: '本月面料采购' },
    { amount: -3200, type: '委托加工', unit: '生产部', customerId: null, date: d(6), note: '外发染色加工' },
    { amount: -120, type: '杂费支出', unit: '全公司', customerId: null, date: d(4), note: '顺丰快递' },
    { amount: -380, type: '杂费支出', unit: '行政部', customerId: null, date: d(18), note: '办公用品' },
    { amount: -5200, type: '税金', unit: '全公司', customerId: null, date: d(1), note: '增值税' },
  ];
  await seedTransactions(db, uid, txns);
}

/**
 * 首次启动种子账号创建：仅当 users 表为空时创建 admin/editor 并生成完整示例数据。
 */
export async function seedAccounts(): Promise<void> {
  const db = getDb();
  const r = await db.select({ c: sql<number>`COUNT(*)` }).from(users);
  const count: number = r[0] ? Number(r[0].c) : 0;
  if (count === 0) {
    rootLogger.info('首次启动，创建种子账号与示例数据');
    const adminHash: string = bcrypt.hashSync('admin123', 10);
    const editorHash: string = bcrypt.hashSync('editor123', 10);
    await db.insert(users).values([
      { username: 'admin', passwordHash: adminHash, displayName: '系统管理员', role: 'admin' },
      { username: 'editor', passwordHash: editorHash, displayName: '数据录入员', role: 'admin' },
    ]);
    const admin = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin')).limit(1).then((rows) => rows[0]);
    const editor = await db.select({ id: users.id }).from(users).where(eq(users.username, 'editor')).limit(1).then((rows) => rows[0]);
    if (admin) await seedForUser(admin.id, 'full');
    if (editor) await seedForUser(editor.id, 'full');
    rootLogger.info('种子账号与示例数据初始化完成');
  } else {
    rootLogger.info('数据库已存在账号，跳过账号创建（示例数据按 owner 隔离）');
  }
}
