FROM node:20-alpine
WORKDIR /app

# 安装依赖（利用 Docker 缓存层）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制源代码
COPY . .

# 环境变量默认值（可被 CloudBase 控制台覆盖）
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 直接用 node 启动，减少一层进程
CMD ["node", "server.js"]
