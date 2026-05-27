# 小猫专注 GPT image2 UI 重设计交付

参考图：
- `docs/design-handoff/gpt-image2-ui-redesign-board.png`
- `docs/design-handoff/gpt-image2-ui-polish-heatmap-board.png`

## 视觉基线

视觉命题：安静、低刺激、数据驱动的 CPA 备考工具；首页待机态像一张清晰的学习仪表盘，专注态像全世界只剩计时器。

实现边界：只改 WXML/WXSS 和展示文案，不改接口、数据结构、页面路由和业务事件绑定。

## Tokens

颜色：
- 主色：`#155946`
- 强调：`#2EA985`
- 浅底：`#F3FAF6`
- 深底：`#1A1F1C`
- 浅表面：`#FFFFFF`
- 深表面：`#2A2F2D`
- 文字主：`#1F2624`
- 文字次：`#5E7D75`
- 描边：`#E3EBE7`
- 占位：`#C2D0CB`
- 警告：`#C2562B`
- 错误：`#A0322B`

字号：
- Display：`128rpx`，专注计时器
- Hero：`64rpx`，倒计时、完成页主数字
- Title 1：`40rpx`
- Title 2：`32rpx`
- Body：`28rpx`
- Caption：`22rpx`
- Micro：`18rpx`

间距与形状：
- 间距：`8 / 16 / 24 / 32 / 40rpx`
- 圆角：`16 / 24 / 32 / 999rpx`
- 阴影：卡片 `0 2rpx 8rpx rgba(20, 60, 50, 0.04)`；浮层 `0 12rpx 32rpx -4rpx rgba(20, 60, 50, 0.08)`；弹层 `0 24rpx 60rpx -8rpx rgba(20, 60, 50, 0.16)`

## Components

按钮：
- Primary：深墨绿底白字，`88rpx` 高，`16rpx` 圆角
- Ghost：透明底，深墨绿描边
- Danger：透明底，砖橙描边
- 所有 `<button>::after` 强制无边框，按压 `scale(0.97)`

卡片：
- 白底、`24rpx` 圆角、可见描边，弱阴影
- 每卡控制在一个主数据和一行说明内

Chip：
- 默认奶绿底，激活深墨绿底
- emoji 不参与常驻 UI，文字和数字启用等宽数字

Stepper：
- 三段式胶囊，左右按钮和中间数值固定宽度
- 禁用态使用透明度弱化

Toggle：
- 自定义胶囊开关用于提醒设置
- 关：浅灰胶囊；开：深墨绿胶囊

Bottom sheet / modal：
- 使用 `32rpx` 圆角和深色遮罩
- 入场 `320ms`，成就解锁 `600ms`

Tab bar：
- 自定义 3 tab 胶囊
- 专注态通过 `getTabBar().setData({ hidden: true })` 隐藏

## Mockups

首页 idle：
- 考试倒计时、计时器、今日目标、六科进度四块以内
- 大数字作为视觉支点，日常挑战降为目标卡内小 chip

首页 focus：
- 深色全屏，顶部只留今日分钟和连签
- 正中 `128rpx` 计时器，底部暂停和结束按钮
- tab bar 完全隐藏

完成打卡：
- Hero、表单、提交按钮三段
- 表单保持照片、总结、科目、标签全部原功能
- 成就弹层只在真实解锁时出现

我的与设置：
- 我的页保留用户卡、2x2 数据、四项菜单、版本 footer
- 设置页保留目标步进、提醒、音景、公开学习页、恢复默认

日历：
- 月份导航、7x6 热力图、单行图例
- 仅选中日期后渲染当日记录
- 二轮优化后，热力图以贡献图语言表达学习强度：`0 / 1m / 30m / 1h / 2h / 4h+` 六档，色块越深代表投入时间越长
- 单日详情使用左侧细轨和时长 pill，减少普通卡片堆叠感

Dark mode：
- 至少首页 focus 进入全深色；浅屏保留低亮度奶绿背景
- focus 使用 `#1A1F1C` 背景和 `#E8EFEC` 文本

## Animation

页面进入：主块 `320ms` fade-up，延迟按块递增 `50ms` 内。

数字变化：使用 `220ms` 颜色/透明度过渡，避免硬切。

进度条：`600ms` 从左到右增长。

专注计时器：`4s` 呼吸，`opacity 1 -> 0.86 -> 1`，`scale 1 -> 0.985 -> 1`。

成就解锁：`600ms` 进场，halo 使用 2s 脉冲；禁用抖动和弹簧式反复回弹。

Reduced motion：通过 `@media (prefers-reduced-motion: reduce)` 缩短或关闭动画。

二轮质感优化：
- 热力图色块 `360ms` 淡入，选中态使用细环和轻脉冲
- CTA、chip、进度条使用克制线性渐变，保留深墨绿主导
- 卡片材质统一为近白到浅绿的极浅纵向渐变，配合 hairline border 和低扩散阴影
- focus mode 使用顶部弱光和深色纵向层次，计时器保持等宽数字和低亮度光晕
