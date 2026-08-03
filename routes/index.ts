/**
 * routes/index.ts — 业务 API 路由汇总入口（Drizzle ORM 版）
 *
 * 保留：
 *   - init/sample 重置示例数据
 *   - contracts/suggest 候选合同推荐
 *   - 所有子路由的挂载
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import { deleteAllByOwner } from '../drizzle/queries/transactions.queries.js';
import { suggestContracts } from '../drizzle/queries/contracts.queries.js';
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
    await deleteAllByOwner(getDb(), uid);
    await seedForUser(uid, 'full');
    req.log.info({ userId: uid }, '示例数据重置完成');
    ok(res, { success: true, message: '示例数据已重置' });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== 候选合同推荐 ========== */
router.get('/contracts/suggest', async (req: Request, res: Response) => {
  try {
    const { direction, customer_id, date } = req.query as Record<string, string | undefined>;
    const rows = await suggestContracts(getDb(), req.user!.id, {
      direction: direction as string | undefined,
      customerId: customer_id ? Number(customer_id) : undefined,
    });
    const list: Record<string, unknown>[] = rows.map((co) => {
      const names: string[] = [];
      if (co.prodNames) (co.prodNames as string).split(',').forEach((n: string) => n && names.push(n));
      if (co.svcNames) (co.svcNames as string).split(',').forEach((n: string) => n && names.push(n));
      const d: string = co.date || '';
      const display_name: string = names.length
        ? `${d}-${co.customerName || '—'}-${names[0]}${names.length > 1 ? '等' : ''}`
        : `${d}-${co.customerName || '—'}`;
      return { id: co.id, display_name, date: d, direction: co.direction, customer_name: co.customerName };
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
