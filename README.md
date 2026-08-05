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

- 后端：Node.js + Express + TypeScript + PostgreSQL（pg 连接池）
- 认证：JWT + bcryptjs 密码加密
- 前端：原生 JavaScript + Chart.js 图表
- 日志：pino 结构化日志（开发环境 pino-pretty 美化输出）
- 汇率：Frankfurter API（欧洲央行数据源）
- 部署：Docker 多阶段构建，支持 CloudBase 云托管

## 本地运行

### 前置条件

- Node.js 22+
- PostgreSQL 数据库（本地或远程）
- pnpm（推荐）或 npm

### 安装与启动

```bash
# 1. 进入项目目录
cd amiba_digital_assistant

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填写数据库连接信息和 LLM API Key

# 4. 编译 TypeScript
pnpm run build

# 5. 启动服务
node dist/server.js

# 6. 浏览器访问
# http://localhost:3000
```

### 开发模式

```bash
# 使用 ts-node 热重载开发
pnpm run dev
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | 运行环境（development / production） | `development` |
| `LOG_LEVEL` | 日志级别（fatal / error / warn / info / debug） | 开发 `debug`，生产 `info` |
| `DATABASE_URL` | PostgreSQL 连接字符串（优先级最高） | - |
| `PG_HOST` | 数据库主机 | `localhost` |
| `PG_PORT` | 数据库端口 | `5432` |
| `PG_USER` | 数据库用户 | `amoeba` |
| `PG_PASSWORD` | 数据库密码 | - |
| `PG_DATABASE` | 数据库名 | `amoeba_app` |
| `JWT_SECRET` | JWT 签名密钥（必填） | - |
| `LLM_API_KEY` | AI 助手 LLM API 密钥 | - |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.deepseek.com/v1` |
| `LLM_MODEL` | LLM 模型名称 | `deepseek-chat` |

## 默认账号

首次启动时自动创建种子账号与演示数据：

| 角色 | 用户名 | 密码 | 权限 |
|------|--------|------|------|
| 系统管理员 | admin | admin123 | 全部功能 + 用户管理 |
| 数据录入员 | editor | editor123 | 录入/业务/员工管理 |

> 数据库已存在账号时跳过创建，避免覆盖已有数据。示例数据按 `owner_id` 隔离。

## 分享给合作方的方式

### 方式一：代码包分享

将项目目录发送给合作方，对方安装依赖后启动即可：

```bash
pnpm install && pnpm run build && node dist/server.js
```

### 方式二：部署到云服务器

```bash
# 上传代码到服务器
scp -r amiba_digital_assistant user@your-server:/opt/

# 服务器上安装 Node.js 22+，然后：
cd /opt/amiba_digital_assistant
pnpm install
pnpm run build
# 配置 .env 后启动
node dist/server.js

# 配置 Nginx 反向代理（可选）
# 将 80 端口转发到 3000
```

### 方式三：Docker 部署

```bash
# 构建镜像
docker build -t amiba-app .

# 运行容器
docker run -d \
  --name amiba-app \
  -p 3000:3000 \
  -e JWT_SECRET=your-secret-key \
  -e DATABASE_URL=postgresql://user:password@host:5432/amoeba_app \
  amiba-app
```

## 数据说明

- 数据库为 PostgreSQL，首次启动自动建表并填充种子数据
- 所有金额以人民币存储，切换币种时在显示层按实时汇率折算
- 支持导出 CSV/JSON 格式数据

---

## 部署到 CloudBase 云托管

本应用通过 Docker 多阶段构建打包，支持一键部署到腾讯云 CloudBase 云托管。

### 部署形态

- **部署方式**：CloudBase 云托管（CloudRun），基于 Dockerfile 多阶段构建
- **运行时**：Node.js 22 Alpine
- **数据库**：CloudBase 内置 PostgreSQL（通过 `DATABASE_URL` 连接）
- **端口**：`3000`
- **健康检查**：`GET /api/health`（返回 `{ status, db }`）

### 快速部署

#### 1. 准备工作

确保已安装 CloudBase CLI 并登录：

```bash
npm install -g @cloudbase/cli
tcb login
```

#### 2. 配置 cloudbaserc.json

项目根目录已包含 `cloudbaserc.json`，根据实际情况修改：

```json
{
  "envId": "your-env-id",
  "version": "2.0",
  "cloudrun": {
    "name": "amoba-prod"
  }
}
```

#### 3. 部署到云托管

```bash
# 通过 CloudBase CLI 部署云托管服务
tcb cloudrun deploy -e CLOUD_BASE_ENV_ID

# 或通过控制台上传 Dockerfile 源码进行构建部署
```

#### 4. 配置环境变量

在 CloudBase 控制台 → 云托管 → 服务配置中，添加以下环境变量：

| 变量 | 说明 | 必填 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（建议使用随机字符串） | ✅ |
| `DATABASE_URL` | PostgreSQL 连接字符串（CloudBase 内置 PG 内网地址） | ✅ |
| `NODE_ENV` | 设为 `production` | ✅ |
| `PORT` | 服务端口，设为 `3000` | ✅ |
| `LLM_API_KEY` | AI 助手 LLM API 密钥（可选，不配则 AI 功能不可用） | ❌ |
| `LLM_BASE_URL` | LLM API 地址 | ❌ |
| `LLM_MODEL` | LLM 模型名称 | ❌ |

> **安全提示**：`JWT_SECRET` 请使用足够长的随机字符串，例如 `openssl rand -hex 32` 生成。

#### 5. 配置公网访问

在云托管控制台为服务开启公网访问，绑定域名或使用默认域名。

### Dockerfile 说明

项目使用多阶段构建优化镜像体积：

- **阶段一（build）**：安装全部依赖，编译 TypeScript 为 JavaScript
- **阶段二（production）**：仅安装生产依赖，复制编译产物和静态文件

关键配置：

```dockerfile
# 多阶段构建
FROM node:22-alpine AS build    # 构建阶段
FROM node:22-alpine AS production  # 生产阶段

# 生产阶段仅安装运行时依赖
RUN npm install --omit=dev

# 复制编译后的 JS 文件和前端静态资源
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# 启动编译后的入口文件
CMD ["node", "dist/server.js"]
```

### 验证部署

```bash
# 健康检查
curl https://your-domain/api/health

# 登录
curl -X POST https://your-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 日志查看

云托管服务日志自动收集，可在控制台 → 云托管 → 服务详情 → 日志页面查看。
生产环境日志为 JSON 格式，包含 `requestId`、`level`、`time`、`msg` 等字段，
可通过 `requestId` 追踪完整请求链路。

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
                           ai/engine.ts (调度循环)
                              ↓               ↑
                      ai/llm-client.ts   ai/tools.ts (25+ 工具)
                      (调用 LLM API)         ↓
                                        ai/api-client.ts
                                        (调用已有 /api/* 路由)
                                             ↓
                                        Express 路由层
                                        (复用全部业务逻辑)
```

AI 通过 Function Calling 调用后端定义的业务工具，
工具通过内部 HTTP 请求调用已有的 RESTful API（`/api/transactions`、`/api/customers` 等），
复用全部业务校验和数据隔离逻辑，与前端操作完全一致。

