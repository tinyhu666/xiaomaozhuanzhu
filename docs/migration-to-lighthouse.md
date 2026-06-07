# 服务端迁移：微信云托管 → 腾讯云轻量服务器

云托管已欠费，把整个后端迁到腾讯云轻量应用服务器（Lighthouse VPS）。

## 已定决策（2026-06）

| 项 | 决策 |
|---|---|
| 域名 / HTTPS | **有域名，待 ICP 备案**（国内 VPS 强制）。代码做成域名可配置，备案期间先就绪 |
| 照片 / 头像存储 | **腾讯云 COS**（服务端读取侧已实现，补上传链路） |
| 身份 | **实现 wx.login 正式登录**（code2session → openid → 签名会话 token），跨重装稳定 |
| 旧数据 | **需迁移，数据仍可导出**（mysqldump 云托管 → 导入新库） |

## 好消息：架构已基本解耦

- 服务端是标准 Express（`app.listen(PORT)` + dotenv + MySQL via `DATABASE_URL`/`MYSQL_*`），**无云托管专属代码**，VPS 直接能跑，schema 启动自动幂等迁移。
- 存储已有 `StorageClient` 抽象 + **COS 客户端已实现**（`cos-nodejs-sdk-v5`，`detectStorageMode` 检测 `COS_*` 环境变量自动启用 COS 读取）。
- `WeChatAPIClient`（`server/src/domain/wechat-openapi.ts`）已有 `getAccessToken` + 可注入 `fetcher`（测试缝），加 `code2session` 即可。

## 需要改的耦合点

| 位置 | 现状（云托管） | 改为（VPS） |
|---|---|---|
| `miniprogram/utils/api.ts` `callContainer` | `wx.cloud.callContainer({env,path})` | `wx.request({ url: apiBaseUrl + basePath + path })` |
| `miniprogram/utils/api.ts` 上传 | `wx.cloud.uploadFile` → `cloud://` fileId | 服务端签名 → `wx.uploadFile` 直传 COS |
| 身份注入 | 云托管自动注入 `x-wx-openid` | 客户端 `wx.login`→ 服务端 `code2session` → 签名 token，后续请求带 `Authorization: Bearer` |
| `server/src/app.ts:95` `completeSchema` | `fileId.startsWith("cloud://")` 硬约束 | 放开为 COS objectKey / URL |
| `runtimeConfig`（runtime.ts） | `cloudEnv` | 增 `apiBaseUrl`（HTTPS 域名） |

## 分片实施计划（每片测试通过才合并）

> 端到端联通要等域名备案 + 服务器上线才能真机验证；每片先靠 typecheck + 契约测试（mock WeChat/COS）+ 独立审查保证正确。

- **M1 服务端鉴权**（可测）：`WeChatAPIClient.code2session` + `POST /api/auth/login {code}` → openid → 签名会话 token；`withUser` 接受 `Authorization: Bearer`（保留 `x-client-uid` 兜底）。契约测试 mock code2session。
- **M2 服务端存储**（可测）：COS 签名上传接口（`POST /api/storage/upload-credential` 或预签名 PUT）；放开 `completeSchema` / avatar 的 `cloud://` 约束以接受 COS key。契约测试。
- **M3 客户端**（typecheck）：`callContainer`→`wx.request(apiBaseUrl)`；登录流（wx.login→token 存 storage→带 Bearer）；上传→COS 直传。
- **M4 运维 + 数据**（文档）：VPS 部署（nginx + PM2 + HTTPS）+ 全量 `.env` + 备案 + mysqldump 数据迁移。

版本规划：M1=v0.39.0、M2=v0.40.0、M3=v0.41.0（客户端切换，发版前必须域名就绪）。

## 服务器部署（M4，备案后执行）

**规格建议**：2 核 2G 起；地域选已备案域名对应区域（国内）。系统 Ubuntu 22.04。

```bash
# 1. 基础环境
apt update && apt install -y nginx mysql-server
# 安装 Node 20 (nvm 或 nodesource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2

# 2. MySQL：建库 + 用户
mysql -e "CREATE DATABASE cpa CHARACTER SET utf8mb4; CREATE USER 'cpa'@'localhost' IDENTIFIED BY '<pw>'; GRANT ALL ON cpa.* TO 'cpa'@'localhost';"

# 3. 拉代码 + 构建
git clone <repo> /opt/xiaomao && cd /opt/xiaomao
npm ci && npm run build:server

# 4. server/.env（见下「环境变量」）

# 5. 启动（schema 启动自动建表/迁移）
pm2 start "node server/dist/index.js" --name cpa --update-env
pm2 save && pm2 startup

# 6. nginx 反代 + HTTPS（certbot）
#   server { listen 443 ssl; server_name api.你的域名;
#            location /api/ { proxy_pass http://127.0.0.1:3000; } }
certbot --nginx -d api.你的域名
```

### 环境变量（server/.env）

```
PORT=3000
# 数据库（二选一）
DATABASE_URL=mysql://cpa:<pw>@127.0.0.1:3306/cpa
# 或 MYSQL_ADDRESS=127.0.0.1:3306 / MYSQL_USERNAME / MYSQL_PASSWORD / MYSQL_DATABASE

# 微信登录（M1）
WECHAT_APP_ID=wxfb24f334e5070a82
WECHAT_APP_SECRET=<小程序后台→开发管理→AppSecret>
SESSION_SECRET=<随机长串，签名会话 token>     # M1 新增

# COS 存储（M2）
COS_SECRET_ID=<腾讯云 API 密钥>
COS_SECRET_KEY=<...>
COS_BUCKET=<bucket-appid>
COS_REGION=ap-guangzhou
STORAGE_PUBLIC_BASE_URL=https://<bucket>.cos.<region>.myqcloud.com
```

## 数据迁移（云托管 MySQL → 新库）

```bash
# 趁云托管 MySQL 还能连：在云托管控制台「数据库」拿连接信息
mysqldump -h <旧host> -P <port> -u <user> -p<pw> <旧库> \
  --single-transaction --no-tablespaces > backup.sql
# 导入新服务器
mysql -u cpa -p cpa < backup.sql
```
> 表结构与本仓库 `mysql-bootstrap.ts` 一致；导入后新服务端启动会幂等补齐
> 任何缺失列/表（topic、weekly_reviews 等）。

## 微信小程序后台配置（M3 上线前）

开发管理 → 服务器域名：
- **request 合法域名**：`https://api.你的域名`
- **uploadFile / downloadFile 合法域名**：COS 域名 `https://<bucket>.cos.<region>.myqcloud.com`

## 切换 & 回滚

- 切换：服务端上线 + 域名就绪 → 发 M3 客户端（runtime.ts `apiBaseUrl` 指向新域名）→ 提交审核。
- 回滚：客户端 `apiBaseUrl` 可配置；若新后端异常，旧云托管已欠费无法回退，故**上线前务必在体验版用真机把全流程跑通**（开始→结束→提交、补录、复盘、上传照片、登录）。

## 风险 / 注意

- 备案是最长卡点（1-2 周）；代码可先就绪，联通等备案。
- 免备案过渡：可临时用香港/境外区域服务器（延迟略高），但正式还是建议国内 + 备案。
- 登录态：旧用户此前以 clientUid（匿名）为主；M1 上线后首次 wx.login 会以 openid 建立稳定身份。若旧数据按 clientUid 存，迁移后需保证 clientUid 仍透传（`x-client-uid`）以便用户首次登录时把匿名历史并入 openid 账号（`ensureUser` 已有 openid↔clientUid 合并逻辑）。
