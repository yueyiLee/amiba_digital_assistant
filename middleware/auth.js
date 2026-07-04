/**
 * middleware/auth.js — JWT 认证中间件
 * PRD 22.2 身份认证：Demo 阶段原未实现，本版新增 JWT 认证。
 * - requireAuth：校验 Authorization: Bearer <token>
 * - requireRole(...roles)：校验角色权限（admin/editor/viewer）
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'amoeba-demo-secret-2026';
const JWT_EXPIRES = '7d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
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
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足，需要 ' + roles.join('/') + ' 角色' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
