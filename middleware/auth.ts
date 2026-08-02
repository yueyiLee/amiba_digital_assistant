/**
 * middleware/auth.ts — JWT 认证中间件
 * PRD 22.2 身份认证：Demo 阶段原未实现，本版新增 JWT 认证。
 * - requireAuth：校验 Authorization: Bearer <token>
 * - requireRole(...roles)：角色权限中间件（已弃用，保留兼容，所有登录用户均放行）
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { rootLogger } from '../logger';

// JWT 密钥：必须来自环境变量。注意 ESM 下 import 会被提升，
// 模块顶层代码早于 main 入口的 dotenv.config() 执行，因此不能在
// 顶层缓存 process.env.JWT_SECRET，而要在调用时实时读取。
const JWT_EXPIRES = '7d';

/**
 * 启动期/运行期校验 JWT_SECRET 是否已配置。
 * 实时从 process.env 读取，缺失时抛出明确错误，杜绝可伪造 token（保留 I1 安全语义）。
 */
export function ensureJwtSecret(): string {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    rootLogger.fatal('缺少环境变量 JWT_SECRET，无法安全签发/校验 token，服务已拒绝启动');
    throw new Error('[auth] 缺少环境变量 JWT_SECRET，无法安全签发/校验 token，服务已拒绝启动。');
  }
  return secret;
}

export interface JwtPayload {
  id: number;
  username: string;
  role: string;
  display_name: string;
  company_name: string;
}

function signToken(user: JwtPayload): string {
  const secret = ensureJwtSecret();
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role || 'admin',
      display_name: user.display_name,
      company_name: user.company_name || '',
    },
    secret,
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
    const secret = ensureJwtSecret();
    req.user = jwt.verify(token, secret) as JwtPayload;
    next();
  } catch (e: unknown) {
    const errMsg = (e as Error).name === 'TokenExpiredError' ? 'token 已过期' : 'token 校验失败';
    req.log.warn({ err: e }, `认证失败: ${errMsg}`);
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

export { signToken, requireAuth, requireRole };
