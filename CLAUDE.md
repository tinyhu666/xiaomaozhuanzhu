# Claude 工作约定

这个文件给 Claude 看 — 每次在这个仓库里工作开始时自动加载。

## 必读清单

涉及客户端 UI（wxml / wxss / 自定义组件）改动时，**ship 前**必须按
[docs/ui-review-checklist.md](docs/ui-review-checklist.md) 走一遍。

该清单沉淀了若干反复出过的 bug 的根因，包括：
- WeChat `<button>` 文字不居中（v0.22 / v0.25 / v0.25.1 / v0.25.2 多次）
- 自定义 tab bar 上叠原生 tab bar（v0.22 / v0.25.0 / v0.25.1）
- emoji + CJK + 数字混在单个 `<text>` 导致 baseline 偏移
- tab 顺序改动后多个页面 `selected: N` 索引漏改

## 全局防御位置

| 防御 | 文件 | 内容 |
|---|---|---|
| `<button>` 默认 `::after` outline 被强制 `border: none` | `miniprogram/app.wxss` `.cta-button::after` 段 | 防按钮文字微偏 |
| `<button>` 三件套（`.cta-button` / `.ghost-button` / `.danger-button`）`padding: 0` + flex center | `miniprogram/app.wxss` | 复用即可，新按钮别从零写 |
| `wx.hideTabBar` / `wx.showTabBar` 禁用 | `miniprogram/pages/home/index.ts` syncFocusMode 注释 | 严禁，会跟自定义 tab bar 冲突 |

## 完成 session 是关键流

下列文件任一改动 → ship 前必须真机走一遍 "开始 → 暂停 → 继续 → 结束
→ 提交" 全流程：

- `miniprogram/pages/home/index.*`
- `miniprogram/package-session/complete/index.*`
- `server/src/app.ts` （特别是 `completeSchema` / `/api/sessions/:id/complete`）

回归测试：
- `server/tests/session-lifecycle-contract.spec.ts`
- `server/tests/complete-subject-contract.spec.ts`
- `server/tests/complete-newly-unlocked.spec.ts`

## 测试 / typecheck / 上传节奏

每个面向用户的版本（哪怕 patch）按以下顺序：

```bash
npm run typecheck      # server + miniprogram
npx vitest run         # 跑所有单测
# 浏览一遍 docs/ui-review-checklist.md
git add -A && git commit -m "vX.Y.Z: ..."
git push origin main
MINIPROGRAM_PRIVATE_KEY_PATH=... npm run upload:miniprogram
```

版本号要同步：`package.json` + `miniprogram/config/runtime.ts`。

## 部署提醒

后端跑在**腾讯云轻量 VPS**（`api.buffpp.com`，PM2 + nginx + HTTPS），存储用
**腾讯云 COS**。微信云托管已于 v0.45.0 整体下线，客户端不再有 `wx.cloud` /
`cloud://` 回退。

服务端有改动时（`server/**` 变化），从本机一键部署（会 rsync 源码 → VPS →
构建 → 重启 pm2，并保护服务器上的 `server/.env`）：

```bash
bash scripts/deploy-remote.sh     # 默认 root@118.89.94.251，密钥 ~/.ssh/xiaomao_deploy
```

登录鉴权仍走微信开放平台 `code2session`（`WECHAT_APP_ID` / `WECHAT_APP_SECRET`，
非云托管、免费），务必保留；`WECHAT_CLOUD_ENV` / `WECHAT_OPENAPI_INTERNAL` 已废弃，
**不要在 VPS 的 `server/.env` 里设置**（一旦设置会把存储从 COS 切回云托管）。
