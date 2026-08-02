/**
 * routes/employees.ts — 员工管理
 */
import express, { Router, Request, Response } from 'express';
import * as db from '../db';
import { ok, fail400, fail404, failErr } from './lib/helpers';

const router: Router = express.Router();

router.get('/employees', async (req: Request, res: Response) => {
  try { ok(res, await db.queryAll('SELECT * FROM employees WHERE owner_id=$1 ORDER BY id DESC', [req.user!.id])); }
  catch (e: unknown) { failErr(res, e); }
});

router.post('/employees', async (req: Request, res: Response) => {
  try {
    const { name, position, hourly_rate, join_date, status, leave_date } = (req.body || {}) as Record<string, unknown>;
    if (!name) { fail400(res, '姓名必填'); return; }
    if (hourly_rate == null || (hourly_rate as number) <= 0) { fail400(res, '时薪必须大于 0'); return; }
    const result = await db.insertReturning(
      'INSERT INTO employees(name,position,hourly_rate,join_date,status,leave_date,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, (position as string) || '', hourly_rate, (join_date as string) || '', (status as string) || 'active', (leave_date as string) || '', req.user!.id]
    );
    const newId: number = result.rows[0].id as number;
    const today: string = new Date().toISOString().slice(0, 10);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId, 'active', '入职', (position as string) || '', (hourly_rate as number) || 0, (join_date as string) || today, '新增入职', req.user!.id]
    );
    ok(res, { id: newId });
  } catch (e: unknown) { failErr(res, e); }
});

router.put('/employees/:id', async (req: Request, res: Response) => {
  try {
    const e = (req.body || {}) as Record<string, unknown>;
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '员工不存在'); return; }
    await db.query('UPDATE employees SET name=$1,position=$2,hourly_rate=$3,join_date=$4,leave_date=$5 WHERE id=$6 AND owner_id=$7',
      [(e.name as string) ?? old.name, (e.position as string) ?? old.position, (e.hourly_rate as number) ?? old.hourly_rate, (e.join_date as string) ?? old.join_date, (e.leave_date as string) ?? (old.leave_date as string) ?? '', req.params.id, req.user!.id]);
    const needUpdateHistory: boolean = e.position !== undefined || e.hourly_rate !== undefined || e.join_date !== undefined;
    if (needUpdateHistory) {
      await db.query(
        `UPDATE employee_status_history h
         SET position = COALESCE($1, h.position), hourly_rate = COALESCE($2, h.hourly_rate), changed_date = COALESCE($3, h.changed_date)
         WHERE h.id = (
           SELECT id FROM employee_status_history
           WHERE employee_id=$4 AND owner_id=$5 AND status='active'
           ORDER BY changed_date DESC, id DESC LIMIT 1
         )`,
        [e.position !== undefined ? ((e.position as string) || '') : null,
        e.hourly_rate !== undefined ? ((e.hourly_rate as number) || 0) : null,
        e.join_date !== undefined ? ((e.join_date as string) || '') : null,
        Number(req.params.id), req.user!.id]
      );
    }
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.get('/employees/:id/status-history', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 ORDER BY changed_date ASC, id ASC',
      [req.params.id, req.user!.id]
    );
    ok(res, rows);
  } catch (e: unknown) { failErr(res, e); }
});

router.get('/employee-status-history-all', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, employee_id, status, change_type, position, hourly_rate, changed_date, note, created_at FROM employee_status_history WHERE owner_id=$1 ORDER BY employee_id ASC, changed_date ASC, id ASC',
      [req.user!.id]
    );
    ok(res, rows);
  } catch (e: unknown) { failErr(res, e); }
});

router.patch('/employees/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, leave_date, note, position, hourly_rate, changed_date } = (req.body || {}) as Record<string, unknown>;
    if (!status || !['active', 'left'].includes(status as string)) { fail400(res, 'status 必须是 active 或 left'); return; }
    const old = await db.queryOne('SELECT * FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!old) { fail404(res, '员工不存在'); return; }
    const today: string = new Date().toISOString().slice(0, 10);
    const changedDate: string = status === 'left'
      ? ((leave_date as string) || (changed_date as string) || (old.leave_date as string) || today)
      : ((changed_date as string) || today);
    const newLeave: string = status === 'left' ? changedDate : '';
    const changeType: string = ((old.status as string) || 'active') === 'left' ? '复职' : '离职';
    const snapPos: string = (position !== undefined && position !== null) ? (position as string) : ((old.position as string) || '');
    const snapRate: number = (hourly_rate !== undefined && hourly_rate !== null) ? (hourly_rate as number) : ((old.hourly_rate as number) || 0);

    const hasHistory = await db.queryOne('SELECT 1 FROM employee_status_history WHERE employee_id=$1 AND owner_id=$2 LIMIT 1', [req.params.id, req.user!.id]);
    if (!hasHistory) {
      const startDate: string = (old.join_date as string) || changedDate;
      await db.query(
        'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.params.id, 'active', '入职', (old.position as string) || '', (old.hourly_rate as number) || 0, startDate, '系统自动补全入职状态', req.user!.id]
      );
    }

    await db.query('UPDATE employees SET status=$1, leave_date=$2 WHERE id=$3 AND owner_id=$4',
      [status, newLeave, req.params.id, req.user!.id]);
    await db.query(
      'INSERT INTO employee_status_history(employee_id,status,change_type,position,hourly_rate,changed_date,note,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id, status, changeType, status === 'left' ? '' : snapPos, status === 'left' ? 0 : snapRate, changedDate, (note as string) || '', req.user!.id]
    );
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

router.delete('/employees/:id', async (req: Request, res: Response) => {
  try {
    const exist = await db.queryOne('SELECT id FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    if (!exist) { fail404(res, '员工不存在'); return; }
    await db.query('DELETE FROM employees WHERE id=$1 AND owner_id=$2', [req.params.id, req.user!.id]);
    ok(res, { success: true });
  } catch (e: unknown) { failErr(res, e); }
});

export = router;
