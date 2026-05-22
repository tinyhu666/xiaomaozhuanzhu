# 小猫专注 · UI 重设计 Handoff

## 这是什么

一份完整的设计交付包，对应 `docs/ui-redesign-brief.md` 中的视觉系统重设计。设计目标是把"专注计时 + 学习打卡"这件事做得**沉浸、静默、稳定**——长期备考的人每天用 1-3 小时，要看到稳定的进度感，不要被花哨的游戏化打扰。

> ⚠️ **重要：包里的 HTML / JSX 文件是设计参考**，不是要直接放到小程序里跑的代码。它们用 React + Babel 在浏览器里渲染了 8 个 iPhone 画板用于评审。你的任务是**把这套设计在 `miniprogram/` 现有的 WeChat 小程序架构（WXML + WXSS + TypeScript + 自定义 component）里重写一遍**，沿用 `app.wxss` 的现有按钮三件套和 tab bar component 模式。

## Fidelity

**Hi-fi**。所有颜色、字号、间距、圆角、阴影、动效曲线都按 `docs/ui-redesign-brief.md` §5 精确锁定。token 全在 `tokens.css` 里。开发时按 token 值落地即可，不需要"凭感觉"猜。

## 8 个画板

`index.html` 是一张 Figma-like 设计画布，包含：

| # | 画板 | 文件 | 状态 |
|---|---|---|---|
| 00 | 设计系统 token + 组件 | `design-ref.jsx` | 参考用，不用在小程序里实现 |
| 01 | 首页 idle（浅色）| `screen-home.jsx` (`HomeIdle`) | 主屏 |
| 02 | 首页 focus mode（深色 + 呼吸）| `screen-home.jsx` (`HomeFocus`) | 进入计时即切换 |
| 03 | 日历（浅色）| `screen-calendar.jsx` (`<Calendar/>`) | 主屏 |
| 03b | 日历（深色）| `screen-calendar.jsx` (`<Calendar dark/>`) | 可选 dark mode |
| 04 | 我的 | `screen-profile.jsx` | 主屏 |
| 05 | 完成打卡 | `screen-complete.jsx` (`CompleteCheckin`) | session 结束后跳转 |
| 06 | 成就解锁 modal | `screen-complete.jsx` (`CompleteWithUnlock`) | 触发解锁时全屏 modal |
| 07 | 成就墙 | `screen-achievements.jsx` | 「我的」→「成就」入口 |

---

## 设计 Tokens

全部 token 在 `tokens.css` 的 `:root` 块里。WeChat WXSS **不支持** `:root` 全局 custom properties — 你需要把这些值分发到每个 component 的局部 `:host` 或硬编码到 wxss 文件里。

### Palette

| Token | Hex | 用途 |
|---|---|---|
| `--c-primary` | `#155946` | 深墨绿 · 主品牌色 · 大字号数字 + CTA |
| `--c-primary-700` | `#0e4434` | primary hover 态 |
| `--c-accent` | `#2EA985` | 薄荷 · 次要强调 · 链接 · 深色态主品牌替代 |
| `--c-bg-light` | `#F3FAF6` | 奶绿 · 浅模式背景 |
| `--c-bg-dark` | `#1A1F1C` | 碳灰 · focus mode 深色背景 |
| `--c-surface-light` | `#FFFFFF` | 卡片底色（浅）|
| `--c-surface-dark` | `#2A2F2D` | 卡片底色（深）|
| `--c-soft-mint` | `#ECF5F0` | chip 默认底（浅）|
| `--c-soft-mint-deep` | `#2D3433` | chip 默认底（深）|
| `--c-text-1` | `#1F2624` | 正文（浅）|
| `--c-text-2` | `#5E7D75` | 次要（浅）|
| `--c-text-3` | `#98ABA4` | 极次要 / placeholder（浅）|
| `--c-stroke` | `#E3EBE7` | 描边（浅）|
| `--c-placeholder` | `#C2D0CB` | 输入框 placeholder |
| `--c-text-1-dark` | `#E8EFEC` | 正文（深）|
| `--c-text-2-dark` | `#8FA59C` | 次要（深）|
| `--c-stroke-dark` | `#2E3633` | 描边（深）|
| `--c-warning` | `#C2562B` | 砖橙 · 警告 |
| `--c-error` | `#A0322B` | 暗红 · 错误 |

### 稀有度配色（成就系统专用）

| Token | Hex | |
|---|---|---|
| `--c-rarity-common` | `#98ABA4` | 雾灰 |
| `--c-rarity-rare` | `#4A6ED9` | 雾蓝 |
| `--c-rarity-epic` | `#E57B2B` | 琥珀 |
| `--c-rarity-legendary` | `#C9881C` | 金沙 |

### 日历热力 — 6 档

浅色：`#ECF5F0 → #C8E4D5 → #95CDB1 → #5CB489 → #2E9869 → #155946`
深色：`#232927 → #283832 → #285043 → #266957 → #28876D → #2EA985`

### 字阶（小程序 rpx，750 设计宽度）

| Name | rpx | px @ iPhone 14 | 用途 |
|---|---|---|---|
| Display | 128 | 64 | focus mode 计时器，唯一 |
| Hero | 64 | 32 | 考试倒计时数字、成就解锁名 |
| Title-1 | 40 | 20 | 页面标题 |
| Title-2 | 32 | 16 | 卡片标题 |
| Body | 28 | 14 | 正文 |
| Caption | 22 | 11 | 说明 |
| Micro | 18 | 9 | 极次要标签 / eyebrow |

字重: 仅用 **400 / 600 / 800** 三档，不用 500/700。

字体: `PingFang SC` (iOS) / 系统 sans (Android)，数字用 `SF Pro Rounded` + `font-variant-numeric: tabular-nums`。

### 间距（8-base 网格，rpx）

紧密 8 / 默认 16 / 段落 24 / 卡片间 40 / 页边距 32

### 圆角（仅 4 档，rpx）

- chip / pill: 999
- 按钮 / 输入框: 16
- 卡片: 24
- modal: 32

**不要混用其他圆角值**。

### 阴影（仅 3 档）

```
浮起 (卡片):  0 2rpx 8rpx rgba(20, 60, 50, 0.04)
突出 (浮层):  0 12rpx 32rpx -4rpx rgba(20, 60, 50, 0.08)
强调 (modal): 0 24rpx 60rpx -8rpx rgba(20, 60, 50, 0.16)
```

### 动效

```
标准曲线: cubic-bezier(0.2, 0.8, 0.3, 1)   ← 进入、值变化
退出曲线: cubic-bezier(0.4, 0, 1, 1)        ← 关闭、移除

时长: 100ms (按压) / 220ms (chip 切换) / 320ms (页面 / modal) / 600ms (成就庆祝)

呼吸 (focus mode 计时器):
  @keyframes breathe { 0%,100% { opacity:1; scale:1 } 50% { opacity:.86; scale:.985 } }
  animation: breathe 4s ease-in-out infinite;
```

---

## 屏幕逐个说明

### 01 · 首页 idle

固定结构，自上而下 4 块（**总数 ≤ 4**，超了就要砍）：

1. **考试倒计时 Hero**（卡片外，直接铺背景）
   - micro eyebrow `CPA 综合阶段`
   - Hero 数字（深墨绿 ＃155946，56px，weight 800）+ `天`
   - Caption 注释日期
2. **计时器卡片**
   - micro `今日已专注` + Display 48px 数字 `01:32:18`（tabular-nums）
   - Caption 当前科目
   - **Primary CTA**「开始专注」全宽 48px 高
3. **今日目标卡**
   - 标题 + tabular num `1h 32m / 3h`
   - progress bar 6px 高
   - chip 行 `1h / 2h / 3h / 4h`（单选）
4. **六科进度卡**
   - 标题 + 「查看 →」
   - 2×3 grid 的 mini bar，每条「科目名 + 时长 + bar」

底部悬浮 tab bar（首页 / 日历 / 我的，3 tab）。

### 02 · 首页 focus mode

**整页变身**：

- 背景: `#1A1F1C`，顶部叠 radial-gradient 薄荷弱光（`focus-halo` 类）
- 上方 caption「92 分钟 · 今日 ｜ 14 天连签」
- 正中央 micro「会计 · 第 3 节」+ Display 64px 计时器 `00:27:14`（呼吸 4s ease-in-out）
- 下方两个按钮等宽：Ghost「暂停」+ Primary（薄荷绿 #2EA985）「结束」
- **tab bar 完全隐藏** — `translateY + opacity` 转场
- 注意 `env(safe-area-inset-bottom)` 防遮挡

### 03 · 日历

- 月份导航：左 chevron + 标题「2026 年 5 月」+「本月已打卡 23 天」+ 右 chevron
- 7 列星期表头 `一 二 三 四 五 六 日`
- 7×6 grid 热力图，单元 40px 高，圆角 8px
- 当日加底部蓝点；选中加 1.5px 深墨绿描边
- legend「少 □□□▣▣▣ 多」
- 选中日期后下方渲染当日 sessions 列表（卡片：相机图标 + 科目 + 时长 + 起始时间 + 一句话总结）

**深色版（03b）**：换 hm-d-* 热力 token，描边换薄荷绿。

### 04 · 我的

1. 用户卡: 头像（圆形，linear-gradient 薄荷→墨绿，无角标）+ 昵称 + 加入日期 + 「主页」chip 按钮
2. 2×2 stat grid: 累计学习 / 完成打卡 / 最长连签 / 单日最长（数字 24px weight 800 深墨绿）
3. 菜单 4 项: 成就 / 六科进度 / 学习设置 / 学习日报（每项左侧 32×32 mint 圆角图标盒子）
4. 版本号 footer `小猫专注 · v0.25.2`

### 05 · 完成打卡

3 个区域：

1. **Hero**: micro「这次专注了」+ 48px 数字「52 分钟」+ 起止时间
2. **表单**:
   - 照片 0-3 张（grid 3 列，每格 92×92，第一张有占位图，第二张是「+ 加一张」虚线框）
   - 一句话总结 textarea（卡片内嵌，默认 80 字以内，右下角字数计数）
   - 科目 chip 单选（6 个：会计 / 审计 / 财管 / 经济法 / 税法 / 战略）
   - 标签 chip 多选（专注 / 状态好 / 瞌睡 / 做题 / 看书 / 听课）
3. **完成打卡 Primary CTA** 永远可点（吸底，渐变到 bg 颜色）

### 06 · 成就解锁 modal

触发条件: 完成打卡瞬间解锁新成就。

- 全屏遮罩 `rgba(20,60,50,0.55)` + `backdrop-filter: blur(2px)`
- 中间 modal（320px 宽，圆角 16px，padding 28/24/24）：
  - micro 稀有度标签（带 star 图标）色随稀有度
  - 156×156 圆角猫品种照片，外圈琥珀 halo 脉冲 `breathe 2s`
  - 24px weight 800 品种名
  - Caption 解锁条件 + 「你做到了。」
  - Primary CTA「收藏 · 继续打卡」
  - 文字按钮「查看成就墙」

### 07 · 成就墙

- Header「← 成就」
- Hero：micro「已解锁」+ 大数字 `6 / 11`（深墨绿 + 灰）+ caption「最近解锁 · 布偶猫」
- 按稀有度分组（普通 / 稀有 / 史诗 / 传说），每组：
  - 标题左边一个 8×8 圆点色 + 标签 +「N / N」计数
  - 2 列网格，每个 tile：56-88px 品种照片 + 品种名 + 条件 + 进度条（未解锁）
  - 未解锁 tile: `filter: grayscale(0.95)` + `opacity: 0.62`
  - epic / legendary 解锁：右上角 18×18 圆形 star 角标（色随稀有度）
  - 未解锁：右上角小锁图标（灰）

---

## 组件清单（按 `app.wxss` 既有约定）

> **关键**：你的 `app.wxss` 已经写了 `.cta-button` / `.ghost-button` / `.danger-button` + 强制 `::after { border: none !important }` 防 WeChat button 文字偏移。**新按钮直接复用，不要从零写**。这条约束 `CLAUDE.md` 已经强调过。

### Buttons

4 种，全部 44-48px 高，圆角 16rpx（即 8px）：

- **Primary CTA**: 深墨绿背景 + 白字 + 600 weight
- **Ghost**: 透明 + 深墨绿 1.5px 边 + 深墨绿字
- **Danger**: 透明 + 砖橙 1.5px 边 + 砖橙字（仅用于删除 / 重置）
- **Link inline**: 仅文字，默认无下划线

状态: default / pressed (`scale 0.97`) / disabled (`opacity 0.55`) / loading (内嵌 spinner 居中)

### Chip

- 默认: mint 底（#ECF5F0 浅 / #2D3433 深）+ 深字
- 激活: 深墨绿底 + 白字
- 单选行: 同时只允许一个激活，未激活弱化 `opacity 0.6`
- **混合 emoji + CJK + 数字时必须 `display: inline-flex; align-items: center; gap` 拆元素**（emoji 和 CJK baseline 不同会偏，`CLAUDE.md` 提过）

### Card

- 浅: 白底 + `box-shadow 0 2rpx 8rpx rgba(20,60,50,0.04)`，圆角 24rpx
- 深: `#2A2F2D` + `1px solid #2E3633`，无阴影
- 可点击 card: pressed 时 `scale(0.99)`

### Switch（自定义实现，**不用原生 `<switch>`**）

- 关: 浅灰胶囊 + 白圆点左
- 开: 深墨绿胶囊 + 白圆点右
- 220ms 标准曲线
- 跟自定义 tab bar 风格统一

### Bottom Sheet（优先于全屏 Modal）

- 顶部 32rpx 圆角，从底部滑出 320ms
- 遮罩 `rgba(20,60,50,0.55)`，点击关闭

### Tab Bar（custom-tab-bar component）

- 3 tab，悬浮胶囊形（999rpx 圆角）
- 距底 24rpx + iOS safe area
- 激活: 深墨绿背景（深色态用薄荷绿）+ 白字
- **focus mode 期间隐藏整条** — `translateY + opacity`
- **绝对不要用 `wx.hideTabBar` / `wx.showTabBar`** —— `CLAUDE.md` 已经在 home/index.ts 注释里禁掉，会跟自定义 tab bar 冲突

### Stepper

- 左 − / 中数值 / 右 + 三段
- 数值用 tabular-nums 等宽
- 到达上下限按钮 disabled 灰

---

## 资产清单

### `assets/breeds/` — 11 张猫品种照片

来源: 主要从 [Oxford-IIIT Pet Dataset](https://github.com/ml4py/dataset-iiit-pet) (CC BY-SA 4.0) 和 [Aml-Hassan-Abd-El-hamid/datasets](https://github.com/Aml-Hassan-Abd-El-hamid/datasets) 导入。

| 中文名 | 文件 | 原始品种 | 备注 |
|---|---|---|---|
| 中华田园猫 | 中华田园猫.jpg | Japanese Bobtail（实为棕色虎斑街猫）| 数据集 mislabel，但视觉对 |
| 狸花猫 | 狸花猫.jpg | Bengal | tabby 斑点风格 |
| 三花猫 | 三花猫.jpg | Selkirk Rex | 玳瑁色（黑+橘），近似三花 |
| 橘猫 | 橘猫.jpg | Maine Coon | 橘色长毛 |
| 暹罗猫 | 暹罗猫.jpg | Siamese | colorpoint + 蓝眼 |
| 英短 | 英短.jpg | British Shorthair | 蓝灰圆脸 |
| 美短 | 美短.jpg | Egyptian Mau | 银色斑点 tabby |
| 布偶猫 | 布偶猫.jpg | Ragdoll | colorpoint + 大蓝眼 |
| 缅因猫 | 缅因猫.jpg | Maine Coon | 长毛 tabby + 耳尖毛束 |
| 无毛猫 | 无毛猫.jpg | Sphynx | 无毛 + 蝙蝠耳 + 褶皱 |
| 金渐层 | 金渐层.jpg | Persian | 金色波斯 |

集成时：上传到云存储（小程序 `wx.cloud.uploadFile`），或直接打包进 `miniprogram/package-profile/achievements/assets/`。

### 图标

`icons.jsx` 里有 21 个线性图标（home / cal / user / play / pause / stop / chevron / camera / check / flame / trophy / bell / moon / chart / book / paw / star / lock 等），1.6px stroke，currentColor。在小程序里用 wxs 渲染或直接转为 SVG 文件放 `assets/icons/`，每个 ≤ 2KB。

---

## 交互规范（refresh from §8）

| 交互 | 反馈 |
|---|---|
| 任何可点击元素 | `scale(0.97)` + 100ms |
| Chip 切换 | 220ms 颜色 + 微缩 |
| 表单提交成功 | 1.2s 「已记录」toast |
| 表单提交失败 | toast 显示错误的截断片段，便于截图反馈 |
| 滑动到底部 | **不要弹「没有更多了」**，静默 |
| 拉刷新 | iOS 原生样式 |
| 长按 | 仅用于图片预览 |

**绝对不要**: 抖动、震动、wiggle、bounce 弹簧、循环 GIF、emoji 装饰文案（🎉✨等）、励志口号、奖励性弹窗（除真正成就解锁外）。

---

## 集成顺序建议

按风险从低到高：

1. **先落 tokens.css → app.wxss**: 把 palette + 字号 + 间距 + 圆角 + 阴影 token 写到 `app.wxss` 顶部（rpx 制单位）。这是其他改动的基础。
2. **新建 components/cat-photo.wxml + .wxss + .ts**: 一个接受 `breed` prop 的图片组件，加载 `assets/breeds/{breed}.jpg`，封 grayscale locked 态。
3. **替换 `pages/home/index.wxss` 的浅色 idle 态**: 这是最高频屏幕，先有视觉收益。
4. **改 focus mode `package-session/` 路径下相关页面**: 涉及深色 + 呼吸 + tab bar 隐藏。先在真机走一遍 `开始 → 暂停 → 继续 → 结束 → 提交` 全流程（按 `CLAUDE.md` 要求）。
5. **日历 + 成就墙**: 视觉刷新，工程量大但风险低。
6. **完成打卡 + 解锁 modal**: 最后落地，会触发服务端 schema 变化要小心。

---

## 测试 / typecheck / 上传节奏

按 `CLAUDE.md` 节奏：

```bash
npm run typecheck            # server + miniprogram
npx vitest run               # 跑所有单测
# 翻一遍 docs/ui-review-checklist.md
git add -A && git commit -m "vX.Y.Z: 完成 idle 屏视觉重写"
git push origin main
MINIPROGRAM_PRIVATE_KEY_PATH=... npm run upload:miniprogram
```

`package.json` 和 `miniprogram/config/runtime.ts` 的版本号要同步。

---

## 不在本包内、但仍要遵守的

- 完整 brief 在仓库的 `docs/ui-redesign-brief.md` —— 这个 README 是其浓缩版 + 落地补充
- UI review checklist 在 `docs/ui-review-checklist.md` —— ship 前必须走一遍
- 已知反复出过的 bug（button 文字偏 / tab bar 重叠 / emoji baseline / 圆形 mask 卡角标 / tab 索引漏改）防御位置详见 `CLAUDE.md`

---

## 打开预览

把这个文件夹整个拖到本地，然后用浏览器打开 `index.html`。React + Babel 是 CDN 加载，需要联网。8 个画板会以可平移 / 缩放的设计画布形式展示。
