FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json vitest.config.ts ./
COPY server/package.json ./server/package.json

RUN npm install

COPY server ./server

RUN npm run build:server

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server

WORKDIR /app/server

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
