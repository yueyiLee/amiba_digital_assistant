/**
 * routes/users.js — 用户管理路由（PostgreSQL 版）
 * CRUD + 重置密码。所有登录用户默认拥有管理员权限，不再区分角色。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 仅 admin 超级账号可管理平台账号（依据用户名判断，稳定且不受历史 role 数据影响）
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.username !== 'admin') {
    return res.status(403).json({ error: '权限不足，仅系统管理员可管理账号' });
  }
  next();
}

// 账号管理接口：需登录 + 系统管理员
router.use(requireAuth, requireSuperAdmin);

// 用户列表
router.get('/', async (req, res) => {
  try {
    const rows = await db.queryAll(
      'SELECT id, username, display_name, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增用户
router.post('/', async (req, res) => {
  try {
    const { username, password, display_name } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    const exists = await db.queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (exists) return res.status(400).json({ error: '用户名已存在' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.insertReturning(
      'INSERT INTO users(username, password_hash, display_name, role) VALUES($1,$2,$3,$4) RETURNING id',
      [username, hash, display_name || username, 'admin'],
      'users'
    );
    const newId = result.rows[0].id;
    // 新账号初始化少量示例数据（核心表各 2-3 条），失败不影响账号创建
    try { await db.seedForUser(newId, 'sample'); }
    catch (seedErr) { console.error('[用户] 示例数据初始化失败:', seedErr.message); }
    res.json({
      id: newId, username, display_name: display_name || username, role: 'admin'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 修改用户（显示名）
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { display_name } = req.body || {};
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    await db.query('UPDATE users SET display_name=$1 WHERE id=$2',
      [display_name ?? user.display_name, id]);
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

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
