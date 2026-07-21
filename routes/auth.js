/**
 * routes/auth.js — 认证路由：登录 / 当前用户 / 修改密码（PostgreSQL 版）
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const user = await db.queryOne('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: 'admin' }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取当前用户
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// 修改密码
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请输入原密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
      return res.status(400).json({ error: '原密码错误' });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ success: true, message: '密码修改成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
