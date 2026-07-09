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

### D. 超大字号文字（≥ 100rpx）会不会溢出？

任何 `font-size ≥ 100rpx` 的文字必须先估算容器宽度：

```
可用宽度 W = 父容器宽度 − 左右 padding
预估文字宽度 ≈ 字符数 × 0.6em × font-size
W 必须 ≥ 预估文字宽度
```

特别注意 tabular-nums 数字（每个字符宽度恒定 ~0.6em）。在 750rpx
设计宽度上：
- 8 字符 "00:00:00" + font 180rpx → 864rpx，溢出 ~120rpx
- 8 字符 + font 128rpx → 614rpx，留 ~80rpx margin

历史 bug：v0.26.0 focus mode 计时器溢出（已修，见 §5）。

### E. 圆形 mask 容器内不要放方形角标

`overflow: hidden + border-radius: 50%` 会把方形子元素裁成弧形碎片。
头像角标这种 case，要么角标放到外层非 mask 容器，要么干脆不放。

历史 bug：v0.26.0 头像绿色色块（已删除角标，见 §5）。

### F. 关键表面的可见性（颜色 / 对比度 / 按钮底色）

v0.31.3-4 真机暴露：UI 元素"渲染了但看不见"。三条硬规则：

1. **WeChat `<button>` 底色必须 `!important`**。原生 button 有默认底色，
   优先级压过普通 class 选择器。`.btn-v2--primary` 用
   `background: #155946 !important`（字面量 hex，别用 var）。否则按钮透明。

2. **卡片必须有清晰可见的描边，不能只靠填充对比**。白卡 `#FFFFFF`
   叠在近白页面 `#F3FAF6` 上，色差只有 ~3/255，真机看不出来。4% 阴影也
   会被真机裁掉。`.card-v2` / stat-tile / 日历板 / day-panel 一律
   `border: 1rpx solid #D2E1DA` + `box-shadow ≥ 10%`。

3. **focus mode 背景 + 文字用字面量 hex + `!important`**。
   `.focus-mode { background: #1A1F1C !important }` /
   `.focus-mode__clock { color: #E8EFEC !important }`。曾出现专注模式
   背景渲染成浅色、计时器黑字的诡异情况。

> ⚠️ 教训：开发者工具模拟器 ≠ 真机。模拟器上 4% 阴影、近白叠白都看得见，
> 真机看不见。涉及 surface/按钮/对比度的改动，**ship 前必须真机截图确认**，
> 不能只看模拟器。

---

## 2. tab bar 相关改动

### A. 严禁调用 `wx.hideTabBar` / `wx.showTabBar`

本项目 `tabBar.custom: true`，这两个 API 操作的是**原生** tab bar，
调 `showTabBar` 会渲染一条**额外的**原生 tab bar 浮在自定义 tab bar
上面（v0.22 - v0.25 的真实 bug 历史）。

要隐藏/显示自定义 tab bar，通过组件（v0.25.4 已实现）:
```ts
const tabBar = this.getTabBar?.();
tabBar?.setData?.({ hidden: true });
```
custom-tab-bar 组件根 view 绑了 `{{hidden ? 'is-hidden' : ''}}` 类，
对应 WXSS 用 `transform: translateY(...)` + `opacity: 0` 优雅退场。

### C. 改全屏覆盖元素（focus mode / 模态/弹窗）时，要同步隐藏自定义 tab bar

任何 fixed 全屏元素都会被 z-index 100 的自定义 tab bar 盖住底部一截。
要么主动调 `getTabBar().setData({hidden: true})`，要么给元素底部留够
`env(safe-area-inset-bottom) + 120rpx` 的 padding 让按钮高于 tab bar。

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
- [ ] 改了等分网格/多列布局 → 跑过 §6（grid 不用 flex%）+ grep 自查
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
| v0.25.0 | 自定义 tab bar 4-列 grid 留空列 → 视觉左偏 | v0.22 删动态时漏改 `repeat(4, ...)` | `custom-tab-bar/index.wxss` `repeat(3, ...)` |
| v0.25.3 | focus mode 全屏覆盖时自定义 tab bar 挡住「暂停/结束」 | focus mode 没主动隐藏 tab bar | `home/index.ts syncFocusMode` 通过 `getTabBar().setData({hidden})` 控制；`custom-tab-bar` 加 `is-hidden` 类 |
| v0.26.0 | focus mode 计时器 "00:00:00" 横向溢出，最后一位被切 | font-size 180rpx + letter-spacing 1rpx + 56rpx 左右 padding 在 750rpx 设计宽度上超出 ~180rpx | 字号 180→128rpx、letter-spacing 0、padding 56→28rpx；新增 §1D 检查：超大文字必须先估算容器宽度（W ≥ N×0.6em） |
| v0.26.0 | profile 头像有"未知绿色色块" | 38rpx 角标在 `overflow:hidden + border-radius:50%` 的圆形 mask 下被裁成三角形 | 直接删除角标，依靠 chooseAvatar 全区域 tap target；§1E：圆形 mask 内不要放方形角标 |
| v0.26.0 | 学习日报「保存失败」误报 | iOS 端 `saveImageToPhotosAlbum` errMsg 格式多变，老的 auth 检测错过这些 case | 扩大 auth 关键词匹配（auth/scope/permission/deny），并在 toast 里显示截断 errMsg 方便排查 |
| v0.31.3-4 | 真机上几乎所有卡片/chip/按钮"不可见"，专注模式背景变浅 | ① WeChat `<button>` 原生底色优先级高，`.btn-v2--primary { background: var(--c-primary) }` 不加 `!important` 压不住 → 按钮透明 ② 白卡 `#FFFFFF` 叠在近白页面 `#F3FAF6` 上 + 4% 阴影 + 浅描边，真机上对比度低于感知阈值 → 卡片像"悬空文字" | §1F 本文件：关键表面用**字面量 hex**（非 var），按钮底色 `!important`，卡片必须有**清晰可见的描边**（≥ #D2E1DA）不能只靠填充对比；focus mode bg/文字用 hex + `!important` |
| v0.42.1 | 日历周次表头「日」叠到「一」下、日期网格每行只剩 6 格错列 | 重构期把 `.calendar-board__weekdays/__grid` 从 `display:grid` 改成 `flex-wrap:wrap` + `width: calc(14.285% - 8rpx)`，7 项每行总宽在 rpx 取整下临界溢出 → 第 7 列折行 | §6 本文件：等分多列**禁用 flex% 宽度**，一律 `display:grid; repeat(N, minmax(0,1fr))`；同型隐患同期在 `app.wxss .photo-grid`（33.333%）一并清除 |
| v0.44.1 | 「章节/主题」原生 `<input>` 文字/placeholder 顶部被裁 | 原生 `<input>` 设了竖向 `padding: 18rpx` 却没设 `height`，文本行盒被裁（complete + manual 两处同款 v0.37 输入） | 原生 `<input>` 用**显式 `height` + 仅横向 `padding`**（`height:84rpx; padding:0 22rpx`），让组件在 height 内垂直居中；别靠竖向 padding 撑高 |

---

## 6. 等分多列网格 —— 用 CSS grid，**禁用 flex% 宽度**

任何「N 列等分」的网格（星期表头、日历格子、照片九宫格、六科卡片、徽章墙、
图例、横排标签…）**必须**用：

```css
.grid {
  display: grid;
  grid-template-columns: repeat(N, minmax(0, 1fr));
  gap: Xrpx;            /* 行列间距交给 gap，别用子项 margin */
}
/* 子项不要写 width；grid track 自己撑满 */
```

**禁止**这种写法（v0.42.1 日历 + photo-grid 两次踩坑的根因）：

```css
.grid { display: flex; flex-wrap: wrap; margin: -Xrpx; }
.grid__item { width: calc(100%/N - Xrpx); margin: Xrpx; }   /* ✗ */
```

为什么会坏：`100%/N` 在 rpx→px 取整时，N 个子项 + margin 累加常常比容器**多出
亚像素**，flex-wrap 就把最后一个挤到下一行 → 整列折行、错位。模拟器按理想像素
算，**看不出来**；真机不同屏宽才暴露。grid 的 `repeat(N, 1fr)` 由布局引擎精确均分，
数学上不会溢出，永不折行。

ship 前 grep 自查（应只命中注释，不命中真实规则）：

```bash
# 先剥离注释再匹配 —— 防再犯注释里会引用反模式原文，不剥会永远误报
for f in $(find miniprogram -name '*.wxss'); do
  s=$(perl -0777 -pe 's{/\*.*?\*/}{}gs' "$f")
  echo "$s" | grep -q 'flex-wrap' && echo "$s" | grep -qE 'width: *calc\([0-9.]+%' \
    && echo "SUSPECT: $f"
done
```

> 另一坑：同一选择器被**多处重复定义**（重构追加的新块覆盖旧块）。改布局前先
> 确认「最终生效」的是哪一份（WXSS 同特异性按**源序后者胜**），别在旧块上改而被
> 后面的块盖掉。v0.42.1 日历正是三处 `.calendar-board__grid` 级联、flex 块覆盖了
> 正确的 grid 块所致。
