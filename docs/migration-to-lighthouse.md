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

## M1/M2 已冻结的服务端契约（M3 客户端按此对接）

**登录（M1）**
- `POST /api/auth/login` body `{ code }`（来自 `wx.login`）→ `{ token, openid, profile, needsOnboarding, serverTime }`。
- 之后每个请求带 `Authorization: Bearer <token>`；token 90 天过期，**拿到 401（且非首启）→ 静默 `wx.login` 重换 token 重试一次**（对用户无感）。
- 仍透传 `x-client-uid`（首次登录把匿名历史并入 openid 账号）。

**上传（M2）— COS 直传三步**
1. `POST /api/storage/upload-credential` body `{ kind: "checkin"|"avatar", files: [{ ext }] }`（checkin 1–3 张、avatar 恰好 1 张；ext ∈ jpg/jpeg/png/webp/heic）。
   → `{ credentials: [{ objectKey, method:"PUT", uploadUrl, publicUrl, expiresAt }] }`。**objectKey 由服务端决定**，客户端不要自拟路径。
2. 客户端把图片字节 `PUT` 到 `uploadUrl`（预签名，900s 内有效）。
3. 回填：
   - 照片 → `complete` 的 `photos: [{ objectKey }]`（**不再需要 `fileId`**；云托管旧字段仍兼容）。
   - 头像 → `profile` 的 `avatarUrl: "cos://<objectKey>"`（服务端读时签成临时 GET URL，bucket 保持私有）。

> 非 COS 部署（云托管）`upload-credential` 返回 503——云托管继续走 `wx.cloud.uploadFile`。M3 据 `runtimeConfig` 是否配 `apiBaseUrl` 选择直传 COS 还是云上传。

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
# M1 新增：签名会话 token 的 HMAC 密钥。必须 ≥32 字符、高熵；生产环境
# 若 <32 字符服务端拒绝启动（防 Bearer token 被爆破伪造）。生成：
#   openssl rand -base64 48
SESSION_SECRET=<随机长串>


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

开发管理 → 服务器域名（**注意**：客户端用 `wx.request` PUT 直传 COS，**不走 `wx.uploadFile`**，所以 COS 域名要进 **request** 白名单，而不是 uploadFile）：
- **request 合法域名**：
  - `https://api.你的域名`（业务 API）
  - `https://<bucket>.cos.<region>.myqcloud.com`（照片直传 PUT，走 wx.request）
- **downloadFile 合法域名**：
  - `https://<bucket>.cos.<region>.myqcloud.com`（`<image>` 渲染签名 GET、海报 canvas 取图）

## 切换 & 回滚

- 切换：服务端上线 + 域名就绪 → 发 M3 客户端（runtime.ts `apiBaseUrl` 指向新域名）→ 提交审核。
- 回滚：客户端 `apiBaseUrl` 可配置；若新后端异常，旧云托管已欠费无法回退，故**上线前务必在体验版用真机把全流程跑通**（开始→结束→提交、补录、复盘、上传照片、登录）。

## 风险 / 注意

- 备案是最长卡点（1-2 周）；代码可先就绪，联通等备案。
- 免备案过渡：可临时用香港/境外区域服务器（延迟略高），但正式还是建议国内 + 备案。
- 登录态：旧用户此前以 clientUid（匿名）为主；M1 上线后首次 wx.login 会以 openid 建立稳定身份。若旧数据按 clientUid 存，迁移后需保证 clientUid 仍透传（`x-client-uid`）以便用户首次登录时把匿名历史并入 openid 账号（`ensureUser` 已有 openid↔clientUid 合并逻辑）。

## M1 安全评审结论（2026-06，security-reviewer）

**M1 内已修**（发版前堵住）：
- **H1 弱密钥**：非空但过短的 `SESSION_SECRET` 会让 Bearer token 可爆破伪造 → 生产环境 <32 字符拒绝启动（`index.ts`）。
- **H2 头部伪造**：VPS 上裸 `x-wx-openid` 可被任意客户端伪造（openid 非密）。`getOpenId` 改为：设了 `sessionSecret`（VPS 模式）时，**只信任验签过的 Bearer**，不再回退裸 header；非生产保留 `x-dev-openid` 便于本地联调。云托管模式（无 secret）仍信任上游注入的 header。
- **M4 无过期**：session token 加 90 天过期（payload 已带签发时间 `t`，`verifySession` 现读取并校验；可注入 `now`/`maxAgeMs`）。wx.login 刷新对用户无感（客户端拿到 401 静默重登即可）。
- **L1 openid 形状**：`verifySession` 增 `^[A-Za-z0-9_-]{6,128}$` 校验，挡空白/类型混淆值。

**切换前（M3/M4）仍需处理**：
- **M2 clientUid 吸并**（中危，方向性）：攻击者若拿到某「仅匿名、从未登录」用户的 clientUid，可在登录时带该 header 把对方匿名历史并入自己 openid 账号。已登录账号不可被夺（`ensureUser` 不重绑已绑定的标识）。clientUid 是设备本地 UUID、数据低敏感，暂列**可接受风险**；M2 加固方向：仅当 openid 全新且 clientUid 行无 openid 时才合并，或改为客户端显式信号触发合并。
- **登录限流**（中危）：`POST /api/auth/login` 无限流，可刷爆 `jscode2session` 配额。**首选 M4 在 nginx 边缘按 IP 限流**（更合适的层）；或加 `express-rate-limit`。
- **appSecret 出现在 jscode2session URL query**（微信 API 契约，无法避免）：**禁止记录任何出站微信 URL**；VPS egress proxy 关闭对 `api.weixin.qq.com` 的 URI 日志；密钥轮换列入 runbook。（已确认现有请求日志只记 `path`，不含出站 URL，无泄漏。）
- **COS SDK 传递依赖 CVE**（`request@2.88.2` 等 3 critical/7 moderate，均非 M1 引入、不在鉴权链路）：随 **M2** COS 上传链路一并处理（核对正确升级目标）。
- **L3 500 处理器回显 `error.message`**（非 M1 引入）：后续将未捕获 500 收敛为通用消息，仅服务端记录细节。

> 客户端 M3 注意：token 90 天过期 → 请求拿到 401（且非首次启动）时静默 `wx.login` 重新换 token 重试一次，对用户无感。

## M2 评审结论（code-reviewer，APPROVE）

- 核心安全属性（objectKey 由服务端决定、客户端不能注入路径）正确并有测试覆盖。
- 修掉 `contentType` 空转参数（签名未绑定、有误导）→ 删除。
- 遗留低危（`/storage/temp-urls` 跨用户签名 / 客户端自拟 `cos://` 头像，UUID 不可猜）已开后台 chip 跟踪，M2 范围外。

## M3 评审结论（code-reviewer）+ 已修

**云托管 parity 通过**：`apiBaseUrl===""` 时 `isHttpMode()` 为假，所有导出函数走原 `callContainerCloud` / `wx.cloud.uploadFile`，行为逐字节不变（仅重命名，未改实现）。发版时 `apiBaseUrl=""` 是 no-op，切换仅需改这一行。

**评审发现 + 本次已修**：
- **H（关键，已修）401 静默重登原为死代码**：客户端总带 `x-client-uid`，旧 `withUser` 仅在 openid+clientUid 都缺时才 401 → token 过期时 openid 空但 clientUid 在 → 不 401，请求被**静默降级为匿名身份**（streak/记录全变），客户端永远收不到 401、不会重登。**修复**：VPS 模式（设了 `sessionSecret`）`withUser` 要求有效 Bearer（→openid），缺失/过期/无效 token 一律 401；clientUid 仅在 `/api/auth/login` 用于合并匿名历史，且仍随请求透传供 `ensureUser` 回填。契约测试已加（clientUid-only→401、过期 Bearer→401、有效 Bearer→200）。
- **M（已修）`app.ts` onLaunch 无条件 `wx.cloud.init`**：VPS 模式应 wx.cloud-free → 门控在 `!apiBaseUrl`。
- **M（已修）海报 `cos://` 头像不渲染**：`loadImageOntoCanvas` 原只认 `cloud://` → 增 `cos://` 分支，走 `getTempUrls` 签临时 GET。
- **M（已修）COS 直传 PUT 与签名**：服务端预签名**不签 header**，客户端发未签名 `Content-Type` 可被接受；已加注释把两侧锁在一起（将来若加 header 签名需同步）。
- **M（已修）`readFileSync` 失败信息**：包一层友好报错「读取本地图片失败」。
- 合法域名要点已并入上文「微信小程序后台配置」：COS 直传走 `wx.request` PUT → COS 域名进 **request** 白名单（非 uploadFile）。
