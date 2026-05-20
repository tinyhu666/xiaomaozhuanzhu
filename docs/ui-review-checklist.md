# UI 审查清单

每次涉及 WXML / WXSS 改动的版本，**ship 前必须按这个清单走一遍**。
背景：多个版本反复出现按钮文字不居中、文字偏移、tab bar 重复等问题
（v0.22 / v0.25 / v0.25.1 / v0.25.2 都改过类似 bug）。把流程沉淀
在这里，下次不要靠记忆。

---

## 1. 任何带文字的按钮 / pill / chip / 胶囊

### A. 是否混用了 emoji + 中文 + 数字？

如果是，**不要用单个 `<text>` 元素拼接**。emoji 字形比 CJK 高，
baseline 不一致，在带 padding 的容器里会偏。

❌ 反例（v0.22 - v0.25.1 反复出过的形态）：
```html
<text class="pill">🎯 挑战 {{n}} 分</text>
```

✅ 正确形态：
```html
<view class="pill">
  <text class="pill__icon">🎯</text>
  <text class="pill__text">挑战 {{n}} 分</text>
</view>
```

```css
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  padding: 4rpx 14rpx;  /* 上下别小于 4rpx，emoji 需要呼吸 */
  line-height: 1.4;     /* 显式锁死，别留默认值 */
  vertical-align: middle;
}
```

### B. 用了 WeChat `<button>` 元素？

WeChat `<button>` 自带 `::after` 伪元素做轮廓描边，会让文字微偏。
**全局 `.cta-button` / `.ghost-button` / `.danger-button` 已经在
`app.wxss` 里做了防御**（padding:0 + ::after border:none + flex
center）。

新写按钮请：
- 优先复用 `.cta-button` / `.ghost-button` / `.danger-button` 三件套
- 若必须自定义，**至少要做**：
  - `display: flex; align-items: center; justify-content: center`
  - `padding: 0`（外部 padding 用 wrapper 控制）
  - 显式 `text-align: center`
  - `&::after { border: none !important; }`

### C. 含 emoji 的 `<text>` / `<view>` 是否需要居中？

`display: block` 的文字默认左对齐。如果是欢呼/装饰性文案（带🎉/✨/✓
等），通常应该 `text-align: center`。

---

## 2. tab bar 相关改动

### A. 严禁调用 `wx.hideTabBar` / `wx.showTabBar`

本项目 `tabBar.custom: true`，这两个 API 操作的是**原生** tab bar，
调 `showTabBar` 会渲染一条**额外的**原生 tab bar 浮在自定义 tab bar
上面（v0.22 - v0.25 的真实 bug 历史）。

要隐藏/显示自定义 tab bar，通过组件:
```ts
const tabBar = this.getTabBar?.();
tabBar?.setData?.({ hidden: true });  // 需要 tab-bar 组件支持这个字段
```

### B. tab 顺序变了？

修改了 `app.json tabBar.list` 顺序后，全局搜:
```bash
grep -rn "selected:\s*[0-9]" miniprogram/pages
```
所有页面 `onShow` 里设置的 `selected: N` 索引都必须同步更新。
（v0.22 删「动态」时漏改过 profile 的 `selected: 3` → 2）

---

## 3. 完成 session 全流程 smoke test

任何动到 `pages/home/index.*` / `package-session/complete/index.*`
/ `server/src/app.ts` 的 `completeSchema` 或 `complete` 路由的版本，
**ship 前必须真机/开发者工具走一遍**：

1. 开始专注 → 计时 → 暂停 → 继续 → 结束
2. 跳转到完成页 → 选 / 不选科目 → 提交
3. 看回到首页是否正确（toast 或解锁动画）
4. 进入「成就」页确认数字 +1

这一项是 v0.21.2 提交故障 + v0.25.0 tab-bar 重复的共同教训。

---

## 4. ship 前 checklist（必跑）

- [ ] `npm run typecheck` 双绿
- [ ] `npx vitest run` 全过
- [ ] 改了 wxml/wxss → 跑过 §1 的按钮/pill 审查
- [ ] 改了 tab bar 配置 → 跑过 §2 的索引同步
- [ ] 改了 home / complete → 跑过 §3 的 smoke test
- [ ] 版本号同步（`package.json` + `miniprogram/config/runtime.ts`）

---

## 5. 历史 bug 记录（防再犯）

| 版本 | 问题 | 根因 | 防御位置 |
|---|---|---|---|
| v0.21.2 | 完成打卡 400 | 首页 → 完成页 URL 双重编码科目 | `server/tests/complete-subject-contract.spec.ts` |
| v0.22.0 | 全屏专注屏幕常亮耗电 | 默认 `setKeepScreenOn(true)` | v0.22.1 reverse |
| v0.22.0 (deep) | 自定义 tab bar 上面叠原生 tab bar | 错误调用 `wx.showTabBar` | §2A 本文件 |
| v0.25.0 | 完成按钮文字微偏 | WeChat `<button>::after` outline | `app.wxss` 全局防御 |
| v0.25.0 | 「🎯 挑战 20分」 pill 内容不齐 | 单 `<text>` 混 emoji + CJK | §1A 本文件 |
| v0.25.0 | 「🎉 今日目标已达成」hint 左偏 | 块级元素未居中 | v0.25.3 fix |
