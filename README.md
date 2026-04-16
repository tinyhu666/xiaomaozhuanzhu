# CPA 备考打卡微信小程序

一个围绕 `CPA 考试备考` 的微信小程序项目，包含：

- `miniprogram/`：原生微信小程序 + TypeScript
- `server/`：Node.js + TypeScript + Express 云托管后端

核心流程：

1. 首页开始计时
2. 结束学习时拍照上传
3. 填写一句话总结并提交打卡
4. 日历热力格按当日总时长加深
5. 生成个人公开主页分享成果

## 目录结构

```text
.
├─ miniprogram/          # 微信小程序源码
├─ server/               # 云托管服务端
│  ├─ sql/001_init.sql   # MySQL 初始化脚本
│  ├─ Dockerfile         # 云托管容器构建文件
│  └─ .env.example       # 服务端环境变量模板
├─ typings/              # 小程序全局类型
└─ project.config.json   # 微信开发者工具配置
```

## 本地开发

```bash
npm install
npm test
npm run typecheck
```

### 小程序

1. 用微信开发者工具打开当前仓库根目录。
2. 在 `project.config.json` 里替换真实 `appid`。
3. 在 [miniprogram/config/runtime.ts](miniprogram/config/runtime.ts) 填入真实云托管环境 ID。
4. 打开开发者工具后编译 `miniprogram/`。

### 服务端

```bash
cp server/.env.example server/.env
npm run build:server
node server/dist/index.js
```

说明：

- 没有配置 `DATABASE_URL` 时，服务默认使用内存仓储，方便本地跑测试与联调。
- 配置 `DATABASE_URL` 后，服务会自动切换到 MySQL 仓储。
- 配置 `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION` 后，服务会生成真实 COS 临时访问链接；否则退回到 `STORAGE_PUBLIC_BASE_URL` 占位地址。

## 云托管部署

1. 在微信云托管环境中创建 MySQL，并执行 [server/sql/001_init.sql](server/sql/001_init.sql)。
2. 在云托管服务配置环境变量：
   - `DATABASE_URL`
   - `COS_SECRET_ID`
   - `COS_SECRET_KEY`
   - `COS_BUCKET`
   - `COS_REGION`
3. 使用 [server/Dockerfile](server/Dockerfile) 构建镜像并部署。
4. 小程序端通过 `wx.cloud.callContainer` 调用 `/api/*` 接口，通过 `wx.cloud.uploadFile` 直传对象存储。

## 现有验证

- `npm test`
- `npm run typecheck`

## 关键实现点

- 服务端通过 `X-WX-OPENID` 识别当前小程序用户。
- 暂停状态的会话在重新进入首页时会自动标记为 `abandoned`，避免跨会话恢复。
- 已完成会话会重算 `daily_stats`，用于首页、日历和公开主页聚合读取。
- 公开主页要求访问者先通过微信身份请求进入。

