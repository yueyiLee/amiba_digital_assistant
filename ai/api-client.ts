/**
 * ai/api-client.ts — 内部 RESTful API 客户端
 *
 * AI 工具通过此模块调用已有的 /api/* 路由，而非直接操作数据库。
 */
import type { Express } from 'express';

let _app: Express | null = null;

/**
 * 注入 Express app 实例（在 server.ts 启动时调用）
 */
function setApp(app: Express): void {
  _app = app;
}

interface RequestOptions {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  token?: string;
}

interface ApiResponse {
  status: number;
  data: unknown;
}

/**
 * 发起内部 API 请求（进程内，无网络开销）
 */
function request(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    if (!_app) {
      reject(new Error('Express app 未注入，请先调用 setApp()'));
      return;
    }

    let url: string = path;
    if (opts.query && Object.keys(opts.query).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v != null && v !== '') qs.append(k, String(v));
      }
      url += '?' + qs.toString();
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': opts.token ? 'Bearer ' + opts.token : '',
    };

    const req = {
      method: method.toUpperCase(),
      url,
      path: url,
      headers,
      body: opts.body,
      _body: true,
      get(key: string): string | undefined {
        return this.headers[key.toLowerCase()] || this.headers[key];
      },
      header(key: string): string | undefined {
        return this.get(key);
      },
      on() { /* noop */ },
      emit() { /* noop */ },
    };

    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      set(key: string, val: string) { this.headers[key] = val; return this; },
      get(key: string): string | undefined { return this.headers[key.toLowerCase()]; },
      setHeader(name: string, value: string) { this.headers[name] = value; return this; },
      getHeader(name: string): string | undefined { return this.headers[name]; },
      removeHeader(name: string) { delete this.headers[name]; },
      hasHeader(name: string): boolean { return Object.prototype.hasOwnProperty.call(this.headers, name); },
      writeHead(statusCode: number, headers?: Record<string, string>) {
        this.statusCode = statusCode;
        if (headers) { for (const k of Object.keys(headers)) this.headers[k] = headers[k]; }
      },
      status(code: number) { this.statusCode = code; return this; },
      json(data: unknown) { resolve({ status: this.statusCode, data }); },
      send(data: unknown) {
        if (typeof data === 'string') {
          try { resolve({ status: this.statusCode, data: JSON.parse(data) }); }
          catch (_e: unknown) { resolve({ status: this.statusCode, data: { raw: data } }); }
        } else {
          resolve({ status: this.statusCode, data });
        }
      },
      end() { resolve({ status: this.statusCode, data: {} }); },
      write() { /* noop */ },
      on() { /* noop */ },
    };

    // Express 4.x 内部使用 app.handle() 来处理请求，但 @types/express v5 的类型定义中没有暴露此方法
    // 通过类型断言调用内部 handle 方法
    (_app as unknown as { handle: (req: unknown, res: unknown, next: (err?: Error) => void) => void }).handle(
      req,
      res,
      (err: Error | undefined) => {
        if (err) reject(err);
        else resolve({ status: 404, data: { error: '接口不存在: ' + url } });
      }
    );
  });
}

function get(path: string, query?: Record<string, unknown>, token?: string): Promise<ApiResponse> {
  return request('GET', path, { query, token });
}

function post(path: string, body?: Record<string, unknown>, token?: string): Promise<ApiResponse> {
  return request('POST', path, { body, token });
}

function put(path: string, body?: Record<string, unknown>, token?: string): Promise<ApiResponse> {
  return request('PUT', path, { body, token });
}

function patch(path: string, body?: Record<string, unknown>, token?: string): Promise<ApiResponse> {
  return request('PATCH', path, { body, token });
}

function del(path: string, token?: string): Promise<ApiResponse> {
  return request('DELETE', path, { token });
}

export { setApp, request, get, post, put, patch, del };
