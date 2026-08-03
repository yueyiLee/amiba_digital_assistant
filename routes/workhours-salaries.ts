/**
 * routes/workhours-salaries.ts — 月度工时与工资管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import { findEmployeeById } from '../drizzle/queries/employees.queries.js';
import {
  listWorkHours, findWorkHourById, upsertWorkHour, deleteWorkHour,
  listSalaries, createSalary, deleteSalary,
} from '../drizzle/queries/employees.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== workhours 月度工时 ========== */
router.get('/workhours', async (req: Request, res: Response) => {
  try {
    const { month } = req.query as Record<string, string | undefined>;
    ok(res, await listWorkHours(getDb(), req.user!.id, month));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/workhours', async (req: Request, res: Response) => {
  try {
    const { employee_id, hours, month } = (req.body || {}) as Record<string, unknown>;
    if (!employee_id || hours == null || !month) { fail400(res, '员工、工时、月份必填'); return; }
    if ((hours as number) < 0) { fail400(res, '工时必须为有效正数'); return; }
    const emp = await findEmployeeById(getDb(), employee_id as number, req.user!.id);
    if (!emp) { fail404(res, '员工不存在'); return; }
    await upsertWorkHour(getDb(), {
      employeeId: employee_id as number, hours: hours as number,
      month: month as string, ownerId: req.user!.id,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/workhours/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findWorkHourById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '工时记录不存在'); return; }
    await deleteWorkHour(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== salaries 工资 ========== */
router.get('/salaries', async (req: Request, res: Response) => {
  try { ok(res, await listSalaries(getDb(), req.user!.id)); }
  catch (e: unknown) { failErr(res, e); }
});

router.post('/salaries', async (req: Request, res: Response) => {
  try {
    const { employee_id, amount, month } = (req.body || {}) as Record<string, unknown>;
    if (employee_id) {
      const emp = await findEmployeeById(getDb(), employee_id as number, req.user!.id);
      if (!emp) { fail404(res, '员工不存在'); return; }
    }
    const result = await createSalary(getDb(), {
      employeeId: employee_id as number, amount: (amount as number) || 0,
      month: (month as string) || '', ownerId: req.user!.id,
    });
    ok(res, { id: result[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/salaries/:id', async (req: Request, res: Response) => {
  try {
    const salList = await listSalaries(getDb(), req.user!.id);
    const found = salList.find((s) => s.id === Number(req.params.id));
    if (!found) { fail404(res, '工资记录不存在'); return; }
    await deleteSalary(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
