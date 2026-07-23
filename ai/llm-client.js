/**
 * ai/llm-client.js — LLM API 客户端封装
 * 兼容 OpenAI / DeepSeek / 通义千问等 OpenAI 格式 API。
 * 支持普通对话与 Function Calling（tool_calls）。
 */
require('dotenv').config();

const OpenAI = require('openai').default || require('openai');

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY || 'sk-placeholder',
  baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
});

const MODEL = process.env.LLM_MODEL || 'deepseek-chat';

/**
 * 调用 LLM，返回原生响应对象。
 * @param {Array} messages - OpenAI 格式消息数组
 * @param {Array} tools - Function Calling 工具定义
 * @param {Object} opts - 额外参数（temperature 等）
 * @returns {Promise<Object>} 原生 chat completion 响应
 */
async function chat(messages, tools, opts = {}) {
  const params = {
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

/**
 * 流式调用 LLM（SSE）。
 * @param {Array} messages
 * @param {Array} tools
 * @param {Function} onDelta - 收到文本增量时的回调 (text) => void
 * @param {Object} opts
 * @returns {Promise<Object>} 完整响应（含 tool_calls）
 */
async function chatStream(messages, tools, onDelta, opts = {}) {
  const params = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: true,
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = opts.tool_choice || 'auto';
  }

  const stream = await client.chat.completions.create(params);

  // 累积完整响应
  let content = '';
  let toolCalls = [];

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      if (onDelta) onDelta(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index || 0;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  return {
    content: content || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : null,
    role: 'assistant',
  };
}

module.exports = { chat, chatStream, getModel: () => MODEL };
