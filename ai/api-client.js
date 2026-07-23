/**
 * ai/api-client.js — 内部 RESTful API 客户端
 *
 * AI 工具通过此模块调用已有的 /api/* 路由，而非直接操作数据库。
 * 这样可以复用全部业务逻辑（校验、归属检查、状态历史等），
 * 并保持与前端完全一致的数据隔离安全模型。
 *
 * 原理：用 Express 的 app.handle() 在进程内模拟 HTTP 请求，
 * 不经过网络层，性能与直接调用路由函数等同。
 */

let _app = null;

/**
 * 注入 Express app 实例（在 server.js 启动时调用）
 * @param {Object} app - Express application 实例
 */
function setApp(app) {
  _app = app;
}

/**
 * 发起内部 API 请求（进程内，无网络开销）
 * @param {string} method - HTTP 方法
 * @param {string} path - API 路径，如 '/api/transactions'
 * @param {Object} opts - { query, body, token }
 *   - query: URL 查询参数对象
 *   - body: 请求体（POST/PUT 用）
 *   - token: 用户 JWT token（用于 requireAuth 认证）
 * @returns {Promise<Object>} - { status, data } 其中 data 是解析后的 JSON
 */
function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!_app) {
      return reject(new Error('Express app 未注入，请先调用 setApp()'));
    }

    // 构造查询字符串
    let url = path;
    if (opts.query && Object.keys(opts.query).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v != null && v !== '') qs.append(k, String(v));
      }
      url += '?' + qs.toString();
    }

    // 构造模拟请求
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = {
      method: method.toUpperCase(),
      url,
      path: url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': opts.token ? 'Bearer ' + opts.token : '',
      },
      body: bodyStr,
      get(key) { return this.headers[key.toLowerCase()] || this.headers[key]; },
    };

    // 构造模拟响应
    const res = {
      statusCode: 200,
      headers: {},
      set(key, val) { this.headers[key] = val; },
      get(key) { return this.headers[key.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(data) {
        resolve({ status: this.statusCode, data });
      },
      send(data) {
        if (typeof data === 'string') {
          try { resolve({ status: this.statusCode, data: JSON.parse(data) }); }
          catch (e) { resolve({ status: this.statusCode, data: { raw: data } }); }
        } else {
          resolve({ status: this.statusCode, data });
        }
      },
      end() {
        // 如果既没有 json 也没有 send 被调用，返回空
        resolve({ status: this.statusCode, data: {} });
      },
      write() {},
      on() {},
    };

    // 通过 Express app 处理请求
    _app.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, data: { error: '接口不存在: ' + url } });
    });
  });
}

/**
 * 便捷方法：GET 请求
 */
function get(path, query, token) {
  return request('GET', path, { query, token });
}

/**
 * 便捷方法：POST 请求
 */
function post(path, body, token) {
  return request('POST', path, { body, token });
}

/**
 * 便捷方法：PUT 请求
 */
function put(path, body, token) {
  return request('PUT', path, { body, token });
}

/**
 * 便捷方法：PATCH 请求
 */
function patch(path, body, token) {
  return request('PATCH', path, { body, token });
}

/**
 * 便捷方法：DELETE 请求
 */
function del(path, token) {
  return request('DELETE', path, { token });
}

module.exports = { setApp, request, get, post, put, patch, del };
