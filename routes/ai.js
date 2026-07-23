/**
 * routes/ai.js — AI 对话路由
 * 提供两个端点：
 * 1. POST /api/ai/chat — SSE 流式对话（前端 EventSource 消费）
 * 2. POST /api/ai/chat-sync — 非流式对话（简单集成场景）
 * 所有端点需 requireAuth 认证，工具通过用户 JWT 调用已有 RESTful API。
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { converse, converseStream } = require('../ai/engine');

const router = express.Router();

// 从请求中提取 JWT token（传给工具用于调用 RESTful API）
function extractToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// SSE 流式对话
router.post('/chat', requireAuth, async (req, res) => {
  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少消息内容' });
  }

  const token = extractToken(req);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx 关闭缓冲
  });

  // 发送 SSE 事件
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('start', { userId: req.user.id });

    await converseStream(
      messages,
      { id: req.user.id, username: req.user.username, display_name: req.user.display_name },
      token,
      // onText
      (text) => sendEvent('text', { text }),
      // onToolStart
      (toolName) => sendEvent('tool_start', { name: toolName }),
      // onToolEnd
      (toolName, result) => sendEvent('tool_end', { name: toolName, success: result.success, message: result.message, data: result.data })
    );

    sendEvent('done', {});
  } catch (err) {
    console.error('[AI Chat] SSE 错误:', err.message);
    sendEvent('error', { message: err.message });
  } finally {
    res.end();
  }
});

// 非流式对话
router.post('/chat-sync', requireAuth, async (req, res) => {
  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少消息内容' });
  }

  const token = extractToken(req);

  try {
    const result = await converse(
      messages,
      { id: req.user.id, username: req.user.username, display_name: req.user.display_name },
      token
    );
    res.json(result);
  } catch (err) {
    console.error('[AI Chat] 错误:', err.message);
    res.status(500).json({ error: 'AI 服务暂时不可用：' + err.message });
  }
});

module.exports = router;
