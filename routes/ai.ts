/**
 * routes/ai.ts — AI 对话路由
 * 提供两个端点：
 * 1. POST /api/ai/chat — SSE 流式对话（前端 EventSource 消费）
 * 2. POST /api/ai/chat-sync — 非流式对话（简单集成场景）
 * 所有端点需 requireAuth 认证，工具通过用户 JWT 调用已有 RESTful API。
 */
import express, { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { converse, converseStream } from '../ai/engine.js';

const router: Router = express.Router();

// 从请求中提取 JWT token
function extractToken(req: Request): string {
  const header: string = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// SSE 流式对话
router.post('/chat', requireAuth, async (req: Request, res: Response) => {
  const { messages } = (req.body || {}) as { messages?: unknown[] };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: '缺少消息内容' });
    return;
  }

  const token: string = extractToken(req);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('start', { userId: req.user!.id });

    await converseStream(
      messages as Record<string, unknown>[],
      { id: req.user!.id, username: req.user!.username, display_name: req.user!.display_name },
      token,
      (text: string) => sendEvent('text', { text }),
      (toolName: string) => sendEvent('tool_start', { name: toolName }),
      (toolName: string, result: Record<string, unknown>) => sendEvent('tool_end', { name: toolName, success: result.success, message: result.message, data: result.data })
    );

    sendEvent('done', {});
  } catch (err: unknown) {
    req.log.error({ err }, 'AI Chat SSE 错误');
    sendEvent('error', { message: (err as Error).message });
  } finally {
    res.end();
  }
});

// 非流式对话
router.post('/chat-sync', requireAuth, async (req: Request, res: Response) => {
  const { messages } = (req.body || {}) as { messages?: unknown[] };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: '缺少消息内容' });
    return;
  }

  const token: string = extractToken(req);

  try {
    const result = await converse(
      messages as Record<string, unknown>[],
      { id: req.user!.id, username: req.user!.username, display_name: req.user!.display_name },
      token
    );
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, 'AI Chat 同步对话错误');
    res.status(500).json({ error: 'AI 服务暂时不可用：' + (err as Error).message });
  }
});

export = router;
