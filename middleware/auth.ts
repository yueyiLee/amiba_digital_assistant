/**
 * middleware/auth.ts — JWT 认证中间件
 * PRD 22.2 身份认证：Demo 阶段原未实现，本版新增 JWT 认证。
 * - requireAuth：校验 Authorization: Bearer <token>
 * - requireRole(...roles)：角色权限中间件（已弃用，保留兼容，所有登录用户均放行）
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

// JWT 密钥：优先读环境变量，未配置时用默认值（仅本地开发）
const JWT_SECRET: string = process.env.JWT_SECRET || 'amoeba-demo-secret-2026';
const JWT_EXPIRES = '7d';

export interface JwtPayload {
  id: number;
  username: string;
  role: string;
  display_name: string;
  company_name: string;
}

function signToken(user: JwtPayload): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role || 'admin',
      display_name: user.display_name,
      company_name: user.company_name || '',
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header: string = req.headers.authorization || '';
  const token: string | null = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: '未登录，请先登录' });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    // 兼容旧 token：无 role 或旧角色统一视为 admin
    if (!req.user.role || req.user.role !== 'admin') req.user.role = 'admin';
    next();
  } catch (e: unknown) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireRole(..._roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: '未登录' });
      return;
    }
    // 数据隔离已按 owner_id 实现，不再区分角色，所有登录用户均放行
    next();
  };
}

export { signToken, requireAuth, requireRole, JWT_SECRET };
