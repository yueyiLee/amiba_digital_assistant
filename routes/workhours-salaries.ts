/**
 * routes/workhours-salaries.ts — 月度工时与工资管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

/* ========== workhours 月度工时 ========== */
router.get('/workhours', async (req: Request, res: Response) => {
  try {
    const { month } = req.query as Record<string, string | undefined>;
    let sql = 'SELECT wh.*, e.name AS employee_name, e.hourly_rate FROM work_hours wh JOIN employees e ON wh.employee_id=e.id WHERE wh.owner_id=$1';
    const params: unknown[] = [req.user!.id];
    if (month) { sql += ' AND wh.month=$2'; params.push(month); }
    ok(res, await db.queryAll(sql, params));
  } catch (e: unknown) { failErr(res, e); }
});

router.post('/workhours', async (req: Request, res: Response) => {
  try {
    const { employee_id, hours, month } = (req.body || {}) as Record<string, unknown>;
    if (!employee_id || hours == null || !month) { fail400(res, '员工、工时、月份必填'); return; }
    if ((hours as number) < 0) { fail400(res, '工时必须为有效正数'); return; }
    const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id as number, req.user!.id]);
    if (!emp) { fail404(res, '员工不存在'); return; }
    await db.query(
      `INSERT INTO work_hours(employee_id,hours,month,owner_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(employee_id,month) DO UPDATE SET hours=excluded.hours`,
      [employee_id, hours, month, req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/workhours/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '工时记录不存在'); return; }
    await db.query('DELETE FROM work_hours WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

/* ========== salaries 工资 ========== */
router.get('/salaries', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM salaries WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { failErr(res, e); }
});

router.post('/salaries', async (req: Request, res: Response) => {
  try {
    const { employee_id, amount, month } = (req.body || {}) as Record<string, unknown>;
    if (employee_id) {
      const emp = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [employee_id as number, req.user!.id]);
      if (!emp) { fail404(res, '员工不存在'); return; }
    }
    const result = await db.insertReturning(
      'INSERT INTO salaries(employee_id,amount,month,owner_id) VALUES($1,$2,$3,$4) RETURNING id',
      [employee_id, (amount as number) || 0, (month as string) || '', req.user!.id]
    );
    ok(res, { id: result.rows[0].id });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/salaries/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '工资记录不存在'); return; }
    await db.query('DELETE FROM salaries WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
