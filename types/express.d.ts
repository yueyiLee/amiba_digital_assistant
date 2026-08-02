/**
 * Express Request 接口扩展
 * 添加 JWT 认证中间件注入的 user 属性，以及日志中间件注入的 log 属性
 */
import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
        display_name: string;
        company_name: string;
      };
      /** 请求级子 logger，由 requestLogger 中间件注入 */
      log: Logger;
    }
  }
}

// 确保文件被视为模块（而非全局脚本）
export {};
