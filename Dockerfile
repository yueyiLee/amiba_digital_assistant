# ============================================================
# 阿米巴经营数字助手 — CloudBase 云托管 Dockerfile
# 多阶段构建：编译 TypeScript → 生产镜像
# ============================================================

# ---------- 阶段一：构建 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm install

# 复制源码并编译
COPY tsconfig.json ./
COPY server.ts db.ts seed.ts ./
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY ai/ ./ai/
COPY types/ ./types/
COPY public/ ./public/
RUN npm run build

# ---------- 阶段二：生产 ----------
FROM node:22-alpine AS production
WORKDIR /app

# 只安装生产依赖
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 从构建阶段复制编译产物和静态文件
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# 环境变量默认值（敏感值通过 CloudBase 控制台注入）
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.js"]
