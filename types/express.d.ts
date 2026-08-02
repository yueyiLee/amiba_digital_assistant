/**
 * Express Request 接口扩展
 * 添加 JWT 认证中间件注入的 user 属性
 */
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
    }
  }
}

// 确保文件被视为模块（而非全局脚本）
export {};
