/**
 * api.js — 前端 API 请求封装
 * 自动携带 JWT token（PRD 22.2 身份认证），统一错误处理。
 */
const API = (() => {
  const BASE = '/api';

  function getToken() {
    return localStorage.getItem('amoeba_token') || '';
  }

  async function request(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      }
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (e) {
      throw new Error('网络连接失败，请检查服务是否启动');
    }

    if (res.status === 401) {
      // token 失效，跳转登录
      Auth && Auth.logout && Auth.logout(true);
      throw new Error('登录已过期');
    }

    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text }; }

    if (!res.ok) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    getToken
  };
})();
