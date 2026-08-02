/**
 * routes/users.ts — 用户管理路由（PostgreSQL 版）
 * CRUD + 重置密码。所有登录用户默认拥有管理员权限，不再区分角色。
 */
import express, { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import * as db from '../db';
import { requireAuth } from '../middleware/auth';
import type { UserRow } from '../types/db';

const router: Router = express.Router();

// 仅 admin 超级账号可管理平台账号
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.username !== 'admin') {
    res.status(403).json({ error: '权限不足，仅系统管理员可管理账号' });
    return;
  }
  next();
}

router.use(requireAuth, requireSuperAdmin);

// 用户列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, username, display_name, company_name, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 新增用户
router.post('/', async (req: Request, res: Response) => {
  try {
    const { username, password, display_name, company_name } = (req.body || {}) as {
      username?: string; password?: string; display_name?: string; company_name?: string;
    };
    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码必填' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码至少 6 位' });
      return;
    }
    if (!company_name || !String(company_name).trim()) {
      res.status(400).json({ error: '企业名称必填' });
      return;
    }

    const exists = await db.queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (exists) {
      res.status(400).json({ error: '用户名已存在' });
      return;
    }

    const hash: string = bcrypt.hashSync(password, 10);
    const result = await db.insertReturning(
      'INSERT INTO users(username, password_hash, display_name, company_name, role) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [username, hash, display_name || username, String(company_name).trim(), 'admin']
    );
    const newId: number = result.rows[0].id as number;
    try { await db.seedForUser(newId, 'sample'); }
    catch (seedErr: unknown) { console.error('[用户] 示例数据初始化失败:', (seedErr as Error).message); }
    res.json({
      id: newId, username, display_name: display_name || username, company_name: String(company_name).trim(), role: 'admin',
    });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 修改用户
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id: number = Number(req.params.id);
    const { display_name, company_name } = (req.body || {}) as { display_name?: string; company_name?: string };
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (display_name !== undefined) {
      updates.push(`display_name=$${p++}`);
      params.push(display_name);
    }
    if (company_name !== undefined) {
      const trimmed: string = String(company_name).trim();
      if (!trimmed) {
        res.status(400).json({ error: '企业名称不能为空' });
        return;
      }
      updates.push(`company_name=$${p++}`);
      params.push(trimmed);
    }
    if (updates.length === 0) { res.json({ success: true }); return; }
    params.push(id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id=$${p}`, params);
    res.json({ success: true });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 重置密码
router.put('/:id/password', async (req: Request, res: Response) => {
  try {
    const id: number = Number(req.params.id);
    const { newPassword } = (req.body || {}) as { newPassword?: string };
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: '新密码至少 6 位' });
      return;
    }
    const user = await db.queryOne('SELECT id FROM users WHERE id = $1', [id]);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    const hash: string = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
    res.json({ success: true, message: '密码重置成功' });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 删除用户
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id: number = Number(req.params.id);
    if (id === req.user!.id) {
      res.status(400).json({ error: '不能删除当前登录用户' });
      return;
    }
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

export = router;
