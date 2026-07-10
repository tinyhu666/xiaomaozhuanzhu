# 发版手册 (RELEASE)

小猫专注 · 微信小程序，Express 后端部署在腾讯云轻量 VPS。本文件给「准备发版」时照着走。

当前发布版本：**v0.45.0**

---

## 0. 黄金法则：先部署服务端，再发布客户端

本版含服务端新接口 + 两个数据库迁移。**顺序错了会让新功能对所有用户失效**：

1. **先**在 VPS 部署最新 commit（第 2 步）
2. **再**在公众平台提交客户端审核 / 发布（第 3 步）

> 安全垫：zod schema 无 `.strict()`，且客户端对老服务端优雅降级（补录/周复盘
> 404 只 toast、不崩；状态聚合拿不到 tags 就隐藏）。所以即使顺序反了也不会
> 崩，但新功能要等服务端上线才生效。

---

## 1. 发版前自检（每次发版必跑，全绿才继续）

```bash
# 版本号一致（package.json 与 miniprogram/config/runtime.ts 必须相同）
grep '"version"' package.json
grep appVersion miniprogram/config/runtime.ts

npm run typecheck          # server + miniprogram，双绿（无输出即通过）
npx vitest run             # 全部单测 / 契约测试，必须全过

# 关键「完成打卡」流程回归（CLAUDE.md 要求）
npx vitest run \
  server/tests/session-lifecycle-contract.spec.ts \
  server/tests/complete-subject-contract.spec.ts \
  server/tests/complete-newly-unlocked.spec.ts

# WXSS 微信非法构造扫描（防上传报错 -80056；尤其禁止通用选择器 *）
for f in $(find miniprogram -name '*.wxss'); do \
  perl -0777 -pe 's{/\*.*?\*/}{}gs' "$f" \
  | grep -qE "(^|[,{>+~(]\s*|\s)\*(\s|,|\{|::)" && echo "BAD: $f"; done

git status --short          # 应为空（干净）
```

UI 改动还需照 [docs/ui-review-checklist.md](docs/ui-review-checklist.md) 走一遍
（按钮文字居中 / tab bar / emoji+CJK baseline / 大字号溢出 / 圆形 mask 角标）。

v0.38.1 自检结果：198 单测全过、typecheck 双绿、关键流回归 19/19、WXSS 干净。

---

## 2. 部署服务端（腾讯云轻量 VPS）

1. 部署：`bash scripts/deploy-remote.sh`（从本机 rsync `server/` → VPS → `npm run build:server` → `pm2 restart cpa`，不会覆盖服务器上的 `server/.env`）。
2. 数据库迁移会在服务**启动时自动幂等执行**（无需手动 SQL）。
3. 健康检查冒烟：
   ```bash
   curl https://api.buffpp.com/health
   ```
   以及 `GET /api/home`、`POST /api/sessions/manual`、`POST /api/me/weekly-review`
   返回 200（不是 404/5xx）。

> 何时**必须**重新部署：只要 `server/**` 有变更。本版有改，所以这次必须部署。

---

## 3. 发布客户端（微信公众平台）

1. 体验版已通过 `npm run upload:miniprogram` 上传（版本 `0.38.1`）。
   如需重传：
   ```bash
   MINIPROGRAM_PRIVATE_KEY_PATH=<上传密钥路径> npm run upload:miniprogram
   ```
2. 公众平台 → 管理 → 版本管理 → 「开发版本」找到 `0.38.1`
3. 设为体验版，真机过一遍第 5 步冒烟清单
4. 「提交审核」→ 填功能页/测试账号 → 等审核通过
5. 审核通过 → 「发布」

---

## 4. 版本号怎么改（下次迭代）

两处必须同步改：

- `package.json` → `"version"`
- `miniprogram/config/runtime.ts` → `appVersion`

提交后打 tag：`git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`

---

## 5. 发布后真机冒烟清单

- [ ] 开始专注 → 暂停 → 继续 → 结束 → 完成打卡（核心流，必过）
- [ ] 完成页：选科目 / 填章节 / 标签 / 总结 / 照片，提交成功回首页
- [ ] 我的 → 学习复盘：科目×考期分层 + 学习状态 + 本周复盘输入并保存 + 往期列表
- [ ] 日历 → 补录学习：选过去日期 + 时长 + 科目 → 提交，日历对应天出现记录
- [ ] 忘关 session：（可选）造一个超时 session，下次打开首页有「已记录 N 分钟」提示
- [ ] 日历 / 我的 各卡片样式正常，按钮可见、文字居中

---

## 6. 本次发布内容（v0.31 → v0.38.1）

主题：**聚焦 CPA 备考 —— 记录学习时长 + 复盘**

| 模块 | 功能 |
|---|---|
| 复盘 B1 | 学习复盘页：六科按「投入 × 考期紧迫度」分层（紧迫/落后/在轨/达标），覆盖率驱动、考期临近升级 |
| 记录 A1 | 补录：手动补录忘记计时 / 纸质学习的时长（日期 + 时长 + 科目 + 章节 + 标签） |
| 记录 A2 | 忘关 session 自动恢复：超时的专注按「暂停前真实时长」自动记录（≤10h），挂死的作废不编造 |
| 复盘 B3 | 状态聚合：卡住/顺利按科目聚合，复盘页高亮「卡住偏多」的科目 |
| 记录 A3 | 章节粒度：完成 / 补录可填可选「章节·主题」（如 会计·金融资产） |
| 复盘 B2/B4 | 周复盘 + 记录库：每周写复盘并保存，往期复盘可回看 |
| 修复 | 前期 UI 还原（v0.32 回退重构）、死代码清理、对齐/对比度/点击区审计修复 |

详细规划见 [docs/cpa-roadmap.md](docs/cpa-roadmap.md)。

---

## 7. 已知非阻塞项（下个迭代候选，不影响发版）

- 补录时长快选上限 120 分钟（>2h 的整段无自定义输入框）
- 全局 `.tag-chip` 高度 48rpx（低于 88rpx 触控基线，但为全应用既有规格）
- 复盘页 `@ts-nocheck` 下 `tierLabel`/`targetText` 增广字段未进类型（与其他页一致）
