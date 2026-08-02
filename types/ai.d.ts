/**
 * AI 模块类型声明
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  name: string;
  content: string;
}

export interface ToolHandlerResult {
  success: boolean;
  data?: unknown;
  message: string;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  token: string
) => Promise<ToolHandlerResult>;

export interface ToolHandlersRegistry {
  [key: string]: ToolHandler;
}

export interface ApiClientModule {
  setApp: (app: unknown) => void;
  request: (method: string, path: string, opts?: Record<string, unknown>) => Promise<{ status: number; data: unknown }>;
  get: (path: string, query?: Record<string, unknown>, token?: string) => Promise<{ status: number; data: unknown }>;
  post: (path: string, body?: Record<string, unknown>, token?: string) => Promise<{ status: number; data: unknown }>;
  put: (path: string, body?: Record<string, unknown>, token?: string) => Promise<{ status: number; data: unknown }>;
  patch: (path: string, body?: Record<string, unknown>, token?: string) => Promise<{ status: number; data: unknown }>;
  del: (path: string, token?: string) => Promise<{ status: number; data: unknown }>;
}

export interface StreamToolCall {
  content: string | null;
  tool_calls: ToolCall[] | null;
  role: 'assistant';
}
