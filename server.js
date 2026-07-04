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

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（无需认证，需在业务路由前注册）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api', businessRoutes);

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

// 启动：先初始化数据库，再监听端口
async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`\n  ◎ 阿米巴经营数字助手 已启动（PostgreSQL）`);
      console.log(`  → 本地访问: http://localhost:${PORT}`);
      console.log(`  → 默认管理员: admin / admin123`);
      console.log(`  → 录入员账号: editor / editor123\n`);
    });
  } catch (e) {
    console.error('[启动失败]', e.message);
    process.exit(1);
  }
}

start();
