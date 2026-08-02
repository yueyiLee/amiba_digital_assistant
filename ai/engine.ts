/**
 * ai/engine.ts — AI 对话引擎
 * 管理 Function Calling 调度循环：LLM → tool_calls → 执行工具 → 结果回传 → LLM → 最终回复
 * 支持流式（SSE）和非流式两种模式。
 */
import { chat, chatStream } from './llm-client';
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from './tools';
import { buildSystemPrompt } from './prompts';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ToolCall, ToolResult, StreamToolCall } from '../types/ai';

const MAX_TOOL_ROUNDS = 8;

/**
 * 执行单个工具调用
 */
async function executeToolCall(toolCall: ToolCall, token: string): Promise<ToolResult> {
  const fnName: string = toolCall.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch (e: unknown) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify({ success: false, message: '参数解析失败：' + (e as Error).message }),
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
  } catch (err: unknown) {
    console.error(`[AI Engine] 工具 ${fnName} 执行失败:`, (err as Error).message);
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: fnName,
      content: JSON.stringify({ success: false, message: '工具执行失败：' + (err as Error).message }),
    };
  }
}

interface UserInfo {
  id: number;
  username: string;
  display_name: string;
}

interface ToolCallsSummaryItem {
  name: string;
  success: boolean;
  message: string;
}

interface ConverseResult {
  reply: string;
  toolCallsSummary: ToolCallsSummaryItem[];
}

/**
 * 将 StreamToolCall 转换为 ChatCompletionMessageParam（仅用于 push 回 fullMessages）
 */
function streamToolCallToMessage(tc: StreamToolCall): ChatCompletionMessageParam {
  return {
    role: 'assistant',
    content: tc.content,
    tool_calls: tc.tool_calls?.map((t) => ({
      id: t.id,
      type: 'function' as const,
      function: { name: t.function.name, arguments: t.function.arguments },
    })),
  };
}

/**
 * 非流式对话（用于 REST API）
 */
async function converse(
  messages: Record<string, unknown>[],
  user: UserInfo,
  token: string
): Promise<ConverseResult> {
  const systemPrompt: string = buildSystemPrompt(user.username, user.display_name);
  const fullMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...(messages as unknown as ChatCompletionMessageParam[]),
  ];

  let rounds = 0;
  const toolCallsSummary: ToolCallsSummaryItem[] = [];

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const response = await chat(fullMessages, TOOL_DEFINITIONS);
    const choice = response.choices?.[0]?.message;

    if (!choice) break;

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return { reply: choice.content || '', toolCallsSummary };
    }

    fullMessages.push(choice);

    for (const tc of choice.tool_calls) {
      const toolCallTyped: ToolCall = {
        id: tc.id,
        type: 'function',
        function: {
          name: (tc as { function?: { name?: string } }).function?.name || '',
          arguments: (tc as { function?: { arguments?: string } }).function?.arguments || '',
        },
      };
      const toolResult = await executeToolCall(toolCallTyped, token);
      fullMessages.push(toolResult as unknown as ChatCompletionMessageParam);
      const parsed = JSON.parse(toolResult.content);
      toolCallsSummary.push({
        name: toolCallTyped.function.name,
        success: parsed.success,
        message: parsed.message,
      });
    }
  }

  const finalResponse = await chat(fullMessages, null);
  const finalReply: string = finalResponse.choices?.[0]?.message?.content || '抱歉，处理超时，请简化您的请求后重试。';
  return { reply: finalReply, toolCallsSummary };
}

/**
 * 流式对话（用于 SSE）
 */
async function converseStream(
  messages: Record<string, unknown>[],
  user: UserInfo,
  token: string,
  onText: (text: string) => void,
  onToolStart: (toolName: string) => void,
  onToolEnd: (toolName: string, result: Record<string, unknown>) => void
): Promise<ConverseResult> {
  const systemPrompt: string = buildSystemPrompt(user.username, user.display_name);
  const fullMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...(messages as unknown as ChatCompletionMessageParam[]),
  ];

  let rounds = 0;
  const toolCallsSummary: ToolCallsSummaryItem[] = [];
  let finalReply = '';

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let textBuffer = '';
    const response: StreamToolCall = await chatStream(
      fullMessages,
      TOOL_DEFINITIONS,
      (delta: string) => {
        textBuffer += delta;
        onText(delta);
      }
    );

    finalReply = textBuffer;

    if (!response.tool_calls || response.tool_calls.length === 0) {
      break;
    }

    // 将 StreamToolCall 安全转换为 ChatCompletionMessageParam 后 push
    fullMessages.push(streamToolCallToMessage(response));

    for (const tc of response.tool_calls) {
      onToolStart(tc.function.name);
      const toolResult = await executeToolCall(tc, token);
      fullMessages.push(toolResult as unknown as ChatCompletionMessageParam);
      const parsed = JSON.parse(toolResult.content);
      onToolEnd(tc.function.name, parsed);
      toolCallsSummary.push({
        name: tc.function.name,
        success: parsed.success,
        message: parsed.message,
      });
    }

    onText('\n\n');
  }

  return { reply: finalReply, toolCallsSummary };
}

export { converse, converseStream, MAX_TOOL_ROUNDS };
