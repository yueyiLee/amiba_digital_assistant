/**
 * routes/users.js — 用户管理路由（CRUD + 重置密码 + 角色管理）
 * PRD 新增功能：用户管理，提供用户名和密码的登录方式。
 * 仅 admin 角色可操作用户管理。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// 所有用户管理接口均需登录 + admin 角色
router.use(requireAuth, requireRole('admin'));

// 用户列表
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT id, username, display_name, role, created_at FROM users ORDER BY id`
  ).all();
  res.json(rows);
});

// 新增用户
router.post('/', (req, res) => {
  const { username, password, display_name, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: '角色无效（admin/editor/viewer）' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users(username, password_hash, display_name, role) VALUES(?,?,?,?)'
  ).run(username, hash, display_name || username, role || 'viewer');
  res.json({
    id: info.lastInsertRowid, username, display_name: display_name || username, role: role || 'viewer'
  });
});

// 修改用户（角色 / 显示名）
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { display_name, role } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  // 不允许删除/降级最后一个管理员
  if (role && role !== 'admin' && user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get();
    if (adminCount.c <= 1) {
      return res.status(400).json({ error: '至少保留一个管理员，无法降级' });
    }
  }
  if (role && !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: '角色无效' });
  }
  db.prepare('UPDATE users SET display_name=?, role=? WHERE id=?')
    .run(display_name ?? user.display_name, role || user.role, id);
  res.json({ success: true });
});

// 重置密码
router.put('/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
  res.json({ success: true, message: '密码重置成功' });
});

// 删除用户
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: '不能删除当前登录用户' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get();
    if (adminCount.c <= 1) {
      return res.status(400).json({ error: '至少保留一个管理员，无法删除' });
  }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
