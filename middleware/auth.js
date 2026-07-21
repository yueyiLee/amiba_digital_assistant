/**
 * middleware/auth.js — JWT 认证中间件
 * PRD 22.2 身份认证：Demo 阶段原未实现，本版新增 JWT 认证。
 * - requireAuth：校验 Authorization: Bearer <token>
 * - requireRole(...roles)：角色权限中间件（已弃用，保留兼容，所有登录用户均放行）
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'amoeba-demo-secret-2026';
const JWT_EXPIRES = '7d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'admin', display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录，请先登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // 兼容旧 token：无 role 或旧角色统一视为 admin
    if (!req.user.role || req.user.role !== 'admin') req.user.role = 'admin';
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    // 数据隔离已按 owner_id 实现，不再区分角色，所有登录用户均放行
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
