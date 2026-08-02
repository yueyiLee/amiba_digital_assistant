/**
 * ai/llm-client.ts — LLM API 客户端封装
 * 兼容 OpenAI / DeepSeek / 通义千问等 OpenAI 格式 API。
 * 支持普通对话与 Function Calling（tool_calls）。
 */
import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { rootLogger } from '../logger';

const LLM_API_KEY: string = process.env.LLM_API_KEY || '';
if (!LLM_API_KEY) {
  rootLogger.warn('未配置 LLM_API_KEY，AI 对话功能将不可用（调用时会明确报错）');
}
const client = new OpenAI({
  apiKey: LLM_API_KEY || 'sk-missing',
  baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
});

const MODEL: string = process.env.LLM_MODEL || 'deepseek-chat';

interface ChatOptions {
  temperature?: number;
  tool_choice?: string;
}

/**
 * 调用 LLM，返回原生响应对象。
 */
async function chat(
  messages: ChatCompletionMessageParam[],
  tools?: unknown[] | null,
  opts: ChatOptions = {}
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (!LLM_API_KEY) {
    throw new Error('AI 功能未启用：缺少环境变量 LLM_API_KEY');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = opts.tool_choice || 'auto';
  }
  const response = await client.chat.completions.create(params);
  return response;
}

interface StreamToolCall {
  content: string | null;
  tool_calls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> | null;
  role: 'assistant';
}

/**
 * 流式调用 LLM（SSE）。
 */
async function chatStream(
  messages: ChatCompletionMessageParam[],
  tools?: unknown[] | null,
  onDelta?: (text: string) => void,
  opts: ChatOptions = {}
): Promise<StreamToolCall> {
  if (!LLM_API_KEY) {
    throw new Error('AI 功能未启用：缺少环境变量 LLM_API_KEY');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: true,
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = opts.tool_choice || 'auto';
  }

  // OpenAI SDK v6 流式 API 返回 Stream 对象（可异步迭代），此处做安全的类型转换
  const stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> =
    await client.chat.completions.create(params) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

  let content = '';
  const toolCalls: StreamToolCall['tool_calls'] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      if (onDelta) onDelta(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx: number = tc.index || 0;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
        }
        if (tc.id) toolCalls[idx]!.id = tc.id;
        if (tc.function?.name) toolCalls[idx]!.function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx]!.function.arguments += tc.function.arguments;
      }
    }
  }

  return {
    content: content || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : null,
    role: 'assistant',
  };
}

function getModel(): string { return MODEL; }

export { chat, chatStream, getModel };
