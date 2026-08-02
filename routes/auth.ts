/**
 * routes/auth.ts — 认证路由：登录 / 当前用户 / 修改密码（PostgreSQL 版）
 */
import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import * as db from '../db';
import { signToken, requireAuth } from '../middleware/auth';
import type { UserRow } from '../types/db';

const router: Router = express.Router();

// 登录
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: '请输入用户名和密码' });
      return;
    }
    const user = await db.queryOne('SELECT * FROM users WHERE username = $1', [username]) as UserRow | null;
    if (!user) {
      req.log.warn({ username }, '登录失败：用户不存在');
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      req.log.warn({ username, userId: user.id }, '登录失败：密码错误');
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }
    const token: string = signToken({
      id: user.id,
      username: user.username,
      role: 'admin',
      display_name: user.display_name,
      company_name: user.company_name || '',
    });
    req.log.info({ username, userId: user.id }, '用户登录成功');
    res.json({
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, company_name: user.company_name || '', role: 'admin' },
    });
  } catch (e: unknown) {
    req.log.error({ err: e }, '登录处理异常');
    res.status(500).json({ error: (e as Error).message });
  }
});

// 获取当前用户
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// 修改密码
router.put('/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = (req.body || {}) as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: '请输入原密码和新密码' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: '新密码至少 6 位' });
      return;
    }
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [req.user!.id]) as UserRow | null;
    if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
      req.log.warn({ userId: req.user!.id }, '密码修改失败：原密码错误');
      res.status(400).json({ error: '原密码错误' });
      return;
    }
    const hash: string = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user!.id]);
    req.log.info({ userId: req.user!.id }, '密码修改成功');
    res.json({ success: true, message: '密码修改成功' });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export = router;
