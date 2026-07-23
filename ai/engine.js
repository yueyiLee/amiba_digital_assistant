/**
 * ai/engine.js — AI 对话引擎
 * 管理 Function Calling 调度循环：LLM → tool_calls → 执行工具 → 结果回传 → LLM → 最终回复
 * 支持流式（SSE）和非流式两种模式。
 */
const { chat, chatStream } = require('./llm-client');
const { TOOL_DEFINITIONS, TOOL_HANDLERS } = require('./tools');
const { buildSystemPrompt } = require('./prompts');

const MAX_TOOL_ROUNDS = 8; // 最大工具调用轮次，防止无限循环

/**
 * 执行单个工具调用
 * @param {Object} toolCall - { id, function: { name, arguments } }
 * @param {string} token - 用户 JWT token（用于调用 RESTful API 的认证）
 * @returns {Object} - { tool_call_id, role: 'tool', name, content }
 */
async function executeToolCall(toolCall, token) {
  const fnName = toolCall.function.name;
  let args = {};
  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch (e) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify({ success: false, message: '参数解析失败：' + e.message }),
    };
  }

  const handler = TOOL_HANDLERS[fnName];
  if (!handler) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify({ success: false, message: `未知工具：${fnName}` }),
    };
  }

  try {
    const result = await handler(args, token);
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify(result),
    };
  } catch (err) {
    console.error(`[AI Engine] 工具 ${fnName} 执行失败:`, err.message);
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify({ success: false, message: '工具执行失败：' + err.message }),
    };
  }
}

/**
 * 非流式对话（用于 REST API）
 * @param {Array} messages - 历史消息
 * @param {Object} user - 当前用户 { id, username, display_name }
 * @param {string} token - 用户 JWT token（传给工具用于 API 调用）
 * @returns {Object} - { reply, toolCallsSummary }
 */
async function converse(messages, user, token) {
  const systemPrompt = buildSystemPrompt(user.username, user.display_name);
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  let rounds = 0;
  let toolCallsSummary = [];

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const response = await chat(fullMessages, TOOL_DEFINITIONS);
    const choice = response.choices?.[0]?.message;

    if (!choice) break;

    // 没有 tool_calls，返回最终回复
    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return { reply: choice.content || '', toolCallsSummary };
    }

    // 有 tool_calls：先加入 assistant 消息，再逐个执行工具
    fullMessages.push(choice);

    for (const tc of choice.tool_calls) {
      const toolResult = await executeToolCall(tc, token);
      fullMessages.push(toolResult);
      toolCallsSummary.push({
        name: tc.function.name,
        success: JSON.parse(toolResult.content).success,
        message: JSON.parse(toolResult.content).message,
      });
    }
    // 继续循环，让 LLM 基于工具结果生成回复
  }

  // 超过最大轮次，强制获取最终回复（不带 tools）
  const finalResponse = await chat(fullMessages, null);
  const finalReply = finalResponse.choices?.[0]?.message?.content || '抱歉，处理超时，请简化您的请求后重试。';
  return { reply: finalReply, toolCallsSummary };
}

/**
 * 流式对话（用于 SSE）
 * @param {Array} messages - 历史消息
 * @param {Object} user - 当前用户
 * @param {string} token - 用户 JWT token
 * @param {Function} onText - 文本增量回调 (text) => void
 * @param {Function} onToolStart - 工具开始回调 (toolName) => void
 * @param {Function} onToolEnd - 工具完成回调 (toolName, result) => void
 * @returns {Object} - { reply, toolCallsSummary }
 */
async function converseStream(messages, user, token, onText, onToolStart, onToolEnd) {
  const systemPrompt = buildSystemPrompt(user.username, user.display_name);
  let fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  let rounds = 0;
  let toolCallsSummary = [];
  let finalReply = '';

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let textBuffer = '';
    const response = await chatStream(
      fullMessages,
      TOOL_DEFINITIONS,
      (delta) => {
        textBuffer += delta;
        if (onText) onText(delta);
      }
    );

    finalReply = textBuffer;

    // 没有 tool_calls，对话结束
    if (!response.tool_calls || response.tool_calls.length === 0) {
      break;
    }

    // 有 tool_calls：加入 assistant 消息，执行工具
    fullMessages.push(response);

    for (const tc of response.tool_calls) {
      if (onToolStart) onToolStart(tc.function.name);
      const toolResult = await executeToolCall(tc, token);
      fullMessages.push(toolResult);
      const parsed = JSON.parse(toolResult.content);
      if (onToolEnd) onToolEnd(tc.function.name, parsed);
      toolCallsSummary.push({
        name: tc.function.name,
        success: parsed.success,
        message: parsed.message,
      });
    }

    // 工具执行完毕后，下一轮 LLM 会生成新文本
    if (onText) onText('\n\n');
  }

  return { reply: finalReply, toolCallsSummary };
}

module.exports = { converse, converseStream, MAX_TOOL_ROUNDS };
