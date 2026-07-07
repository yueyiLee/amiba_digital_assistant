/**
 * routes/users.js — 用户管理路由（PostgreSQL 版）
 * CRUD + 重置密码 + 角色管理，仅 admin 角色可操作。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// 所有用户管理接口均需登录 + admin 角色
router.use(requireAuth, requireRole('admin'));

// 用户列表
router.get('/', async (req, res) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, username, display_name, role, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增用户
router.post('/', async (req, res) => {
  try {
    const { username, password, display_name, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: '角色无效（admin/editor/viewer）' });

    const exists = await db.queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (exists) return res.status(400).json({ error: '用户名已存在' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.insertReturning(
      'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4) RETURNING id',
      [username, hash, display_name || username, role || 'viewer'],
      'users'
    );
    res.json({
      id: result.rows[0].id, username, display_name: display_name || username, role: role || 'viewer'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 修改用户（角色 / 显示名）
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { display_name, role } = req.body || {};
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 不允许降级最后一个管理员
    if (role && role !== 'admin' && user.role === 'admin') {
      const adminCount = await db.queryOne("SELECT COUNT(*) as c FROM users WHERE role='admin'");
      if (parseInt(adminCount.c) <= 1) {
        return res.status(400).json({ error: '至少保留一个管理员，无法降级' });
      }
    }
    if (role && !['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: '角色无效' });
    }

    await db.query('UPDATE users SET display_name=$1, role=$2 WHERE id=$3',
      [display_name ?? user.display_name, role || user.role, id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重置密码
router.put('/:id/password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const user = await db.queryOne('SELECT id FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const hash = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
    res.json({ success: true, message: '密码重置成功' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除用户
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: '不能删除当前登录用户' });
    }
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    if (user.role === 'admin') {
      const adminCount = await db.queryOne("SELECT COUNT(*) as c FROM users WHERE role='admin'");
      if (parseInt(adminCount.c) <= 1) {
        return res.status(400).json({ error: '至少保留一个管理员，无法删除' });
      }
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
