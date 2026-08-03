/**
 * routes/users.ts — 用户管理路由（Drizzle ORM 版）
 * CRUD + 重置密码。所有登录用户默认拥有管理员权限，不再区分角色。
 */
import express, { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../drizzle/db.js';
import {
  listUsers, usernameExists, createUser, updateUser,
  resetPassword, deleteUser,
} from '../drizzle/queries/users.queries.js';
import { findUserById } from '../drizzle/queries/auth.queries.js';
import { seedForUser } from '../seed';
import { requireAuth } from '../middleware/auth';

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
    const rows = await listUsers(getDb());
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

    const exists = await usernameExists(getDb(), username);
    if (exists) {
      res.status(400).json({ error: '用户名已存在' });
      return;
    }

    const hash: string = bcrypt.hashSync(password, 10);
    const result = await createUser(getDb(), {
      username,
      passwordHash: hash,
      displayName: display_name || username,
      companyName: String(company_name).trim(),
      role: 'admin',
    });
    const newId: number = result[0].id;
    try { await seedForUser(newId, 'sample'); }
    catch (seedErr: unknown) { req.log.warn({ err: seedErr, userId: newId }, '新用户示例数据初始化失败'); }
    req.log.info({ createdUserId: newId, createdUsername: username }, '管理员创建了新用户');
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
    const user = await findUserById(getDb(), id);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    if (company_name !== undefined && !String(company_name).trim()) {
      res.status(400).json({ error: '企业名称不能为空' });
      return;
    }

    const updates: { displayName?: string; companyName?: string } = {};
    if (display_name !== undefined) updates.displayName = display_name;
    if (company_name !== undefined) updates.companyName = String(company_name).trim();
    if (Object.keys(updates).length === 0) { res.json({ success: true }); return; }
    await updateUser(getDb(), id, updates);
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
    const user = await findUserById(getDb(), id);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    const hash: string = bcrypt.hashSync(newPassword, 10);
    await resetPassword(getDb(), id, hash);
    req.log.info({ targetUserId: id }, '管理员重置了用户密码');
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
    const user = await findUserById(getDb(), id);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    await deleteUser(getDb(), id);
    req.log.info({ deletedUserId: id, deletedUsername: user.username }, '管理员删除了用户');
    res.json({ success: true });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

export = router;
