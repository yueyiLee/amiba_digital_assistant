/**
 * server.ts — 阿米巴经营数字助手 Express 主服务
 * 技术栈：Node.js + Express + PostgreSQL（pg 连接池）
 * 认证：JWT 身份认证 + 用户管理
 */
import dotenv from 'dotenv';
dotenv.config();

import { ensureJwtSecret } from './middleware/auth.js';
// 启动期校验：JWT_SECRET 缺失则明确拒绝启动（保留 I1 安全语义，且 dotenv 已加载）
ensureJwtSecret();

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import * as db from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import businessRoutes from './routes/index.js';
import exchangeRoutes from './routes/exchange.js';
import aiRoutes from './routes/ai.js';
import * as apiClient from './ai/api-client.js';
import { rootLogger, requestLogger } from './logger.js';

const app: Express = express();

// 注入 Express app 到 AI apiClient（工具通过它调用已有 RESTful API）
apiClient.setApp(app);
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(requestLogger); // 必须在其他中间件之前，为每个请求生成 requestId
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（无需认证，需在业务路由前注册）
app.get('/api/health', (_req: Request, res: Response) => {
  const s = (db.getStatus ? db.getStatus() : { ready: false, error: null });
  res.json({
    status: s.ready ? 'ok' : (s.error ? 'degraded' : 'starting'),
    time: new Date().toISOString(),
    db: s,
    diag: db.getDiag ? db.getDiag() : null,
  });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api', businessRoutes);

// AI 对话路由（需在 businessRoutes 之后，避免 /api/ai 被 /api/* 兜底）
app.use('/api/ai', aiRoutes);

// SPA 兜底：非 API 请求返回 index.html
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: '接口不存在' });
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, '未捕获的服务器错误');
  const isProduction: boolean = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProduction ? '服务器内部错误' : (err.message || '服务器内部错误') });
});

// 全局未捕获异常处理，避免进程因未处理的 Promise rejection 退出
process.on('unhandledRejection', (reason: unknown) => {
  rootLogger.error({ err: reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err: Error) => {
  rootLogger.error({ err }, 'uncaughtException');
  // 严重错误可能需要优雅退出，此处保守地仅记录日志
  process.exitCode = 1;
});

// 启动：先监听端口（保证 SCF HTTP 探测不会因 9000 无监听而返回 443），再后台初始化数据库
function start(): void {
  app.listen(PORT, '0.0.0.0', () => {
    rootLogger.info({ port: PORT }, '阿米巴经营数字助手 已启动（PostgreSQL）');
  });
  // 后台初始化；失败时仅记录，不退出进程（避免端口 9000 无监听导致 443）
  db.init().catch((e: Error) => rootLogger.error({ err: e }, 'db.init 异常'));
}

start();
