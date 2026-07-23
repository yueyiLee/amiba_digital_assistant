# 阿米巴经营数字助手

面向微小企业的阿米巴经营数据记录与分析平台。

## 功能概览

- **经营看板**：15 项阿米巴核心指标实时计算，收支趋势图、支出/收入构成图，支持币种切换（人民币/美元/欧元实时汇率折算）
- **数据录入**：5 步引导式收支录入，支持关联客户和商品，支持关键词搜索
- **业务管理**：合同、客户、商品、库存四模块独立 CRUD
- **员工管理**：员工信息、月度工时、工资自动计算，岗位预设服装行业常用选项
- **系统设置**：部门独立核算、币种配置、数据导出格式
- **用户管理**：三级权限（管理员/录入员/查看者），JWT 认证

## 技术栈

- 后端：Node.js + Express + better-sqlite3（同步 SQLite）
- 认证：JWT + bcryptjs 密码加密
- 前端：原生 JavaScript + Chart.js 图表
- 汇率：Frankfurter API（欧洲央行数据源）

## 本地运行

```bash
# 1. 解压代码包
unzip amoeba-app.zip
cd amoeba-app

# 2. 安装依赖
npm install

# 3. 启动服务
node server.js

# 4. 浏览器访问
# http://localhost:3000
```

## 默认账号

| 角色 | 用户名 | 密码 | 权限 |
|------|--------|------|------|
| 系统管理员 | admin | admin123 | 全部功能 + 用户管理 |
| 数据录入员 | editor | editor123 | 录入/业务/员工管理 |
| 查看者 | viewer | viewer123 | 仅查看（需管理员创建） |

## 分享给合作方的方式

### 方式一：代码包分享（推荐）

将 `amoeba-app.zip` 发送给合作方，对方解压后执行：

```bash
npm install && node server.js
```

即可在本地 `http://localhost:3000` 访问。

### 方式二：部署到云服务器

```bash
# 上传代码到服务器
scp -r amoeba-app user@your-server:/opt/

# 服务器上安装 Node.js 18+，然后：
cd /opt/amoeba-app
npm install
node server.js

# 配置 Nginx 反向代理（可选）
# 将 80 端口转发到 3000
```

### 方式三：使用内网穿透工具

```bash
# 方案 A：ngrok
ngrok http 3000
# 获得类似 https://xxxx.ngrok.io 的公开链接

# 方案 B：localtunnel
npx localtunnel --port 3000
# 获得类似 https://xxxx.loca.lt 的公开链接
```

注意：内网穿透方案适合临时演示，不适合长期使用。

## 数据说明

- 数据库为 SQLite，文件位于 `database.sqlite`，首次启动自动创建并填充演示数据
- 所有金额以人民币存储，切换币种时在显示层按实时汇率折算
- 支持导出 CSV/JSON 格式数据

---

## 部署到 CloudBase 云函数（HTTP / Web 函数）

本应用已改造为兼容 CloudBase 云函数部署。生产环境使用 CloudBase 内置 PostgreSQL，
本地开发仍可使用原生 `pg` 连接池（见 `db.js` 双模式设计）。

### 部署形态

- **函数类型**：HTTP（Web 函数），监听端口 `9000`
- **启动脚本**：`scf_bootstrap`（设置 `PORT=9000` 并启动 `node server.js`）
- **运行时**：Nodejs 18.15
- **访问入口**：网关默认域名，已关闭访问鉴权（`EnableAuth=false`）
- **健康检查**：`GET /api/health`（无需登录，返回 `{ status, db }`）

### 关键环境变量

| 变量 | 说明 |
|------|------|
| `PG_HOST` | CloudBase 内置 PG 主机（形如 `<envId>.pg.rdb.cloud.tencent.com`，仅本地 pg 模式使用） |
| `PG_PORT` | `5432` |
| `PG_USER` | 数据库用户名（如 `amoeba`） |
| `PG_PASSWORD` | 数据库密码 |
| `PG_DATABASE` | 库名（如 `postgres`） |

> 云端运行时由 SCF 自动注入临时密钥（`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` /
> `TENCENTCLOUD_SESSIONTOKEN`），`db.js` 会调用 `CloudBase.manager-node` 的
> `executePGSql` 免密访问内置 PostgreSQL，**无需配置任何数据库密钥**。

### 双模式数据库连接（db.js）

- **云端**：检测到 `TENCENTCLOUD_SECRETID` 等临时密钥 → 走 `executePGSql` SDK。
- **本地**：未检测到 → 走 `pg` 原生连接池，连接上述 `PG_*` 环境变量。
- 对上层暴露的 `query / queryOne / queryAll / init` 接口保持不变，路由层零改动。

### 依赖打包注意事项（重要）

CloudBase Web 函数打包器默认忽略 `node_modules`，且 `InstallDependency` 在 Web 函数下
不会可靠安装依赖。因此在部署目录中：

1. 将依赖目录重命名为 `nm`（规避打包器对 `node_modules` 的内置忽略）；
2. `scf_bootstrap` 在启动时将 `nm` 还原为 `node_modules` 再启动 `node server.js`：

   ```bash
   #!/bin/bash
   export PORT=9000
   if [ -d nm ] && [ ! -d node_modules ]; then
     mv nm node_modules
   fi
   node server.js
   ```

> `.gitignore` / `.dockerignore` 中已移除对 `node_modules` 的忽略，部署目录需自带 `nm`。

### 部署命令（通过 CloudBase MCP）

```bash
# 需将函数目录置于 MCP 运行时 work 目录下，例如 work/amoeba-fn
manageFunctions(action="updateFunctionCode", functionName="amoeba-fn",
                functionRootPath="<mcp-runtime>/work")
# 创建公网访问入口
manageGateway(action="createAccess", targetType="function", targetName="amoeba-fn",
              path="/", type="HTTP", auth=false)
```

### 验证

```bash
# 健康检查（db.ready=true 表示已连上内置 PostgreSQL）
curl https://<envId>.service.tcloudbase.com/api/health

# 登录（默认管理员）
curl -X POST https://<envId>.service.tcloudbase.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

默认管理员账号：`admin / admin123`；录入员：`editor / editor123`。

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

