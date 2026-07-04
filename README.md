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
