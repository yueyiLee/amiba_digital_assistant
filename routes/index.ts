/**
 * routes/index.ts — 业务 API 路由汇总入口
 *
 * 将原来的单体大文件拆分为按模块划分的路由文件：
 *   - transactions.ts    收支流水 / 支出项预设 / 收支类型
 *   - products.ts        商品管理
 *   - customers.ts       客户管理
 *   - inventory.ts       库存管理
 *   - settings-categories.ts  设置 / 商品分类
 *   - employees.ts       员工管理
 *   - contracts-services.ts   合同 / 服务
 *   - workhours-salaries.ts   月度工时 / 工资
 *   - analysis.ts        分析驾驶舱 / 客户分析 / 商品分析 / 合同分析 / 费用分析 / 阿米巴核算
 *
 * 本文件保留：
 *   - init/sample 重置示例数据
 *   - contracts/suggest 候选合同推荐
 *   - 所有子路由的挂载
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { seedForUser } from '../seed';
import { requireAuth } from '../middleware/auth';
import { ok, failErr } from './lib/helpers';

// 导入子路由模块
import transactionsRouter from './transactions';
import productsRouter from './products';
import customersRouter from './customers';
import inventoryRouter from './inventory';
import settingsCategoriesRouter from './settings-categories';
import employeesRouter from './employees';
import contractsServicesRouter from './contracts-services';
import workhoursSalariesRouter from './workhours-salaries';
import analysisRouter from './analysis';

const router: Router = express.Router();
router.use(requireAuth);

// 挂载子路由
router.use(transactionsRouter);
router.use(productsRouter);
router.use(customersRouter);
router.use(inventoryRouter);
router.use(settingsCategoriesRouter);
router.use(employeesRouter);
router.use(contractsServicesRouter);
router.use(workhoursSalariesRouter);
router.use(analysisRouter);

/* ========== init 重置示例数据 ========== */
router.post('/init/sample', async (req: Request, res: Response) => {
  try {
    const uid: number = req.user!.id;
    req.log.info({ userId: uid }, '开始重置示例数据');
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
    await seedForUser(uid, 'full');
    req.log.info({ userId: uid }, '示例数据重置完成');
    ok(res, { success: true, message: '示例数据已重置' });
  } catch (e: unknown) { failErr(res, e); }
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
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
