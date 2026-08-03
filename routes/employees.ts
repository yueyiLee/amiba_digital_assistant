/**
 * routes/employees.ts — 员工管理（Drizzle ORM 版）
 */
import express, { Router, Request, Response } from 'express';
import { getDb } from '../drizzle/db.js';
import {
  listEmployees, findEmployeeById, createEmployee, updateEmployee,
  updateEmployeeStatus, deleteEmployee,
  getStatusHistory, getAllStatusHistory, hasStatusHistory,
  createStatusHistory, updateLatestStatusHistory,
} from '../drizzle/queries/employees.queries.js';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/employees', async (req: Request, res: Response) => {
  try { ok(res, await listEmployees(getDb(), req.user!.id)); }
  catch (e: unknown) { failErr(res, e); }
});

router.post('/employees', async (req: Request, res: Response) => {
  try {
    const { name, position, hourly_rate, join_date, status, leave_date } = (req.body || {}) as Record<string, unknown>;
    if (!name) { fail400(res, '姓名必填'); return; }
    if (hourly_rate == null || (hourly_rate as number) <= 0) { fail400(res, '时薪必须大于 0'); return; }
    const result = await createEmployee(getDb(), {
      name: name as string,
      position: (position as string) || '',
      hourlyRate: hourly_rate as number,
      joinDate: (join_date as string) || '',
      status: (status as string) || 'active',
      leaveDate: (leave_date as string) || '',
      ownerId: req.user!.id,
    });
    const newId: number = result[0].id;
    const today: string = new Date().toISOString().slice(0, 10);
    await createStatusHistory(getDb(), {
      employeeId: newId, status: 'active', changeType: '入职',
      position: (position as string) || '', hourlyRate: (hourly_rate as number) || 0,
      changedDate: (join_date as string) || today, note: '新增入职', ownerId: req.user!.id,
    });
    ok(res, { id: newId });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/employees/:id', async (req: Request, res: Response) => {
  try {
    const e = (req.body || {}) as Record<string, unknown>;
    const old = await findEmployeeById(getDb(), Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '员工不存在'); return; }
    await updateEmployee(getDb(), Number(req.params.id), req.user!.id, {
      name: e.name !== undefined ? (e.name as string) : undefined,
      position: e.position !== undefined ? (e.position as string) : undefined,
      hourlyRate: e.hourly_rate !== undefined ? (e.hourly_rate as number) : undefined,
      joinDate: e.join_date !== undefined ? (e.join_date as string) : undefined,
      leaveDate: e.leave_date !== undefined ? (e.leave_date as string) : undefined,
    });
    const needUpdateHistory: boolean = e.position !== undefined || e.hourly_rate !== undefined || e.join_date !== undefined;
    if (needUpdateHistory) {
      // 子查询 WHERE active 记录可能不存在（员工创建时已写入入职记录，正常流程一定有）
      // 若为空则 UPDATE 匹配不到任何行，属于安全的静默跳过
      await updateLatestStatusHistory(getDb(), Number(req.params.id), req.user!.id, {
        position: e.position !== undefined ? ((e.position as string) || '') : undefined,
        hourlyRate: e.hourly_rate !== undefined ? ((e.hourly_rate as number) || 0) : undefined,
        changedDate: e.join_date !== undefined ? ((e.join_date as string) || '') : undefined,
      });
    }
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.get('/employees/:id/status-history', async (req: Request, res: Response) => {
  try {
    ok(res, await getStatusHistory(getDb(), Number(req.params.id), req.user!.id));
  } catch (e: unknown) { failErr(res, e); }
});

router.get('/employee-status-history-all', async (req: Request, res: Response) => {
  try {
    ok(res, await getAllStatusHistory(getDb(), req.user!.id));
  } catch (e: unknown) { failErr(res, e); }
});

router.patch('/employees/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, leave_date, note, position, hourly_rate, changed_date } = (req.body || {}) as Record<string, unknown>;
    if (!status || !['active', 'left'].includes(status as string)) { fail400(res, 'status 必须是 active 或 left'); return; }
    const db = getDb();
    const old = await findEmployeeById(db, Number(req.params.id), req.user!.id);
    if (!old) { fail404(res, '员工不存在'); return; }
    const today: string = new Date().toISOString().slice(0, 10);
    const changedDate: string = status === 'left'
      ? ((leave_date as string) || (changed_date as string) || old.leaveDate || today)
      : ((changed_date as string) || today);
    const newLeave: string = status === 'left' ? changedDate : '';
    const changeType: string = (old.status || 'active') === 'left' ? '复职' : '离职';
    const snapPos: string = (position !== undefined && position !== null) ? (position as string) : (old.position || '');
    const snapRate: number = (hourly_rate !== undefined && hourly_rate !== null) ? (hourly_rate as number) : (old.hourlyRate || 0);

    const hasHistory = await hasStatusHistory(db, Number(req.params.id), req.user!.id);
    if (!hasHistory) {
      const startDate: string = old.joinDate || changedDate;
      await createStatusHistory(db, {
        employeeId: Number(req.params.id), status: 'active', changeType: '入职',
        position: old.position || '', hourlyRate: old.hourlyRate || 0,
        changedDate: startDate, note: '系统自动补全入职状态', ownerId: req.user!.id,
      });
    }

    await updateEmployeeStatus(db, Number(req.params.id), req.user!.id, { status: status as string, leaveDate: newLeave });
    await createStatusHistory(db, {
      employeeId: Number(req.params.id), status: status as string, changeType,
      position: status === 'left' ? '' : snapPos,
      hourlyRate: status === 'left' ? 0 : snapRate,
      changedDate: changedDate, note: (note as string) || '', ownerId: req.user!.id,
    });
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/employees/:id', async (req: Request, res: Response) => {
  try {
    const exist = await findEmployeeById(getDb(), Number(req.params.id), req.user!.id);
    if (!exist) { fail404(res, '员工不存在'); return; }
    await deleteEmployee(getDb(), Number(req.params.id), req.user!.id);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
