/**
 * server.js — 阿米巴经营数字助手 Express 主服务
 * 技术栈：Node.js + Express + PostgreSQL（pg 连接池）
 * 认证：JWT 身份认证 + 用户管理
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const businessRoutes = require('./routes/index');
const exchangeRoutes = require('./routes/exchange');
const aiRoutes = require('./routes/ai');
const apiClient = require('./ai/api-client');

const app = express();

// 注入 Express app 到 AI apiClient（工具通过它调用已有 RESTful API）
apiClient.setApp(app);
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（无需认证，需在业务路由前注册）
app.get('/api/health', (req, res) => {
  const s = (db.getStatus ? db.getStatus() : { ready: false, error: null });
  res.json({
    status: s.ready ? 'ok' : (s.error ? 'degraded' : 'starting'),
    time: new Date().toISOString(),
    db: s
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
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 启动：先监听端口（保证 SCF HTTP 探测不会因 9000 无监听而返回 443），再后台初始化数据库
function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ◎ 阿米巴经营数字助手 已启动（PostgreSQL）`);
    console.log(`  → 监听: http://0.0.0.0:${PORT}\n`);
  });
  // 后台初始化；失败时仅记录，不退出进程（避免端口 9000 无监听导致 443）
  db.init().catch((e) => console.error('[启动] db.init 异常:', e.message));
}

start();
