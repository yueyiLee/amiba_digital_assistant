/**
 * routes/wx.ts — 微信 JS-SDK 签名接口（H5 微信浏览器分享）
 *
 * 公开路由：GET /api/wx/jssdk?url=<当前页面完整URL>
 * 流程：获取 access_token（缓存 7200s）→ 获取 jsapi_ticket（缓存 7200s）→ sha1 签名
 * 注意：签名 URL 为当前页面地址去掉 # 及其后部分（微信官方要求）
 */
import crypto from 'node:crypto';
import express, { Router, Request, Response } from 'express';
import { fail400, failErr, ok } from './lib/helpers';

const WX_API_BASE = 'https://api.weixin.qq.com';
const TOKEN_TTL_MS = 7200 * 1000; // access_token 有效期 7200s
const TICKET_TTL_MS = 7200 * 1000; // jsapi_ticket 有效期 7200s
const EXPIRE_BUFFER_MS = 60 * 1000; // 提前 60s 失效，避免边界过期导致签名失败

const router: Router = express.Router();

// 模块级内存缓存（单实例部署场景足够；多实例需改为共享缓存如 Redis）
let accessTokenCache: { value: string; expiresAt: number } | null = null;
let jsapiTicketCache: { value: string; expiresAt: number } | null = null;

/** 请求微信接口并解析 JSON */
async function fetchWechatJson(url: string): Promise<Record<string, any>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`微信接口请求失败: HTTP ${response.status}`);
  }
  return await response.json() as Record<string, any>;
}

/** 获取 access_token（带缓存） */
async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt - EXPIRE_BUFFER_MS > now) {
    return accessTokenCache.value;
  }
  const url = `${WX_API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const data = await fetchWechatJson(url);
  if (!data.access_token || data.errcode) {
    throw new Error(`获取 access_token 失败: ${data.errcode ?? ''} ${data.errmsg ?? ''}`.trim());
  }
  accessTokenCache = { value: data.access_token, expiresAt: now + TOKEN_TTL_MS };
  return data.access_token;
}

/** 获取 jsapi_ticket（带缓存） */
async function getJsapiTicket(accessToken: string): Promise<string> {
  const now = Date.now();
  if (jsapiTicketCache && jsapiTicketCache.expiresAt - EXPIRE_BUFFER_MS > now) {
    return jsapiTicketCache.value;
  }
  const url = `${WX_API_BASE}/cgi-bin/ticket/getticket?type=jsapi&access_token=${encodeURIComponent(accessToken)}`;
  const data = await fetchWechatJson(url);
  if (!data.ticket || data.errcode) {
    throw new Error(`获取 jsapi_ticket 失败: ${data.errcode ?? ''} ${data.errmsg ?? ''}`.trim());
  }
  jsapiTicketCache = { value: data.ticket, expiresAt: now + TICKET_TTL_MS };
  return data.ticket;
}

/** 生成微信 JS-SDK 签名 */
function buildSignature(jsapiTicket: string, nonceStr: string, timestamp: string, url: string): string {
  // 参数固定顺序 + noncestr 全小写（微信官方要求）
  const raw = `jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * GET /api/wx/jssdk?url=<当前页面URL>
 * 返回扁平结构：{ appId, timestamp, nonceStr, signature }
 */
router.get('/jssdk', async (req: Request, res: Response) => {
  try {
    const appId = process.env.WX_APP_ID;
    const appSecret = process.env.WX_APP_SECRET;
    if (!appId || !appSecret) {
      fail400(res, '微信 JS-SDK 未配置（WX_APP_ID / WX_APP_SECRET）');
      return;
    }

    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      fail400(res, '缺少 url 参数');
      return;
    }
    // 微信签名要求使用不含 # 的页面完整地址
    const url = rawUrl.split('#')[0];

    const accessToken = await getAccessToken(appId, appSecret);
    const jsapiTicket = await getJsapiTicket(accessToken);

    const nonceStr = crypto.randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = buildSignature(jsapiTicket, nonceStr, timestamp, url);

    req.log.info({ url, appId }, '生成微信 JS-SDK 签名成功');
    ok(res, { appId, timestamp, nonceStr, signature });
  } catch (e: unknown) {
    req.log.error({ err: e }, '生成微信 JS-SDK 签名失败');
    failErr(res, e);
  }
});

export = router;
