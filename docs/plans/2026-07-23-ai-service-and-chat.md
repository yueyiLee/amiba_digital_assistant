# AI 对话化改造实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将阿米巴经营数字助手改造成可供 AI 调用的服务，并在前端增加 AI 对话框，让用户通过自然语言对话操作全部业务功能。

**Architecture:** 新增后端 `/api/ai/chat` SSE 流式对话端点，内置 Function Calling 调度引擎；将现有 11 个业务模块的 RESTful API 封装为 AI 可调用的"工具"（Tools），每个工具通过内部 HTTP 请求调用已有的 `/api/*` 路由（复用全部业务逻辑、校验、数据隔离），而非直接操作数据库；前端新增右下角悬浮 AI 对话面板（聊天 UI），通过 SSE 接收 AI 回复与工具调用结果，支持 Markdown 表格渲染。

**核心设计原则：工具不直接查库，通过调用已有 RESTful API 复用全部业务逻辑。**

**Tech Stack:**
- 后端：Node.js + Express（已有）+ `openai` SDK（兼容 OpenAI/DeepSeek/通义等 API）+ Server-Sent Events（SSE）
- 前端：原生 JavaScript（已有）+ Markdown 渲染（`marked` CDN）
- 认证：复用已有 JWT（`middleware/auth.js`），AI 端点均需 `requireAuth`
- 工具执行：通过内部 HTTP 调用已有 `/api/*` 路由，携带用户 JWT，复用全部业务校验

---

## 改造范围概览

```
新增文件：
  ai/api-client.js     — 内部 RESTful API 客户端（工具用它调已有 API）
  ai/tools.js          — AI 工具定义（JSON Schema）与执行函数注册表
  ai/engine.js         — LLM 调用 + Function Calling 调度循环
  routes/ai.js         — AI 对话路由（SSE 流式 + REST）
  ai/prompts.js        — 系统提示词（业务知识 + 工具使用指引）
  ai/llm-client.js     — LLM API 客户端封装（支持多 provider）
  public/js/ai-chat.js — 前端 AI 对话面板组件
  .env.example         — 环境变量示例

修改文件：
  server.js            — 挂载 AI 路由
  public/index.html    — 引入 ai-chat.js + 添加对话面板 HTML
  public/css/style.css — 对话面板样式
  package.json         — 添加 openai 依赖
```

### 已有 RESTful API 端点清单（工具调用的目标）

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 收支 | GET | `/api/transactions` | 查询收支流水（支持 unit/type/startDate/endDate 筛选） |
| 收支 | POST | `/api/transactions` | 新增收支记录 |
| 收支 | PUT | `/api/transactions/:id` | 修改收支记录 |
| 收支 | DELETE | `/api/transactions/:id` | 删除收支记录 |
| 客户 | GET | `/api/customers` | 查询客户列表 |
| 客户 | POST | `/api/customers` | 新增客户 |
| 客户 | PUT | `/api/customers/:id` | 修改客户 |
| 客户 | DELETE | `/api/customers/:id` | 删除客户 |
| 商品 | GET | `/api/products` | 查询商品列表 |
| 商品 | POST | `/api/products` | 新增商品（自动创建库存） |
| 商品 | PUT | `/api/products/:id` | 修改商品 |
| 商品 | DELETE | `/api/products/:id` | 删除商品 |
| 库存 | GET | `/api/inventory` | 查询库存列表 |
| 库存 | POST | `/api/inventory` | 更新/新增库存 |
| 合同 | GET | `/api/contracts` | 查询合同列表 |
| 合同 | POST | `/api/contracts` | 新增合同 |
| 员工 | GET | `/api/employees` | 查询员工列表 |
| 员工 | POST | `/api/employees` | 新增员工 |
| 员工 | PATCH | `/api/employees/:id/status` | 离职/复职 |
| 工时 | GET | `/api/workhours` | 查询工时（支持 month 筛选） |
| 工时 | POST | `/api/workhours` | 记录工时（upsert） |
| 设置 | GET | `/api/settings` | 获取设置 |
| 设置 | PUT | `/api/settings` | 更新设置 |
| 支出项 | GET | `/api/expense-items` | 获取支出项预设 |
| 支出类型 | GET | `/api/expense-types` | 获取收支类型配置 |
| 汇率 | GET | `/api/exchange/rate` | 获取汇率 |
| 初始化 | POST | `/api/init/sample` | 重置示例数据 |

---

## Task 1: 添加 LLM 客户端封装

**Files:**
- Create: `ai/llm-client.js`
- Create: `.env.example`
- Modify: `package.json`

**Step 1: 安装 openai SDK 依赖**

Run: `cd c:\Users\shine\projects\amiba_digital_assistant && npm install openai dotenv`
Expected: `package.json` 中新增 `"openai"` 和 `"dotenv"` 依赖

**Step 2: 创建 `.env.example`**

```bash
# LLM 配置（兼容 OpenAI / DeepSeek / 通义千问等 API）
# 默认使用 DeepSeek（性价比高，支持 Function Calling）
LLM_API_KEY=sk-your-api-key-here
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 也可使用 OpenAI
# LLM_API_KEY=sk-xxx
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini

# 通义千问（兼容 OpenAI 格式）
# LLM_API_KEY=sk-xxx
# LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# LLM_MODEL=qwen-plus
```

**Step 3: 编写 `ai/llm-client.js`**

```javascript
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
```

**Step 4: 在 `package.json` 的 `scripts` 中添加 dev 脚本（加载 .env）**

修改 `package.json`：
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "node -r dotenv/config server.js"
  }
}
```

**Step 5: 提交**

```bash
git add ai/llm-client.js .env.example package.json package-lock.json
git commit -m "feat: add LLM client wrapper with OpenAI-compatible API support"
```

---

## Task 2: 内部 API 客户端 — 工具通过它调用已有 RESTful API

**Files:**
- Create: `ai/api-client.js`

这是本次改造的核心：工具不再直接操作 `db` 模块，而是通过这个客户端调用已有的 `/api/*` 路由，复用全部业务逻辑、校验和数据隔离。

**Step 1: 编写 `ai/api-client.js`**

```javascript
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
    let statusCode = 200;
    let headers = {};
    let chunks = [];

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
        if (chunks.length > 0) {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: this.statusCode, data: JSON.parse(raw) }); }
          catch (e) { resolve({ status: this.statusCode, data: { raw } }); }
        }
      },
      write(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); },
      on() {}, // noop for SSE compat
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
```

**Step 2: 提交**

```bash
git add ai/api-client.js
git commit -m "feat: add internal API client for tools to call existing RESTful routes"
```

---

## Task 3: 定义 AI 工具（Tools）— 通过调用 RESTful API 操作业务

**Files:**
- Create: `ai/tools.js`

**关键变化：** 所有 `handler` 不再引入 `db` 模块，而是用 `apiClient` 调用已有 RESTful API。每个 handler 接收 `(params, token)` 参数（`token` 是用户 JWT，用于 API 认证），返回 `{ success, data, message }`。

**Step 1: 编写 `ai/tools.js`**

```javascript
/**
 * ai/tools.js — AI 工具定义（Function Calling）与执行函数注册表
 *
 * 核心设计：工具不直接操作数据库，而是通过 apiClient 调用已有的 /api/* 路由。
 * 这样复用全部业务逻辑（校验、归属检查、状态历史回写等），
 * 并保持与前端完全一致的数据隔离安全模型。
 *
 * 每个 handler 接收 (params, token) 参数：
 *   - params: LLM 提供的工具参数
 *   - token: 用户 JWT（用于 requireAuth 认证）
 * 返回 { success, data, message }。
 */
const api = require('./api-client');

// ===== 工具定义（OpenAI Function Calling 格式）=====
const TOOL_DEFINITIONS = [
  // ---- 经营看板 / 统计 ----
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description: '获取经营看板数据，包含阿米巴核心指标（附加价值、总利润、单位时间附加价值等）、收支明细构成、总工时与总工资。可按时间段和部门筛选。',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['month', 'lastMonth', 'year', 'lastYear'], description: '时间段：本月/上月/今年/上年，默认本月' },
          unit: { type: 'string', description: '部门名称，如"全公司"、"销售部"、"生产部"。留空表示全部部门' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: '查询收支流水记录。支持按部门、类型、日期范围筛选。返回包含客户名和商品名的完整记录。',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', description: '部门名称筛选' },
          type: { type: 'string', description: '交易类型，如"销售收入"、"材料采购"、"委托加工"、"杂费支出"、"税金"等' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_transaction',
      description: '新增一条收支流水记录。金额正数表示收入，负数表示支出。需指定交易类型、金额、日期。',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: '金额。正数=收入，负数=支出' },
          type: { type: 'string', description: '交易类型，如"销售收入"、"材料采购"、"委托加工"、"杂费支出"、"税金"、"现金收入"等' },
          unit: { type: 'string', description: '归属部门，默认"全公司"' },
          date: { type: 'string', description: '日期 YYYY-MM-DD' },
          customer_name: { type: 'string', description: '客户名称（可选，用于关联客户）' },
          product_name: { type: 'string', description: '商品名称（可选，用于关联商品）' },
          note: { type: 'string', description: '备注' },
          category: { type: 'string', description: '支出细分类别（委托加工/杂费时使用）' },
        },
        required: ['amount', 'type', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: '修改一条收支流水记录。需提供记录ID，其余字段按需修改。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '记录ID' },
          amount: { type: 'number' },
          type: { type: 'string' },
          unit: { type: 'string' },
          date: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: '删除一条收支流水记录。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: '记录ID' } },
        required: ['id'],
      },
    },
  },

  // ---- 客户管理 ----
  {
    type: 'function',
    function: {
      name: 'get_customers',
      description: '查询客户列表。返回所有客户的基本信息（名称、类型、联系方式、地址）。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词（模糊匹配客户名称，客户端过滤）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_customer',
      description: '新增客户。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '客户名称' },
          type: { type: 'string', enum: ['个人', '公司'], description: '客户类型' },
          contact: { type: 'string', description: '联系方式' },
          address: { type: 'string', description: '地址' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: '修改客户信息。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['个人', '公司'] },
          contact: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_customer',
      description: '删除客户。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },

  // ---- 商品管理 ----
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: '查询商品列表。返回商品名称、品牌、分类、采购价、销售价等信息。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '搜索关键词（客户端过滤）' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_product',
      description: '新增商品。新增后会自动创建库存记录（初始数量0）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          unit: { type: 'string', description: '单位，如"件"、"条"等' },
          category1: { type: 'string', description: '一级分类，如"上衣"、"裤子"等' },
          category2: { type: 'string', description: '二级分类' },
          purchase_price: { type: 'number', description: '采购价' },
          sale_price: { type: 'number', description: '销售价' },
        },
        required: ['name', 'category1'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product',
      description: '修改商品信息。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          brand: { type: 'string' },
          purchase_price: { type: 'number' },
          sale_price: { type: 'number' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_product',
      description: '删除商品。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },

  // ---- 库存管理 ----
  {
    type: 'function',
    function: {
      name: 'get_inventory',
      description: '查询库存列表。返回每个商品的库存数量、平均成本、库存价值。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_inventory',
      description: '更新某商品的库存数量和平均成本。需先通过商品名查找 product_id。',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'number', description: '商品ID' },
          quantity: { type: 'number', description: '库存数量' },
          avg_price: { type: 'number', description: '平均成本价' },
        },
        required: ['product_id', 'quantity'],
      },
    },
  },

  // ---- 合同管理 ----
  {
    type: 'function',
    function: {
      name: 'get_contracts',
      description: '查询合同列表。返回合同号、客户名、金额、状态、起止日期。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_contract',
      description: '新增合同。需提供客户ID（可通过 get_customers 查找）。',
      parameters: {
        type: 'object',
        properties: {
          contract_no: { type: 'string', description: '合同号' },
          customer_id: { type: 'number', description: '客户ID' },
          amount: { type: 'number', description: '合同金额' },
          status: { type: 'string', description: '状态，默认"进行中"' },
          start_date: { type: 'string', description: '开始日期' },
          end_date: { type: 'string', description: '结束日期' },
          note: { type: 'string' },
        },
        required: ['contract_no', 'customer_id', 'amount'],
      },
    },
  },

  // ---- 员工管理 ----
  {
    type: 'function',
    function: {
      name: 'get_employees',
      description: '查询员工列表。返回姓名、岗位、时薪、入职日期、在职状态。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_employee',
      description: '新增员工。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          position: { type: 'string', description: '岗位' },
          hourly_rate: { type: 'number', description: '时薪' },
          join_date: { type: 'string', description: '入职日期 YYYY-MM-DD' },
        },
        required: ['name', 'hourly_rate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_employee_status',
      description: '设置员工在职状态（离职/复职）。需提供员工ID。',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: '员工ID' },
          status: { type: 'string', enum: ['active', 'left'] },
          leave_date: { type: 'string', description: '离职/复职日期' },
          note: { type: 'string' },
        },
        required: ['employee_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_work_hours',
      description: '记录员工某月工时。月工资 = 工时 × 时薪。需提供员工ID。',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: '员工ID' },
          hours: { type: 'number', description: '工时数' },
          month: { type: 'string', description: '月份 YYYY-MM' },
        },
        required: ['employee_id', 'hours', 'month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_work_hours',
      description: '查询工时记录。可按月份筛选。',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: '月份 YYYY-MM' } },
      },
    },
  },

  // ---- 经营分析（基于 transactions 数据二次计算） ----
  {
    type: 'function',
    function: {
      name: 'get_analysis_summary',
      description: '获取经营分析摘要：本期收入/支出分类汇总、利润、附加价值。通过查询 transactions 后在服务端计算。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          unit: { type: 'string', description: '部门筛选' },
        },
      },
    },
  },

  // ---- 设置 ----
  {
    type: 'function',
    function: {
      name: 'get_settings',
      description: '获取当前账号的系统设置（部门列表、币种、导出格式等）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expense_types',
      description: '获取收支类型（费用类型）配置列表。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ===== 工具执行函数（全部通过 apiClient 调用已有 RESTful API）=====

/**
 * 通用错误处理：检查 API 响应状态
 */
function checkResponse(resp, successMessage) {
  if (resp.status >= 400) {
    return { success: false, message: resp.data.error || `操作失败 (${resp.status})` };
  }
  return { success: true, data: resp.data, message: successMessage };
}

const TOOL_HANDLERS = {
  // ---- 经营看板：调用 get_transactions 获取数据后计算 ----
  async get_dashboard(params, token) {
    const period = params.period || 'month';
    const now = new Date();
    let startDate, endDate, monthStr;

    if (period === 'month') {
      const y = now.getFullYear(), m = now.getMonth();
      startDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      endDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      monthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
    } else if (period === 'lastMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else if (period === 'year') {
      const y = now.getFullYear();
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
    } else if (period === 'lastYear') {
      const y = now.getFullYear() - 1;
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
    }

    // 调用 GET /api/transactions 获取流水
    const query = { startDate, endDate };
    if (params.unit && params.unit !== '全部单元') query.unit = params.unit;
    const txResp = await api.get('/api/transactions', query, token);
    if (txResp.status >= 400) {
      return { success: false, message: txResp.data.error || '获取收支数据失败' };
    }
    const transactions = txResp.data;

    // 调用 GET /api/workhours 获取工时（仅月维度有意义）
    let workHours = [];
    if (monthStr) {
      const whResp = await api.get('/api/workhours', { month: monthStr }, token);
      if (whResp.status < 400) workHours = whResp.data;
    }

    // 分类汇总
    const sumByType = (type) => transactions.filter(t => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);
    const salesIncome = sumByType('销售收入');
    const cashIncome = sumByType('现金收入');
    const otherIncome = sumByType('其他收入');
    const totalIncome = salesIncome + cashIncome + otherIncome;
    const receivable = salesIncome - cashIncome;

    const materialExpense = sumByType('材料采购');
    const processExpense = sumByType('委托加工');
    const miscExpense = sumByType('杂费支出');
    const taxExpense = sumByType('税金');
    const totalExpense = materialExpense + processExpense + miscExpense + taxExpense;
    const cashExpense = sumByType('现金支出');
    const payable = totalExpense - cashExpense;

    const addedValue = totalIncome - materialExpense - processExpense - miscExpense - taxExpense;
    const totalHours = workHours.reduce((s, w) => s + (w.hours || 0), 0);
    const totalSalary = workHours.reduce((s, w) => s + (w.hours || 0) * (w.hourly_rate || 0), 0);
    const unitAddedValue = totalHours > 0 ? addedValue / totalHours : 0;
    const totalProfit = addedValue - totalSalary - taxExpense;
    const unitProfit = totalHours > 0 ? totalProfit / totalHours : 0;

    return {
      success: true,
      data: {
        period: { startDate, endDate, label: `${startDate} ~ ${endDate}` },
        core: { addedValue, unitAddedValue, totalProfit, unitProfit },
        income: { salesIncome, cashIncome, otherIncome, totalIncome, receivable },
        expense: { materialExpense, processExpense, miscExpense, taxExpense, totalExpense, cashExpense, payable },
        labor: { totalHours, totalSalary, unitSalary: totalHours > 0 ? totalSalary / totalHours : 0 },
      },
      message: `经营看板数据（${startDate} 至 ${endDate}）`,
    };
  },

  // ---- 收支流水 ----
  async get_transactions(params, token) {
    const query = {};
    if (params.unit) query.unit = params.unit;
    if (params.type) query.type = params.type;
    if (params.startDate) query.startDate = params.startDate;
    if (params.endDate) query.endDate = params.endDate;
    const resp = await api.get('/api/transactions', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const rows = resp.data;
    return { success: true, data: rows, message: `找到 ${rows.length} 条收支记录` };
  },

  async add_transaction(params, token) {
    const body = {
      amount: params.amount,
      type: params.type,
      unit: params.unit || '全公司',
      date: params.date,
      note: params.note || '',
      category: params.category || '',
    };

    // 通过客户名查找 customer_id
    if (params.customer_name) {
      const custResp = await api.get('/api/customers', {}, token);
      if (custResp.status < 400) {
        const found = custResp.data.find(c => c.name === params.customer_name);
        if (found) body.customer_id = found.id;
      }
    }

    // 通过商品名查找 product_id
    if (params.product_name) {
      const prodResp = await api.get('/api/products', {}, token);
      if (prodResp.status < 400) {
        const found = prodResp.data.find(p => p.name === params.product_name);
        if (found) body.product_id = found.id;
      }
    }

    const resp = await api.post('/api/transactions', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增收支记录：${params.type} ${params.amount}元` };
  },

  async update_transaction(params, token) {
    const body = {};
    if (params.amount !== undefined) body.amount = params.amount;
    if (params.type !== undefined) body.type = params.type;
    if (params.unit !== undefined) body.unit = params.unit;
    if (params.date !== undefined) body.date = params.date;
    if (params.note !== undefined) body.note = params.note;
    const resp = await api.put(`/api/transactions/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改记录 #${params.id}` };
  },

  async delete_transaction(params, token) {
    const resp = await api.del(`/api/transactions/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除记录 #${params.id}` };
  },

  // ---- 客户 ----
  async get_customers(params, token) {
    const resp = await api.get('/api/customers', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    // 客户端关键词过滤（API 不支持搜索参数）
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      rows = rows.filter(c => c.name.toLowerCase().includes(kw));
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 个客户` };
  },

  async add_customer(params, token) {
    const body = { name: params.name, type: params.type, contact: params.contact || '', address: params.address || '' };
    const resp = await api.post('/api/customers', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增客户：${params.name}` };
  },

  async update_customer(params, token) {
    const body = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.type !== undefined) body.type = params.type;
    if (params.contact !== undefined) body.contact = params.contact;
    if (params.address !== undefined) body.address = params.address;
    const resp = await api.put(`/api/customers/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改客户 #${params.id}` };
  },

  async delete_customer(params, token) {
    const resp = await api.del(`/api/customers/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除客户 #${params.id}` };
  },

  // ---- 商品 ----
  async get_products(params, token) {
    const resp = await api.get('/api/products', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      rows = rows.filter(p => p.name.toLowerCase().includes(kw) || (p.brand || '').toLowerCase().includes(kw));
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 个商品` };
  },

  async add_product(params, token) {
    const body = {
      name: params.name,
      brand: params.brand || '',
      unit: params.unit || '件',
      category1: params.category1,
      category2: params.category2 || '',
      purchase_price: params.purchase_price || 0,
      sale_price: params.sale_price || 0,
    };
    const resp = await api.post('/api/products', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增商品：${params.name}` };
  },

  async update_product(params, token) {
    const body = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.brand !== undefined) body.brand = params.brand;
    if (params.purchase_price !== undefined) body.purchase_price = params.purchase_price;
    if (params.sale_price !== undefined) body.sale_price = params.sale_price;
    const resp = await api.put(`/api/products/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改商品 #${params.id}` };
  },

  async delete_product(params, token) {
    const resp = await api.del(`/api/products/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除商品 #${params.id}` };
  },

  // ---- 库存 ----
  async get_inventory(params, token) {
    const resp = await api.get('/api/inventory', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 条库存记录` };
  },

  async update_inventory(params, token) {
    const body = { product_id: params.product_id, quantity: params.quantity };
    if (params.avg_price !== undefined) body.avg_price = params.avg_price;
    const resp = await api.post('/api/inventory', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已更新库存：商品ID ${params.product_id}，数量 ${params.quantity}` };
  },

  // ---- 合同 ----
  async get_contracts(params, token) {
    const resp = await api.get('/api/contracts', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 个合同` };
  },

  async add_contract(params, token) {
    const body = {
      contract_no: params.contract_no,
      customer_id: params.customer_id,
      amount: params.amount,
      status: params.status || '进行中',
      start_date: params.start_date || '',
      end_date: params.end_date || '',
      note: params.note || '',
    };
    const resp = await api.post('/api/contracts', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增合同：${params.contract_no}` };
  },

  // ---- 员工 ----
  async get_employees(params, token) {
    const resp = await api.get('/api/employees', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    // 客户端状态过滤（API 不支持 status 参数）
    if (params.status && params.status !== 'all') {
      rows = rows.filter(e => (e.status || 'active') === params.status);
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 名员工` };
  },

  async add_employee(params, token) {
    const body = {
      name: params.name,
      position: params.position || '',
      hourly_rate: params.hourly_rate,
      join_date: params.join_date || '',
    };
    const resp = await api.post('/api/employees', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增员工：${params.name}（${params.position || '未设岗位'}，时薪${params.hourly_rate}元）` };
  },

  async set_employee_status(params, token) {
    const body = {
      status: params.status,
      leave_date: params.leave_date || '',
      note: params.note || '',
    };
    const resp = await api.patch(`/api/employees/${params.employee_id}/status`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const action = params.status === 'left' ? '离职' : '复职';
    return { success: true, message: `已办理员工 #${params.employee_id} ${action}` };
  },

  async record_work_hours(params, token) {
    const body = {
      employee_id: params.employee_id,
      hours: params.hours,
      month: params.month,
    };
    const resp = await api.post('/api/workhours', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已记录员工 #${params.employee_id} ${params.month} 月工时：${params.hours}小时` };
  },

  async get_work_hours(params, token) {
    const query = {};
    if (params.month) query.month = params.month;
    const resp = await api.get('/api/workhours', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `找到 ${resp.data.length} 条工时记录` };
  },

  // ---- 经营分析摘要（基于 transactions 二次计算） ----
  async get_analysis_summary(params, token) {
    const query = {};
    if (params.startDate) query.startDate = params.startDate;
    if (params.endDate) query.endDate = params.endDate;
    if (params.unit) query.unit = params.unit;
    const resp = await api.get('/api/transactions', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const txns = resp.data;

    const sumByType = (type) => txns.filter(t => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);
    const salesIncome = sumByType('销售收入');
    const cashIncome = sumByType('现金收入');
    const otherIncome = sumByType('其他收入');
    const totalIncome = salesIncome + cashIncome + otherIncome;

    const materialExpense = sumByType('材料采购');
    const processExpense = sumByType('委托加工');
    const miscExpense = sumByType('杂费支出');
    const taxExpense = sumByType('税金');
    const totalExpense = materialExpense + processExpense + miscExpense + taxExpense;

    const addedValue = totalIncome - materialExpense - processExpense - miscExpense - taxExpense;

    return {
      success: true,
      data: {
        income: { salesIncome, cashIncome, otherIncome, totalIncome, receivable: salesIncome - cashIncome },
        expense: { materialExpense, processExpense, miscExpense, taxExpense, totalExpense },
        addedValue,
        transactionCount: txns.length,
      },
      message: `经营分析摘要（${txns.length} 条记录）`,
    };
  },

  // ---- 设置 ----
  async get_settings(params, token) {
    const resp = await api.get('/api/settings', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: '当前账号设置' };
  },

  async get_expense_types(params, token) {
    const resp = await api.get('/api/expense-types', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 个收支类型` };
  },
};

module.exports = { TOOL_DEFINITIONS, TOOL_HANDLERS };
```

**Step 2: 提交**

```bash
git add ai/tools.js
git commit -m "feat: define AI tools that call existing RESTful API (no direct DB access)"
```

---

## Task 4: 编写系统提示词

**Files:**
- Create: `ai/prompts.js`

**Step 1: 编写 `ai/prompts.js`**

```javascript
/**
 * ai/prompts.js — AI 系统提示词
 * 定义 AI 助手的人设、业务知识边界、工具使用指引。
 */

function buildSystemPrompt(userName, displayName) {
  return `你是「阿米巴经营数字助手」的 AI 助手，服务于微小企业经营者。

## 你的角色
- 你是经营数据分析与操作助手，帮助用户通过自然语言完成日常经营管理操作
- 当前登录用户：${displayName || userName || '未知用户'}
- 你拥有完整的业务操作能力：查询数据、新增记录、修改信息、删除记录、经营分析

## 业务领域知识
本系统面向服装行业微小企业，核心是「阿米巴经营」理念：
1. **阿米巴核心指标**：附加价值 = 总收入 - 消费支出 - 杂费支出；总利润 = 附加价值 - 总工资 - 税金
2. **收支类型**：销售收入、现金收入、其他收入（收入类）；材料采购、委托加工、杂费支出、税金、现金支出（支出类）
3. **支出细分**：委托加工（染色费/制造费用/后整理费）；杂费支出（培训费/差旅费/水电费等）
4. **员工工资不计入经营支出**（阿米巴体系中工资是经营成果共享对象）
5. **多部门独立核算**：可按"全公司/销售部/生产部/行政部"等维度分别统计
6. **多币种**：数据以人民币存储，支持按实时汇率折算显示

## 工具使用规则
1. 用户请求涉及查询数据 → 先调用对应查询工具获取真实数据，再基于数据回答
2. 用户请求涉及新增/修改/删除 → 调用对应操作工具执行，确认结果后回复
3. 用户提到客户名/商品名/员工名 → 先用 get_customers/get_products/get_employees 查找 ID
4. 多步骤操作 → 逐步调用工具，每步确认后再继续
5. 工具返回的金额单位均为人民币元，工时单位为小时

## 回复规范
1. 用中文回复，语气专业但友好
2. 数据展示使用 Markdown 表格，金额格式为 "¥1,234.56"
3. 操作结果要明确告知成功/失败及影响
4. 经营分析类问题要给出数据解读和简要建议
5. 如果用户请求超出工具能力范围，诚实告知并提供替代方案
6. 不要编造数据，所有数据必须来自工具调用结果

## 安全规则
1. 不要执行用户未明确请求的危险操作（如批量删除）而不确认
2. 删除操作前建议用户确认
3. 不要泄露系统内部信息（如数据库结构、API 路径等）`;
}

module.exports = { buildSystemPrompt };
```

**Step 2: 提交**

```bash
git add ai/prompts.js
git commit -m "feat: add system prompt for AI assistant with business domain knowledge"
```

---

## Task 5: 实现 AI 引擎（Function Calling 调度循环）

**Files:**
- Create: `ai/engine.js`

**关键变化：** `executeToolCall` 传入 `token`（用户 JWT）而非 `userId`，工具用 `token` 调用 RESTful API。

**Step 1: 编写 `ai/engine.js`**

```javascript
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
```

**Step 2: 提交**

```bash
git add ai/engine.js
git commit -m "feat: implement AI engine with Function Calling loop (passes JWT token to tools)"
```

---

## Task 6: 创建 AI 路由（SSE 流式 + REST）并在 server.js 注入 app

**Files:**
- Create: `routes/ai.js`
- Modify: `server.js`

**关键变化：** `routes/ai.js` 从请求头提取 JWT token 传给 engine；`server.js` 需调用 `apiClient.setApp(app)` 注入 Express 实例。

**Step 1: 编写 `routes/ai.js`**

```javascript
/**
 * routes/ai.js — AI 对话路由
 * 提供两个端点：
 * 1. POST /api/ai/chat — SSE 流式对话（前端 EventSource 消费）
 * 2. POST /api/ai/chat-sync — 非流式对话（简单集成场景）
 * 所有端点需 requireAuth 认证，工具通过用户 JWT 调用已有 RESTful API。
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { converse, converseStream } = require('../ai/engine');

const router = express.Router();

// 从请求中提取 JWT token（传给工具用于调用 RESTful API）
function extractToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// SSE 流式对话
router.post('/chat', requireAuth, async (req, res) => {
  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少消息内容' });
  }

  const token = extractToken(req);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx 关闭缓冲
  });

  // 发送 SSE 事件
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('start', { userId: req.user.id });

    await converseStream(
      messages,
      { id: req.user.id, username: req.user.username, display_name: req.user.display_name },
      token,
      // onText
      (text) => sendEvent('text', { text }),
      // onToolStart
      (toolName) => sendEvent('tool_start', { name: toolName }),
      // onToolEnd
      (toolName, result) => sendEvent('tool_end', { name: toolName, success: result.success, message: result.message, data: result.data })
    );

    sendEvent('done', {});
  } catch (err) {
    console.error('[AI Chat] SSE 错误:', err.message);
    sendEvent('error', { message: err.message });
  } finally {
    res.end();
  }
});

// 非流式对话
router.post('/chat-sync', requireAuth, async (req, res) => {
  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少消息内容' });
  }

  const token = extractToken(req);

  try {
    const result = await converse(
      messages,
      { id: req.user.id, username: req.user.username, display_name: req.user.display_name },
      token
    );
    res.json(result);
  } catch (err) {
    console.error('[AI Chat] 错误:', err.message);
    res.status(500).json({ error: 'AI 服务暂时不可用：' + err.message });
  }
});

module.exports = router;
```

**Step 2: 修改 `server.js` — 挂载 AI 路由 + 注入 app 到 apiClient**

在 `server.js` 中需要做两件事：
1. 引入 `apiClient` 并在 app 创建后调用 `apiClient.setApp(app)`
2. 引入并挂载 `routes/ai.js`

修改 `server.js`，在 `const app = express();` 之后添加 `apiClient.setApp(app)`，在路由注册部分添加 `app.use('/api/ai', aiRoutes)`。

具体修改位置（`server.js` 第 10-14 行区域）：

```javascript
const db = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const businessRoutes = require('./routes/index');
const exchangeRoutes = require('./routes/exchange');
const aiRoutes = require('./routes/ai');
const apiClient = require('./ai/api-client');
```

在 `const app = express();` 之后添加：

```javascript
// 注入 Express app 到 AI apiClient（工具通过它调用已有 RESTful API）
apiClient.setApp(app);
```

在路由注册部分（`app.use('/api', businessRoutes);` 之后）添加：

```javascript
// AI 对话路由（需在 businessRoutes 之后，避免 /api/ai 被 /api/* 兜底）
app.use('/api/ai', aiRoutes);
```

注意：`apiClient.setApp(app)` 必须在所有路由注册**之前**调用，确保工具调用时路由已就绪。但由于 `app.handle()` 是运行时调用的（用户发消息时），路由注册在 `setApp` 之后执行也没问题——只要在第一次 AI 请求之前完成注册即可。

**Step 3: 提交**

```bash
git add routes/ai.js server.js
git commit -m "feat: add AI chat routes with SSE streaming; inject Express app into apiClient"
```

---

## Task 7: 前端 AI 对话面板 — HTML 结构

**Files:**
- Modify: `public/index.html`

**Step 1: 在 `</body>` 前添加 AI 对话面板 HTML 和 marked 库**

在 `public/index.html` 的最后一个 `<script>` 标签（app.js）之后、`</body>` 之前添加：

```html
<!-- ========== AI 对话面板 ========== -->
<div id="aiChatToggle" class="ai-chat-toggle" title="AI 助手">
  <span class="ai-toggle-icon">🤖</span>
</div>

<div id="aiChatPanel" class="ai-chat-panel" style="display:none;">
  <div class="ai-chat-header">
    <div class="ai-chat-title">
      <span class="ai-chat-avatar">🤖</span>
      <span>AI 经营助手</span>
    </div>
    <div class="ai-chat-actions">
      <button class="ai-chat-btn" id="aiChatClear" title="清空对话">🗑</button>
      <button class="ai-chat-btn" id="aiChatClose" title="关闭">×</button>
    </div>
  </div>
  <div class="ai-chat-body" id="aiChatBody">
    <div class="ai-chat-welcome">
      <div class="ai-welcome-icon">👋</div>
      <p>你好！我是 AI 经营助手，可以帮你：</p>
      <div class="ai-quick-actions" id="aiQuickActions">
        <button class="ai-quick-btn" data-prompt="这个月的经营情况怎么样？">📊 本月经营概况</button>
        <button class="ai-quick-btn" data-prompt="帮我查看所有客户列表">👥 查看客户</button>
        <button class="ai-quick-btn" data-prompt="本月有哪些支出？按类型汇总">💰 支出汇总</button>
        <button class="ai-quick-btn" data-prompt="哪些客户还有应收款？">📋 应收账款</button>
        <button class="ai-quick-btn" data-prompt="帮我看看库存情况">📦 库存查询</button>
        <button class="ai-quick-btn" data-prompt="本月员工工时和工资是多少？">👤 工时工资</button>
      </div>
    </div>
  </div>
  <div class="ai-chat-footer">
    <div class="ai-chat-input-wrap">
      <textarea id="aiChatInput" class="ai-chat-input" placeholder="输入你的问题...（Shift+Enter 换行）" rows="1"></textarea>
      <button id="aiChatSend" class="ai-chat-send">发送</button>
    </div>
    <div class="ai-chat-hint">AI 可能出错，重要数据请核实</div>
  </div>
</div>

<!-- Markdown 渲染库 -->
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>
<script src="js/ai-chat.js?v=20260723a"></script>
```

**Step 2: 提交**

```bash
git add public/index.html
git commit -m "feat: add AI chat panel HTML structure and marked.js"
```

---

## Task 8: 前端 AI 对话面板 — CSS 样式

**Files:**
- Modify: `public/css/style.css`

**Step 1: 在 `style.css` 末尾追加 AI 对话面板样式**

```css
/* ========== AI 对话面板 ========== */
.ai-chat-toggle {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 9998;
  transition: transform 0.2s, box-shadow 0.2s;
}
.ai-chat-toggle:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(102, 126, 234, 0.5); }
.ai-toggle-icon { font-size: 28px; }

.ai-chat-panel {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 420px;
  max-width: 100vw;
  height: 600px;
  max-height: 100vh;
  background: #fff;
  border-radius: 12px 0 0 0;
  box-shadow: -4px 0 24px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
@media (max-width: 600px) {
  .ai-chat-panel { width: 100vw; height: 100vh; border-radius: 0; }
}

.ai-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border-radius: 12px 12px 0 0;
}
.ai-chat-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
.ai-chat-avatar { font-size: 20px; }
.ai-chat-actions { display: flex; gap: 4px; }
.ai-chat-btn {
  background: rgba(255,255,255,0.2);
  border: none;
  color: #fff;
  width: 28px; height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.ai-chat-btn:hover { background: rgba(255,255,255,0.35); }

.ai-chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f7f8fa;
}

.ai-chat-welcome { text-align: center; padding: 20px 0; }
.ai-welcome-icon { font-size: 40px; margin-bottom: 8px; }
.ai-chat-welcome p { color: #666; font-size: 14px; margin: 0 0 16px; }
.ai-quick-actions { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.ai-quick-btn {
  background: #fff;
  border: 1px solid #e0e3e8;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  transition: all 0.15s;
  width: 90%;
  text-align: left;
}
.ai-quick-btn:hover { border-color: #667eea; color: #667eea; background: #f0f3ff; }

/* 消息气泡 */
.ai-msg { display: flex; gap: 8px; max-width: 100%; }
.ai-msg.user { flex-direction: row-reverse; }
.ai-msg-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.ai-msg.bot .ai-msg-avatar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.ai-msg.user .ai-msg-avatar { background: #e8edf3; }
.ai-msg-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.ai-msg.bot .ai-msg-bubble { background: #fff; border: 1px solid #e8edf3; }
.ai-msg.user .ai-msg-bubble { background: #667eea; color: #fff; }
.ai-msg-bubble table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
.ai-msg-bubble th, .ai-msg-bubble td { border: 1px solid #e0e3e8; padding: 6px 10px; text-align: left; }
.ai-msg-bubble th { background: #f7f8fa; font-weight: 600; }
.ai-msg-bubble code { background: #f0f3ff; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.ai-msg-bubble ul, .ai-msg-bubble ol { margin: 8px 0; padding-left: 20px; }

/* 工具执行状态 */
.ai-tool-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f0f3ff;
  border-radius: 8px;
  font-size: 12px;
  color: #667eea;
  max-width: 80%;
}
.ai-tool-status .spinner {
  width: 14px; height: 14px;
  border: 2px solid #667eea;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ai-spin 0.6s linear infinite;
}
@keyframes ai-spin { to { transform: rotate(360deg); } }
.ai-tool-status.done { color: #52c41a; background: #f0fff4; }
.ai-tool-status.done .spinner { display: none; }
.ai-tool-status.error { color: #ff4d4f; background: #fff2f0; }
.ai-tool-status.error .spinner { display: none; }

/* 打字指示器 */
.ai-typing { display: flex; gap: 4px; padding: 10px 14px; }
.ai-typing span {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #bbb;
  animation: ai-bounce 1.4s infinite ease-in-out;
}
.ai-typing span:nth-child(2) { animation-delay: 0.2s; }
.ai-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-8px); opacity: 1; }
}

.ai-chat-footer { padding: 12px 16px; border-top: 1px solid #e8edf3; background: #fff; }
.ai-chat-input-wrap { display: flex; gap: 8px; align-items: flex-end; }
.ai-chat-input {
  flex: 1;
  border: 1px solid #e0e3e8;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  resize: none;
  max-height: 120px;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.ai-chat-input:focus { border-color: #667eea; }
.ai-chat-send {
  background: #667eea;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.ai-chat-send:hover { background: #5a6fd8; }
.ai-chat-send:disabled { background: #ccc; cursor: not-allowed; }
.ai-chat-hint { font-size: 11px; color: #bbb; text-align: center; margin-top: 6px; }
```

**Step 2: 提交**

```bash
git add public/css/style.css
git commit -m "feat: add AI chat panel styles (floating button, chat bubbles, tool status)"
```

---

## Task 9: 前端 AI 对话面板 — JavaScript 逻辑

**Files:**
- Create: `public/js/ai-chat.js`
- Modify: `public/js/app.js`

**Step 1: 编写 `public/js/ai-chat.js`**

```javascript
/**
 * ai-chat.js — AI 对话面板前端组件
 * 通过 fetch + ReadableStream 接收 SSE 流式回复，
 * 支持 Markdown 渲染、工具执行状态显示、快捷操作。
 */
const AIChat = (() => {
  let messages = [];       // 对话历史（发给后端的）
  let isStreaming = false;  // 是否正在流式接收
  let abortController = null;

  const panel = () => document.getElementById('aiChatPanel');
  const body = () => document.getElementById('aiChatBody');
  const input = () => document.getElementById('aiChatInput');
  const sendBtn = () => document.getElementById('aiChatSend');

  // ========== 面板开关 ==========
  function togglePanel() {
    const p = panel();
    if (p.style.display === 'none') {
      p.style.display = 'flex';
      input().focus();
    } else {
      p.style.display = 'none';
    }
  }

  function closePanel() { panel().style.display = 'none'; }

  function clearChat() {
    messages = [];
    body().innerHTML = `
      <div class="ai-chat-welcome">
        <div class="ai-welcome-icon">👋</div>
        <p>你好！我是 AI 经营助手，可以帮你查询数据、录入记录、分析经营状况。</p>
        <div class="ai-quick-actions" id="aiQuickActions">
          <button class="ai-quick-btn" data-prompt="这个月的经营情况怎么样？">📊 本月经营概况</button>
          <button class="ai-quick-btn" data-prompt="帮我查看所有客户列表">👥 查看客户</button>
          <button class="ai-quick-btn" data-prompt="本月有哪些支出？按类型汇总">💰 支出汇总</button>
          <button class="ai-quick-btn" data-prompt="哪些客户还有应收款？">📋 应收账款</button>
          <button class="ai-quick-btn" data-prompt="帮我看看库存情况">📦 库存查询</button>
          <button class="ai-quick-btn" data-prompt="本月员工工时和工资是多少？">👤 工时工资</button>
        </div>
      </div>`;
    bindQuickActions();
  }

  // ========== 消息渲染 ==========
  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'ai-msg user';
    el.innerHTML = `<div class="ai-msg-avatar">👤</div><div class="ai-msg-bubble"></div>`;
    el.querySelector('.ai-msg-bubble').textContent = text;
    body().appendChild(el);
    scrollToBottom();
  }

  function addBotMessage() {
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.innerHTML = `<div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble"></div>`;
    body().appendChild(el);
    scrollToBottom();
    return el.querySelector('.ai-msg-bubble');
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.id = 'aiTypingIndicator';
    el.innerHTML = `<div class="ai-msg-avatar">🤖</div><div class="ai-typing"><span></span><span></span><span></span></div>`;
    body().appendChild(el);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const el = document.getElementById('aiTypingIndicator');
    if (el) el.remove();
  }

  function addToolStatus(toolName) {
    const el = document.createElement('div');
    el.className = 'ai-tool-status';
    el.dataset.toolName = toolName;
    el.innerHTML = `<span class="spinner"></span><span>正在执行：${toolName}...</span>`;
    body().appendChild(el);
    scrollToBottom();
    return el;
  }

  function updateToolStatus(el, result) {
    if (!el) return;
    if (result.success) {
      el.classList.add('done');
      el.innerHTML = `<span>✓</span><span>${result.message || '操作成功'}</span>`;
    } else {
      el.classList.add('error');
      el.innerHTML = `<span>✕</span><span>${result.message || '操作失败'}</span>`;
    }
  }

  function renderMarkdown(text) {
    try {
      return marked.parse(text, { breaks: true });
    } catch (e) {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
  }

  function scrollToBottom() {
    const b = body();
    b.scrollTop = b.scrollHeight;
  }

  // ========== 发送消息（SSE 流式） ==========
  async function sendMessage(text) {
    if (!text || !text.trim() || isStreaming) return;
    text = text.trim();

    // 添加到消息历史
    messages.push({ role: 'user', content: text });
    addUserMessage(text);
    input().value = '';
    autoResize();
    setStreaming(true);

    const bubble = addBotMessage();
    addTypingIndicator();

    let fullText = '';

    try {
      abortController = new AbortController();
      const token = localStorage.getItem('amoeba_token') || '';

      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ messages }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: '请求失败' }));
        throw new Error(errData.error || `请求失败 (${resp.status})`);
      }

      removeTypingIndicator();

      // 读取 SSE 流
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              handleSSEEvent(currentEvent, data, bubble, fullText, (newText) => {
                fullText = newText;
                bubble.innerHTML = renderMarkdown(fullText);
                scrollToBottom();
              });
              // handleSSEEvent 可能更新 fullText
              if (currentEvent === 'text' && data.text) {
                fullText += data.text;
                bubble.innerHTML = renderMarkdown(fullText);
                scrollToBottom();
              }
            } catch (e) { /* 忽略解析错误 */ }
            currentEvent = null;
          }
        }
      }

      // 将 AI 回复加入历史
      if (fullText) {
        messages.push({ role: 'assistant', content: fullText });
      }
    } catch (err) {
      removeTypingIndicator();
      if (err.name === 'AbortError') {
        bubble.innerHTML = '<em style="color:#999;">已取消</em>';
      } else {
        bubble.innerHTML = `<span style="color:#ff4d4f;">⚠ ${err.message}</span>`;
      }
    } finally {
      setStreaming(false);
      abortController = null;
    }
  }

  function handleSSEEvent(event, data, bubble, currentText, onTextUpdate) {
    switch (event) {
      case 'tool_start':
        addToolStatus(data.name);
        break;
      case 'tool_end':
        // 找到最后一个匹配的未完成 tool-status 元素
        const statusEls = body().querySelectorAll(`.ai-tool-status[data-tool-name="${data.name}"]:not(.done):not(.error)`);
        if (statusEls.length > 0) {
          updateToolStatus(statusEls[statusEls.length - 1], data);
        }
        break;
      case 'error':
        bubble.innerHTML += `<div style="color:#ff4d4f;">⚠ ${data.message}</div>`;
        break;
      case 'done':
        break;
    }
  }

  function setStreaming(val) {
    isStreaming = val;
    sendBtn().disabled = val;
    sendBtn().textContent = val ? '...' : '发送';
    input().disabled = val;
  }

  // ========== 事件绑定 ==========
  function autoResize() {
    const inp = input();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  }

  function bindQuickActions() {
    document.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sendMessage(btn.dataset.prompt);
      });
    });
  }

  function bind() {
    document.getElementById('aiChatToggle').addEventListener('click', togglePanel);
    document.getElementById('aiChatClose').addEventListener('click', closePanel);
    document.getElementById('aiChatClear').addEventListener('click', clearChat);

    const inp = input();
    const btn = sendBtn();

    btn.addEventListener('click', () => sendMessage(inp.value));

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inp.value);
      }
    });

    inp.addEventListener('input', autoResize);

    bindQuickActions();
  }

  return { bind, togglePanel, sendMessage };
})();
```

**Step 2: 在 `app.js` 的 `init()` 中调用 `AIChat.bind()`**

在 `public/js/app.js` 的 `init` 函数中，`Auth.bindLogin();` 之后添加：
```javascript
    AIChat.bind();
```

**Step 3: 提交**

```bash
git add public/js/ai-chat.js public/js/app.js
git commit -m "feat: implement AI chat panel JS (SSE streaming, markdown, tool status)"
```

---

## Task 10: 端到端测试与修复

**Files:**
- All AI-related files

**Step 1: 创建 `.env` 并配置 LLM API Key**

```bash
cp .env.example .env
# 编辑 .env 填入真实的 LLM_API_KEY
```

**Step 2: 启动服务并验证**

Run: `cd c:\Users\shine\projects\amiba_digital_assistant && node -r dotenv/config server.js`
Expected: 服务正常启动，输出 `阿米巴经营数字助手 已启动`

**Step 3: 验证 AI 同步端点**

```powershell
# 先登录获取 token
$loginResp = Invoke-RestMethod -Uri http://localhost:3000/api/auth/login -Method Post -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}'
$token = $loginResp.token

# 测试 AI 同步对话
$headers = @{Authorization="Bearer $token"; "Content-Type"="application/json"}
$body = '{"messages":[{"role":"user","content":"你好"}]}'
Invoke-RestMethod -Uri http://localhost:3000/api/ai/chat-sync -Method Post -Headers $headers -Body $body
```
Expected: 返回 `{ reply: "...", toolCallsSummary: [] }`

**Step 4: 验证 SSE 流式端点（含工具调用）**

```powershell
$body = '{"messages":[{"role":"user","content":"本月经营情况怎么样？"}]}'
Invoke-WebRequest -Uri http://localhost:3000/api/ai/chat -Method Post -Headers $headers -Body $body -TimeoutSec 30
```
Expected: 收到 SSE 事件流（`event: start` → `event: tool_start` → `event: tool_end` → `event: text` → `event: done`）

**Step 5: 前端验证**

1. 打开浏览器 `http://localhost:3000`
2. 登录 admin / admin123
3. 点击右下角 🤖 按钮打开对话面板
4. 点击快捷按钮"本月经营概况"
5. 验证：
   - 工具执行状态显示（spinner → ✓）
   - Markdown 表格正确渲染
   - 流式文字逐字显示
   - 可继续追问

**Step 6: 验证数据一致性**

1. 通过 AI 对话新增一条收支记录："帮我新增一笔销售收入，金额1000元，日期2026-07-23"
2. 切换到"收支查询"页面，确认该记录存在且数据正确
3. 通过 AI 删除该记录："删除刚才那条记录"
4. 确认记录已删除

**Step 7: 修复发现的问题**

根据测试结果修复任何 bug。

**Step 8: 提交**

```bash
git add -A
git commit -m "fix: end-to-end testing fixes for AI chat integration"
```

---

## Task 11: 更新 README 文档

**Files:**
- Modify: `README.md`

**Step 1: 在 `README.md` 末尾添加 AI 助手章节**

```markdown
---

## AI 经营助手

本应用已集成 AI 对话助手，用户可通过自然语言完成全部业务操作。

### 功能

- **智能查询**：「本月经营情况」「哪些客户有应收款」「库存有哪些」
- **数据录入**：「新增客户张三，公司类型」「记录员工李师傅本月工时80小时」
- **经营分析**：「分析一下这个月的支出结构」「哪些商品销售额最高」
- **操作执行**：「删除编号为5的收支记录」「把张三的时薪改为40」

### 使用方式

1. 点击页面右下角 🤖 按钮打开对话面板
2. 输入问题或点击快捷操作按钮
3. AI 会自动调用后端工具执行操作并返回结果

### 配置

AI 服务需要配置 LLM API 密钥。复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
# 编辑 .env 填入 API Key
LLM_API_KEY=sk-your-key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

支持的 LLM 提供商（均兼容 OpenAI API 格式）：
- DeepSeek（推荐，性价比高）
- OpenAI GPT-4o-mini
- 通义千问 qwen-plus

### 技术架构

```
用户输入 → 前端 ai-chat.js → POST /api/ai/chat (SSE)
                                    ↓
                           ai/engine.js (调度循环)
                              ↓               ↑
                      ai/llm-client.js   ai/tools.js (25+ 工具)
                      (调用 LLM API)         ↓
                                        ai/api-client.js
                                        (调用已有 /api/* 路由)
                                             ↓
                                        Express 路由层
                                        (复用全部业务逻辑)
```

AI 通过 Function Calling 调用后端定义的业务工具，
工具通过内部 HTTP 请求调用已有的 RESTful API（`/api/transactions`、`/api/customers` 等），
复用全部业务校验和数据隔离逻辑，与前端操作完全一致。
```

**Step 2: 提交**

```bash
git add README.md
git commit -m "docs: add AI assistant section to README"
```

---

## 任务依赖关系

```
Task 1 (LLM 客户端) ──────┐
Task 2 (内部 API 客户端) ──┤
Task 3 (工具定义) ─────────┼→ Task 5 (AI 引擎) ─→ Task 6 (路由+server.js) ─→ Task 10 (测试)
Task 4 (提示词) ───────────┘                                              ↑
                                                            Task 9 (前端JS) ┘
                                                                    ↑
Task 7 (HTML) → Task 8 (CSS) ────────────────────────────────────────┘

Task 11 (文档) — 最后执行
```

**并行机会：**
- Task 1、2、3、4 可并行（互不依赖）
- Task 7、8 可并行
- Task 9 依赖 Task 7（需要 HTML 元素存在）
