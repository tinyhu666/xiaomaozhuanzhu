# 小猫专注 · 产品路线图

> 当前版本 v0.14.0 — AI 练习模式（出题 + 判分 + 详解）+ 错题本。三轴 (CPA × AI × 专注) 首次互相赋能。

## v0.14.0 已上线（AI 练习 + 错题本）

定位升级：CPA 备考 × AI 工具 × 专注工具三轴首次互相赋能。AI tab 从「问答」升级为「问答 + 练习」，AI 不只是答疑，还能出题 + 判分。

- **AI 练习模式**（AI tab 顶部加 segmented toggle `问答 / 练习`）：选科目 + 难度 → AI 出 3 道选择题 → 用户答题 → AI 判分 + 给详解。三档难度：基础 / 进阶 / 真题级。
- **错题本**（「我的」菜单新入口）：所有答错的题自动入本，含题干 + 你的答案 + 正确答案 + AI 详解。可标记「已掌握」隐藏。pull-to-refresh，optimistic-update。
- **服务端**：
  - 新表 `practice_questions(id, user_id, subject, difficulty, question, options_json, correct_answer, user_answer, ai_explanation, is_correct, is_mastered, created_at, answered_at)`，UNIQUE on id，两个查询索引。
  - 3 个新接口：`POST /api/ai/practice/generate`（DeepSeek + JSON mode）、`POST /api/ai/practice/grade`（含幂等检查，重复提交不再调 AI）、`GET /api/me/mistakes` + `POST /api/me/mistakes/:id/mastered`。
  - 与 `/api/ai/ask` 共享每用户 30 次/日的软限流，防止用户通过混用绕过。
  - 生成调用走 DeepSeek 的 `response_format: { type: "json_object" }`，比正则解析稳。
- **测试**：116/116 通过（新增 8 个：领域逻辑 + HTTP 集成路径 + 幂等校验）。

需要的运维动作：和 v0.13 相同的 `DEEPSEEK_API_KEY` 即可，无需新增 env。

## v0.13.0 已上线

- **AI 助教 tab**：`/api/ai/ask` 服务端代理 DeepSeek-v4-flash。API key 仅在服务器 (env `DEEPSEEK_API_KEY`) 持有，绝不下发到客户端。每用户每日 30 次软限制（in-memory，云托管实例重启重置 — 因 DeepSeek 价格便宜，这个软限只是防爬虫和死循环）。客户端聊天 UI：用户气泡右对齐薄荷渐变、AI 气泡左对齐白卡 + 蓝色头像；空状态显示 4 个示例问题可一键发送；长按 AI 气泡复制；3 点点点的 typing 指示器；composer 固定在底部并预留 tab bar 空间；scroll-into-view 自动跟踪最新消息。
- **首页视觉层级重做**：原大号倒计时卡（132rpx 数字 + 文案 + 装饰光圈）压缩为 slim `exam-strip` 横条：左侧科目+日期、右侧 36rpx 圆角徽章；4 档紧迫度配色不变，≤30 天 / ≤7 天分别启用 2.4s / 1.6s 节奏的脉冲。timer-card 现在是页面无争议的视觉重点。
- **首页去掉版本号**：`v{{appVersion}}` 标签和对应 CSS 移除。版本号在「我的」页底部仍保留（便于反馈时定位版本）。
- **头像蓝色 tap-flash 修复**：profile-hero 的 chooseAvatar 按钮叠加 `hover-class="none"` + CSS `-webkit-tap-highlight-color: transparent` + `:active background: transparent !important`。这三层共同压住了 v0.12 在 iOS WeChat 上出现的蓝色覆盖层。
- **代码清理**：删除已不可达的 `pages/news` 主包页面和 `package-news` 分包（动态 tab 被 AI 替换，原 22 条新闻种子内容仍在服务端 `news_items` 表中保留以备未来 RAG / 管理后台使用）。
- **测试**：108/108 通过（新增 10 个：AI 域逻辑 6 + AI HTTP 路由 3 + 日历集成 1）。

需要的运维动作：在云托管「服务设置 → 环境变量」加 `DEEPSEEK_API_KEY=sk-xxx`，否则 AI tab 调用会返回 503。

## v0.12.0 已上线（基于市场调研）

调研结论（详见 commit message）：
- 📍 高 ROI 路径：用户自定义目标 (MyStudyLife / Harmony AI) + 分享卡片 (小红书 #学习打卡 千万 UGC)
- 📍 长期方向（暂未做）：白噪音、自习室、AI 答疑
- 📍 不做：题库 / 公式速查（偏内容，越权工具定位）

已上线：
- **学习设置页**（`package-profile/settings`）：6 项可调 — 每日目标 / 每周目标 / 番茄钟 4 项参数。每项带 stepper + 范围校验 + "恢复默认"。持久化到 `wx.setStorageSync('cpa.settings.v1')`，全部带 clamping。
- **每周目标进度条**（首页）：当 weeklyGoalMinutes > 0 才出现，在「今日目标」下方一行带蓝色渐变进度条；用 weeklyReview.thisWeekMinutes（已有）做数据源，无后端改动。
- **学习日报分享卡**（`package-profile/poster`）：canvas 2D 在 1125×1800 backing 上绘制竖版海报。包含品牌行 + 用户头像（圆形 + 白边） + 昵称（带溢出截断） + 大号 hero 数字 + 2×2 数据网格 + 每日金句 + footer slogan。`canvasToTempFilePath` 导出 PNG，支持「保存到相册」「转发好友」「长按图片」三条分享路径。
- **首页 pomodoro 接入用户设置**：开始计时时 snapshot 一次 settings，state machine 使用用户自定义的专注/休息/cycles 数。
- **测试**：98/98 通过（新增 7 个 settings 单元测试覆盖 clamping / 缺失字段 / 损坏存储 / off-sentinel）。

## v0.11.0 已上线（数据洞察三件套）

- **学习时段洞察**：`/api/me/dashboard` 返回 24 小时 + 周内分布 + 峰值时段/星期。「我的」页面新增 insights 卡，24 条小柱状图 + 「你最高效的时段是 晚上 8 点，周三平均最长」。柱子高度按峰值归一化，峰值柱用渐变 + 阴影突出。逻辑时区无关（直接从 YYYY-MM-DD 串解析 + Date.UTC）。
- **科目分布饼图**：「六科进度」页加 CSS conic-gradient donut + 图例。中心显示总学时和占总目标的百分比。
- **个人记录卡**：「我的」页头像下方加 2 张卡：「单日最长」 + 「最佳一周」。最长连签已在统计 4 格里，不重复。
- **服务端**：`buildHourlyPattern` 拆分跨小时会话、扣除暂停时间；`buildWeekdayPattern` 时区无关；`findBestWeek` 按上海周一对齐聚合。9 个新单元测试覆盖跨午夜 / 暂停 / 多周等边界。整体 91 个测试通过。

## v0.10.0 已上线（专注质量 + UX）

- **番茄钟模式**：计时器卡上方加 `自由计时 / 番茄钟` segmented toggle。番茄钟下倒计时 25min 专注 + 5min 休息，每 4 个 cycle 后长休 15min。自动切换状态时 `wx.vibrateShort` + toast 通知；底部 4 个圆点可视化已完成的番茄数；超过 4 个用 "+N" 显示。打卡页带上番茄数。
- **后台切回静默追赶**：用户切到其它 tab 再回来时，所有错过的相位静默推进，只有前台 tick 跨越相位才会发通知，不再"回到首页一口气弹 6 个 toast"。
- **开始前选科目**：计时器卡上方多了 6 个科目 chip；选中后高亮 + 上浮；持久化到 `wx.setStorageSync('cpa.lastSubject', ...)`，下次默认勾选。开始计时 → 后端记录到 session.subject。结束打卡页自动预填该科目，不用再选第二次。
- **服务端 schema**：`study_sessions` 加 `mode` ('free' | 'pomodoro') 和 `pomodoro_cycles` 列，幂等迁移。`POST /api/sessions/start` 接受可选 `subject` + `mode`。`POST /api/sessions/:id/complete` 接受可选 `pomodoroCycles`（0–32）。
- **测试**：82 个全部通过（新增 3 个针对 pomodoro + subject 的 happy path / 边界 / 校验失败）。
- **UI 质感**：picker chip 用 cubic-bezier(0.2, 0.8, 0.3, 1) 标准曲线 + scale press 态；番茄钟激活时整张 timer-card 微微染色（暖橙 hue）；mode toggle 是 segmented + 渐变填充。
> 下面的规划按"用户价值密度 × 实现成本"排序，每个 phase 可独立交付。

---

## 当前能力盘点

### 已上线（v0.7.x 小程序）
- 计时器：开始 / 暂停 / 继续 / 结束
- 自动放弃僵尸 session（运行 12h+ / 暂停 24h+）
- 每日金句（24 句，按日轮换 + 进入轮换）
- 今日目标进度（1.5h 默认）
- 本周复盘（7 天柱状图 + 比较上周）
- 月度热力图（日历 tab）+ 点击进入当日详情
- 完成打卡：科目 + 标签 + 一句话 + 1-3 张照片
- 连签计算 + 补签（gap ≤1 天，7 天 cooldown）
- 双重身份（openid + clientUid），匿名 → 微信无缝合并

### 已上线（v0.6.x 管理后台）
- 用户列表、详情、最近打卡流
- CSV 导出
- 科目/标签分布
- 30 天趋势 + 周内分布 SVG 图表
- 照片缩略图 + 大图查看
- 管理员备注

### **服务端已有但小程序没用到** ⚡（最快落地的金矿）
| 接口 | 内容 | 状态 |
|---|---|---|
| `GET /api/me/dashboard` | 六科目标 vs 实际、最佳一天、9 个徽章解锁状态 | 接口 ✅ / UI ❌ |
| `GET /api/share/me` | 公开主页摘要 | 接口 ✅ / UI ❌ |
| `POST /api/share/me` | 开启 / 关闭公开主页 | 接口 ✅ / UI ❌ |
| `GET /api/public/:slug` | 别人可访问的公开主页 | 接口 ✅ / UI ❌ |
| `BADGE_DEFINITIONS` | 9 个徽章（首次打卡 / 7 日连签 / 30 日连签 / 10h / 50h / 100h / 单日 4h / 单科 50h / 六科齐学） | 后端 ✅ / 前端 ❌ |
| `SUBJECT_TARGET_MINUTES` | 六科推荐学时（合计 1220h） | 后端 ✅ / 前端 ❌ |

**Phase 1 主要任务就是把这些已有能力露出来。**

---

## Phase 1：把已有资源露出来（1 周）

> 性价比最高 — 后端 0 改动，纯前端 UI。

### 1.1 添加「我的」tab（重做）
之前因微信登录 bug 删过；现在小程序身份系统稳定（openid + clientUid），可以重新加回。
- 顶部：用户昵称 + 头像（点 chooseAvatar 设置）
- 累计学习 / 完成打卡 / 当前连签 / 最长连签 4 个大数字
- 「徽章」入口 → Phase 1.2
- 「六科进度」入口 → Phase 1.3
- 「公开主页」入口 → Phase 1.4
- 「设置」入口 → Phase 2.4

### 1.2 徽章页（subpackage）
- 9 个徽章卡片，3 列网格
- 解锁：彩色 icon + 强光晕 + 解锁时间
- 未解锁：灰色 icon + 进度条（如 `连签 5/7 天`）
- 点击徽章弹出详细说明 + 解锁条件

### 1.3 六科进度页（subpackage）
读取 `/api/me/dashboard` 的 subjects 数组：
- 每科一张卡：科目名 + 累计 / 目标小时 + 进度条 + 占比
- 排序：按完成度降序
- 顶部摘要：总进度（已完成 X% × 1220h 总学时）
- 每科点击可看到该科目所有完成的 session 列表

### 1.4 公开主页 / 学习证书
- 在「我的」加开关："开启公开学习页"
- 开启后生成短链：`/pages/public/index?slug=xxx`
- 别人扫码或点链接 → 看到对方的累计、连签、热力图、徽章
- **要点**：不暴露 session 详情（隐私），只暴露汇总数据

---

## Phase 2：专注质量（1-2 周）

> 让"专注"本身更好用 — 当前只是个秒表。

### 2.1 番茄钟模式
- 计时器卡加切换按钮：`自由计时 / 番茄钟`
- 番茄钟：25 min 专注 + 5 min 休息循环，4 个 cycle 后长休 15 min
- 切到番茄钟时计时器变成倒计时，到点震动 + toast
- 完成的 cycle 数显示在状态条旁

### 2.2 开始前选科目
当前科目只能在"结束打卡"时选择 — 开始前先选科目，体验更直接。
- 计时器卡上方加 6 个科目 chip，可选可不选
- 选了之后 chip 高亮，开始计时
- 结束时该 chip 默认选中（用户仍可换）

### 2.3 session 中快速备注
长会话期间想记点东西。点击计时器中央 → 弹出小输入框，写 1-2 行（如"这题卡了 20 分钟"），存到当前 session 的 notes 字段，完成时一起提交。

### 2.4 设置页
- 默认每日目标（默认 1.5h，可改）
- 默认科目（开始计时时自动选中）
- 番茄钟时长配置
- 主题（mint / 暖色，可选）
- 数据导出（导出自己所有 session JSON）

---

## Phase 3：习惯养成（1 周）

### 3.1 考试倒计时
- 设置页输入 CPA 考试日期
- 首页顶部加一行小字：`距离 8/26 考试还有 110 天，建议每天 X 小时`
- X 自动算：(剩余六科总时长 - 已学) / 剩余天数

### 3.2 每日提醒（订阅消息）
- 用户授权后，每天选定时间推送：「该专注啦，已连签 12 天」
- 实现：[微信订阅消息](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/)，新增一个 `/api/me/subscribe-reminder` 端点存订阅
- 服务端 cron 在到点时调用 WeChat OpenAPI 发送

### 3.3 周报自动生成（可分享卡片）
每周日晚 9 点生成本周回顾卡，含：
- 本周累计、平均、最长
- 与上周对比
- 六科分布饼图
- 一句鼓励语
- 长按可保存为图片分享朋友圈

实现：用 canvas 在小程序端绘制卡片图。

---

## Phase 3.5：考试动态 tab（独立优先）

### 3.5.1 「动态」tab
小程序底部第 4 个 tab。展示 CICPA 官方考试公告、大纲、动态。

- 列表：标题 + 来源 + 发布时间 + 摘要（150 字）
- 顶部分类切换：全部 / 公告 / 大纲 / 动态
- 点进详情：标题 + 时间 + 全文（plain text 提取）+ "查看原文"按钮

### 3.5.2 服务端 news 模块 ✅ (v0.8.0)
- 新表 `news_items (id, source, category, title, summary, content, url, published_at, fetched_at, hidden, manual)`
- `domain/news.ts`: 抓 `https://www.cicpa.org.cn/zcks/{ksgg,ksdg,ksdt}/` 三个分类页；用纯正则解析 `<li>` 块（无 cheerio 依赖，保持镜像精简）
- 懒加载刷新：用户访问 `/api/news` 时，若最近 fetch 已超过 3h，触发后台异步刷新（用户拿到当前缓存，下次拿到新数据）
- 失败兜底：解析失败时保留旧缓存；每个分类失败独立隔离
- 唯一去重：`UNIQUE(source, url)` — 重复 URL 不会重复插入；`manual=1` 行不被刷新覆盖

### 3.5.3 admin 后台管理 ✅ (v0.8.0)
- `POST /admin/api/news/refresh` 手动触发抓取，返回每类成功/失败统计
- `GET /admin/api/news` 列表展示所有抓取的新闻（含已隐藏）
- `PATCH /admin/api/news/:id` 编辑标题/摘要/正文；`PATCH /:id/hidden` 软隐藏
- `POST /admin/api/news` 添加自定义条目（manual=1，永久不被覆盖）

---

## Phase 4：内容深度（2 周）

### 4.1 ~~错题本 / 知识卡~~（已弃，超出工具定位）

### 4.2 学习日历"展开"模式
日历 tab 加切换：
- 月视图（当前）
- 年视图：12 个月小热力图缩略 + 全年总时长 + Top 3 月
- 习惯月：周一对齐，看月内规律

### 4.3 个人记录卡片
"我的"页面顶部 3 个 highlight：
- 单日最长：5/6 · 2h 30m
- 最长连签：14 天（4/15 - 4/28）
- 最高效一周：本周 / 第 17 周 · 18h 20m

点击可看历史。

### 4.4 智能提示
基于历史数据的简单建议：
- "你周三平均最高效，今天加把劲"
- "审计你已超过 50%，预计 30 天后完成"
- "已连签 7 天，再坚持 7 天解锁徽章"

---

## Phase 5：社交（可选，3 周+）

### 5.1 学伴 / 关注
- 添加学伴功能：扫对方的公开主页二维码加为学伴
- 学伴列表：最近 3 天活跃情况、本周对比
- 不显示具体内容，只显示是否打卡 / 时长

### 5.2 学习排行榜（可选 / 匿名）
- 加入排行榜需主动开启
- 看本周 / 本月时长排行
- 完全匿名（只显示昵称首字 + 头像）
- 实现：服务端 cron 计算榜单缓存到 Redis / MySQL

### 5.3 学习"小组"
- 6 人小组，组员加入后看到彼此打卡情况
- 组长可设组目标
- 复杂度高 — 放后期

---

## Phase 6：管理后台增强（持续）

### 6.1 全局数据看板
- 总用户增长曲线（日/周/月）
- 总学习时长趋势
- 用户活跃度（DAU/WAU/MAU）
- 热力图：哪个时段用户最活跃

### 6.2 用户管理
- 删除用户 + 级联清数据（GDPR / 国内合规）
- 合并用户（手动合并两个匿名 user_id）
- 封禁 / 标记问题用户

### 6.3 内容运营
- 后台编辑每日金句池（DAILY_QUOTES）
- 添加 / 编辑徽章定义
- 推送系统通知（"系统升级在凌晨 2 点"）

---

## 已知 ❌ / 不做的事

| 不做 | 原因 |
|---|---|
| AI 智能学习计划 | 范围爆炸，价值不清晰 |
| 视频 / 录屏 | CPA 备考核心是看书做题，非视频学习 |
| 内容生产（试题、知识卡） | 不是工具型应用的职责，市面已有专业产品 |
| 课程 / 收费功能 | 偏离"工具"定位 |
| 跨平台（iOS App） | 小程序生态已经足够覆盖 |

---

## 实施优先级建议

**建议从 Phase 1.1 + 1.2 + 1.3 + 1.4 开始**（即"露出已有资源"）：
- 后端 0 改动
- 小程序 1 个新 tab + 3 个 subpackage
- 1 周内能交付
- 立刻给用户「我有 X 个徽章 / 六科已完成 Y%」的成就感

之后按你的反馈和数据决定 Phase 2-5。

**Phase 6（管理后台）可以并行做**：和小程序团队解耦，按需穿插。

---

## 技术与质量待办（贯穿）

- [ ] 小程序代码包：当前 ~58KB，加新功能后留意拆包阈值（主包 < 2MB，分包 < 2MB 单个）
- [ ] 长期空 session 仍按 12h reap — 番茄钟模式下可能误伤，需特殊处理
- [ ] 微信订阅消息：模板审核、用户多次拒绝降级 fallback
- [ ] 公开主页 SEO / 防爬虫（短链可被批量遍历的风险）
- [ ] 单元测试：当前 55/55，新加功能要求每个 endpoint 至少 1 个 happy path + 1 个 error path
- [ ] 性能：MySQL 增加 `daily_stats(user_id, stat_date DESC)` 复合索引（已有）但 join 时验证 EXPLAIN
