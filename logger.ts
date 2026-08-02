/**
 * logger.ts — 统一结构化日志模块
 * 基于 pino：开发环境输出人类可读格式（pino-pretty），生产环境输出 JSON。
 * 通过 Express 中间件为每个请求生成 requestId，贯穿请求生命周期。
 */
import pino, { Logger } from 'pino';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const isProduction: boolean = process.env.NODE_ENV === 'production';
const level: string = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

/**
 * 创建 logger 实例
 * 非生产环境尝试使用 pino-pretty 美化输出，若不可用（如 --omit=dev 安装）则降级为纯 JSON
 */
function createLogger(): Logger {
  if (isProduction) {
    return pino({ level });
  }
  try {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  } catch {
    // pino-pretty 不可用时降级为纯 JSON 输出
    return pino({ level });
  }
}

/**
 * 根 logger 实例
 * 非请求上下文（db.ts、seed.ts 等）直接使用此实例
 */
const rootLogger: Logger = createLogger();

/**
 * Express 中间件：为每个请求生成唯一 requestId，并挂载子 logger 到 req.log
 * 必须在其他中间件之前注册
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId: string = randomUUID();
  const startTime: number = Date.now();
  req.log = rootLogger.child({ requestId });
  res.setHeader('X-Request-Id', requestId);

  // 请求完成时记录方法、路径、状态码与耗时
  res.on('finish', () => {
    req.log.info({
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: Date.now() - startTime,
    }, '请求完成');
  });

  next();
}

export { rootLogger, requestLogger };
