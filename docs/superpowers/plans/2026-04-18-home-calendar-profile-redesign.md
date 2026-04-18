# Home Calendar Profile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mini program's main information architecture so the app centers on a minimal home timer, a full heatmap calendar, and a metrics-first profile page with share management nested under “我的”.

**Architecture:** Keep the existing session and daily-stat persistence intact, and add one new aggregated “my dashboard” API for profile analytics. On the mini program side, replace the 4-tab layout with a 3-tab custom tab bar, then refactor the home, calendar, and profile pages around smaller view-model helpers so the UI stays clean and data formatting stays testable.

**Tech Stack:** WeChat Mini Program (native + TypeScript), Express, Vitest, Supertest, existing CloudBase `callContainer` client API.

---

### Task 1: Lock in failing tests for the new dashboard and helper logic

**Files:**
- Modify: `server/tests/app.spec.ts`
- Modify: `miniprogram/tests/view-models.spec.ts`
- Modify: `miniprogram/utils/view-models.ts`
- Test: `server/tests/app.spec.ts`
- Test: `miniprogram/tests/view-models.spec.ts`

- [ ] **Step 1: Write the failing API test for the profile dashboard aggregate**

```ts
it("returns profile analytics for subjects, best day, and total minutes", async () => {
  await request(app)
    .post("/api/me/profile")
    .set("x-wx-openid", "stats-user")
    .send({
      nickname: "薄荷考生",
      avatarUrl: "https://example.com/stats.png",
      isPublic: true,
      requireWechatAuth: true
    })
    .expect(200);

  const first = await request(app)
    .post("/api/sessions/start")
    .set("x-wx-openid", "stats-user")
    .expect(200);

  clock.advanceMinutes(90);
  await request(app)
    .post(`/api/sessions/${first.body.session.id}/complete`)
    .set("x-wx-openid", "stats-user")
    .send({
      summary: "会计分录复盘",
      subject: "会计",
      tags: ["复习"],
      photos: [{ fileId: "cloud://demo/a.jpg", objectKey: "checkins/a.jpg" }]
    })
    .expect(200);

  const second = await request(app)
    .post("/api/sessions/start")
    .set("x-wx-openid", "stats-user")
    .expect(200);

  clock.advanceMinutes(135);
  await request(app)
    .post(`/api/sessions/${second.body.session.id}/complete`)
    .set("x-wx-openid", "stats-user")
    .send({
      summary: "审计章节串讲",
      subject: "审计",
      tags: ["新课"],
      photos: [{ fileId: "cloud://demo/b.jpg", objectKey: "checkins/b.jpg" }]
    })
    .expect(200);

  const dashboard = await request(app)
    .get("/api/me/dashboard")
    .set("x-wx-openid", "stats-user")
    .expect(200);

  expect(dashboard.body.subjects).toEqual([
    { subject: "审计", totalMinutes: 135 },
    { subject: "会计", totalMinutes: 90 }
  ]);
  expect(dashboard.body.bestDay).toEqual({
    date: "2026-04-16",
    totalMinutes: 225
  });
  expect(dashboard.body.summary.totalMinutes).toBe(225);
});
```

- [ ] **Step 2: Write the failing helper tests for the compact home/profile view models**

```ts
it("picks a deterministic bilingual welcome quote from a date", () => {
  expect(getDailyQuote("2026-04-18")).toEqual({
    en: "One page at a time.",
    zh: "一页一页，也是在前进。"
  });
});

it("builds subject summary cards in descending order", () => {
  expect(
    buildSubjectSummary([
      { subject: "会计", totalMinutes: 75 },
      { subject: "审计", totalMinutes: 140 }
    ])
  ).toEqual([
    { subject: "审计", totalMinutes: 140, durationText: "2h 20m" },
    { subject: "会计", totalMinutes: 75, durationText: "1h 15m" }
  ]);
});
```

- [ ] **Step 3: Run the targeted tests and verify they fail**

Run: `npm run test:server -- server/tests/app.spec.ts`
Expected: FAIL with missing `/api/me/dashboard` route or missing response fields.

Run: `npm run test:miniprogram -- miniprogram/tests/view-models.spec.ts`
Expected: FAIL with missing `getDailyQuote` / `buildSubjectSummary` exports.

- [ ] **Step 4: Commit the failing tests**

```bash
git add server/tests/app.spec.ts miniprogram/tests/view-models.spec.ts
git commit -m "test: cover redesigned dashboard and view models"
```

### Task 2: Implement the profile dashboard aggregate API

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/store/types.ts`
- Test: `server/tests/app.spec.ts`

- [ ] **Step 1: Add a response type for the dashboard payload**

```ts
export interface ProfileDashboardResponse {
  profile: User;
  summary: {
    totalMinutes: number;
    currentStreakDays: number;
  };
  subjects: Array<{
    subject: Subject;
    totalMinutes: number;
  }>;
  bestDay: {
    date: string | null;
    totalMinutes: number;
  };
}
```

- [ ] **Step 2: Add the `/api/me/dashboard` route using existing sessions and daily stats**

```ts
app.get("/api/me/dashboard", async (request, response) => {
  const context = await loadUserContext(request);
  const sessions = await store.listSessions(context.user.id);
  const dailyStats = await store.getDailyStats(context.user.id);

  const subjects = SUBJECT_OPTIONS.map((subject) => ({
    subject,
    totalMinutes: sessions
      .filter((session) => session.status === "completed" && session.subject === subject)
      .reduce((sum, session) => sum + session.durationMinutes, 0)
  })).filter((item) => item.totalMinutes > 0)
    .sort((left, right) => right.totalMinutes - left.totalMinutes);

  const bestDay = [...dailyStats.values()].reduce(
    (best, stat) => (stat.totalMinutes > best.totalMinutes ? { date: stat.date, totalMinutes: stat.totalMinutes } : best),
    { date: null, totalMinutes: 0 }
  );

  response.json({
    profile: mapProfile(context.user, context.publicProfile),
    summary: {
      totalMinutes: sessions
        .filter((session) => session.status === "completed")
        .reduce((sum, session) => sum + session.durationMinutes, 0),
      currentStreakDays: getCurrentStreak(dailyStats)
    },
    subjects,
    bestDay
  });
});
```

- [ ] **Step 3: Re-run the server test and verify it passes**

Run: `npm run test:server -- server/tests/app.spec.ts`
Expected: PASS with the new dashboard payload covered.

- [ ] **Step 4: Commit the API implementation**

```bash
git add server/src/app.ts server/src/types.ts server/tests/app.spec.ts
git commit -m "feat: add profile dashboard aggregate endpoint"
```

### Task 3: Wire the new client model and compact page helpers

**Files:**
- Modify: `miniprogram/types/models.ts`
- Modify: `miniprogram/utils/api.ts`
- Modify: `miniprogram/utils/view-models.ts`
- Test: `miniprogram/tests/view-models.spec.ts`

- [ ] **Step 1: Add the new mini program model and API method**

```ts
export type ProfileDashboardResponse = {
  profile: UserProfile;
  summary: {
    totalMinutes: number;
    currentStreakDays: number;
  };
  subjects: Array<{
    subject: string;
    totalMinutes: number;
  }>;
  bestDay: {
    date: string | null;
    totalMinutes: number;
  };
};
```

```ts
export function getProfileDashboard() {
  return callContainer<ProfileDashboardResponse>({
    path: "/me/dashboard"
  });
}
```

- [ ] **Step 2: Add presentation helpers for quotes, subject rows, and best-day copy**

```ts
const DAILY_QUOTES = [
  { en: "One page at a time.", zh: "一页一页，也是在前进。" },
  { en: "Small steps still count.", zh: "每一点推进，都算数。" },
  { en: "Stay with the problem.", zh: "沉住气，题会慢慢松动。" }
];

export function getDailyQuote(dateKey: string) {
  const seed = dateKey.split("-").join("").split("").reduce((sum, value) => sum + Number(value), 0);
  return DAILY_QUOTES[seed % DAILY_QUOTES.length];
}

export function buildSubjectSummary(items: Array<{ subject: string; totalMinutes: number }>) {
  return [...items]
    .sort((left, right) => right.totalMinutes - left.totalMinutes)
    .map((item) => ({
      ...item,
      durationText: formatDuration(item.totalMinutes)
    }));
}
```

- [ ] **Step 3: Re-run the helper tests and verify they pass**

Run: `npm run test:miniprogram -- miniprogram/tests/view-models.spec.ts`
Expected: PASS with deterministic quote and subject summary coverage.

- [ ] **Step 4: Commit the client/data helper layer**

```bash
git add miniprogram/types/models.ts miniprogram/utils/api.ts miniprogram/utils/view-models.ts miniprogram/tests/view-models.spec.ts
git commit -m "feat: add redesigned profile client models"
```

### Task 4: Reduce the app shell to three primary tabs

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/custom-tab-bar/index.ts`
- Modify: `miniprogram/custom-tab-bar/index.wxml`
- Modify: `miniprogram/custom-tab-bar/index.wxss`

- [ ] **Step 1: Update app config to keep only home, calendar, and profile tabs**

```json
"pages": [
  "pages/home/index",
  "pages/calendar/index",
  "pages/profile/index",
  "pages/share/index"
],
"tabBar": {
  "custom": true,
  "list": [
    { "pagePath": "pages/home/index", "text": "打卡" },
    { "pagePath": "pages/calendar/index", "text": "日历" },
    { "pagePath": "pages/profile/index", "text": "我的" }
  ]
}
```

- [ ] **Step 2: Refactor the custom tab bar items and simplify the visuals**

```ts
items: [
  { pagePath: "/pages/home/index", text: "打卡", icon: "focus" },
  { pagePath: "/pages/calendar/index", text: "日历", icon: "heat" },
  { pagePath: "/pages/profile/index", text: "我的", icon: "me" }
]
```

```xml
<view class="tabbar">
  <view
    wx:for="{{items}}"
    wx:key="pagePath"
    class="tabbar__item {{selected === index ? 'is-active' : ''}}"
    bindtap="switchTab"
    data-index="{{index}}"
    data-path="{{item.pagePath}}"
  >
    <view class="tabbar__icon tabbar__icon--{{item.icon}}"></view>
    <text class="tabbar__label">{{item.text}}</text>
  </view>
</view>
```

- [ ] **Step 3: Run typecheck to catch broken tab references**

Run: `npm run typecheck:miniprogram`
Expected: PASS with no missing tab references.

- [ ] **Step 4: Commit the shell changes**

```bash
git add miniprogram/app.json miniprogram/custom-tab-bar/index.ts miniprogram/custom-tab-bar/index.wxml miniprogram/custom-tab-bar/index.wxss
git commit -m "refactor: reduce primary navigation to three tabs"
```

### Task 5: Rebuild the home page around quote, timer, and mini heatmap

**Files:**
- Modify: `miniprogram/pages/home/index.ts`
- Modify: `miniprogram/pages/home/index.wxml`
- Modify: `miniprogram/pages/home/index.wxss`
- Modify: `miniprogram/utils/view-models.ts`
- Test: `miniprogram/tests/view-models.spec.ts`

- [ ] **Step 1: Update the page state to hold quote copy and a monthly heatmap preview**

```ts
type HomePageData = {
  profile: HomeResponse["profile"] | null;
  activeSession: ActiveSession | null;
  timerText: string;
  quoteEn: string;
  quoteZh: string;
  monthLabel: string;
  monthTotalText: string;
  monthGrid: ReturnType<typeof buildMonthGrid>;
  actions: string[];
};
```

- [ ] **Step 2: Load home and calendar data together, then bind the compact layout**

```ts
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const [home, calendar] = await Promise.all([getHome(), getCalendar(month)]);
const quote = getDailyQuote(month + `-${String(now.getDate()).padStart(2, "0")}`);

this.setData({
  quoteEn: quote.en,
  quoteZh: quote.zh,
  monthLabel: `${now.getMonth() + 1}月`,
  monthGrid: buildMonthGrid(month, calendar.days).filter((item) => item.inMonth),
  monthTotalText: formatDuration(Object.values(calendar.days).reduce((sum, day) => sum + day.totalMinutes, 0))
});
```

- [ ] **Step 3: Replace the verbose hero UI with the minimal layout**

```xml
<view class="home">
  <view class="quote-card">
    <text class="quote-card__en">{{quoteEn}}</text>
    <text class="quote-card__zh">{{quoteZh}}</text>
  </view>

  <view class="timer-card">
    <text class="timer-card__status">{{activeSession ? (activeSession.status === 'paused' ? '已暂停' : '专注中') : '准备开始'}}</text>
    <text class="timer-card__clock">{{timerText}}</text>
    <view class="timer-card__actions">...</view>
  </view>

  <view class="mini-heatmap">
    <view class="mini-heatmap__header">
      <text>{{monthLabel}}</text>
      <text>{{monthTotalText}}</text>
    </view>
    <view class="mini-heatmap__grid">...</view>
  </view>
</view>
```

- [ ] **Step 4: Run the mini program tests and typecheck**

Run: `npm run test:miniprogram -- miniprogram/tests/view-models.spec.ts`
Expected: PASS

Run: `npm run typecheck:miniprogram`
Expected: PASS

- [ ] **Step 5: Commit the home redesign**

```bash
git add miniprogram/pages/home/index.ts miniprogram/pages/home/index.wxml miniprogram/pages/home/index.wxss miniprogram/utils/view-models.ts miniprogram/tests/view-models.spec.ts
git commit -m "refactor: simplify home page around timer and heatmap"
```

### Task 6: Rebuild the calendar page into a full heatmap view

**Files:**
- Modify: `miniprogram/pages/calendar/index.ts`
- Modify: `miniprogram/pages/calendar/index.wxml`
- Modify: `miniprogram/pages/calendar/index.wxss`

- [ ] **Step 1: Keep the current month loading logic, but drop explanatory cards and surface only summary + heatmap**

```xml
<view class="calendar-page">
  <view class="calendar-page__header">
    <text class="calendar-page__month">{{monthTitle}}</text>
    <text class="calendar-page__total">{{monthTotalText}}</text>
  </view>
  <view class="calendar-page__panel">
    <view class="calendar-page__weekdays">...</view>
    <view class="calendar-page__grid">...</view>
  </view>
</view>
```

- [ ] **Step 2: Style the heatmap as the primary object on the screen**

```css
.calendar-page__cell {
  border-radius: 18rpx;
  aspect-ratio: 1;
  background: #edf7f2;
}

.calendar-page__cell--heat-4 {
  background: #2ea985;
  color: #ffffff;
}
```

- [ ] **Step 3: Run mini program typecheck**

Run: `npm run typecheck:miniprogram`
Expected: PASS with the calendar page still compiling.

- [ ] **Step 4: Commit the calendar redesign**

```bash
git add miniprogram/pages/calendar/index.ts miniprogram/pages/calendar/index.wxml miniprogram/pages/calendar/index.wxss
git commit -m "refactor: focus calendar page on heatmap details"
```

### Task 7: Turn “我的” into a metrics-first study dashboard

**Files:**
- Modify: `miniprogram/pages/profile/index.ts`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `miniprogram/pages/profile/index.wxss`
- Modify: `miniprogram/utils/api.ts`
- Modify: `miniprogram/types/models.ts`

- [ ] **Step 1: Replace the old share-summary fetch with the new dashboard endpoint**

```ts
import { bootstrapProfile, getProfileDashboard } from "../../utils/api";

type ProfilePageData = {
  profile: ProfileDashboardResponse["profile"] | null;
  totalMinutesText: string;
  bestDayDate: string;
  bestDayDurationText: string;
  subjectSummaries: ReturnType<typeof buildSubjectSummary>;
};
```

- [ ] **Step 2: Render the new structure with nickname, subject totals, best day, and share entry**

```xml
<view class="profile-page">
  <view class="profile-card">...</view>

  <view class="metric-card">
    <text class="metric-card__label">累计学习</text>
    <text class="metric-card__value">{{totalMinutesText}}</text>
  </view>

  <view class="subject-panel">
    <view wx:for="{{subjectSummaries}}" wx:key="subject" class="subject-row">...</view>
  </view>

  <view class="metric-card">
    <text class="metric-card__label">最长学习日</text>
    <text class="metric-card__value">{{bestDayDate}}</text>
    <text class="metric-card__sub">{{bestDayDurationText}}</text>
  </view>

  <button bindtap="openShare">共享主页管理</button>
</view>
```

- [ ] **Step 3: Add the secondary navigation handlers**

```ts
openShare() {
  wx.navigateTo({ url: "/pages/share/index" });
}

editProfile() {
  wx.navigateTo({ url: "/package-profile/onboarding/index?mode=edit" });
}
```

- [ ] **Step 4: Run full verification for the redesign**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit the profile redesign**

```bash
git add miniprogram/pages/profile/index.ts miniprogram/pages/profile/index.wxml miniprogram/pages/profile/index.wxss miniprogram/utils/api.ts miniprogram/types/models.ts
git commit -m "refactor: redesign profile page around study metrics"
```

### Task 8: Final QA sweep and release notes

**Files:**
- Modify: `docs/wechat-release-playbook.md`
- Modify: `README.md`

- [ ] **Step 1: Add a short note describing the new three-tab IA and profile dashboard dependency**

```md
- Home now shows only a bilingual welcome quote, timer, and monthly heatmap preview.
- Calendar is the full heatmap view for day-by-day study review.
- Profile now depends on `/api/me/dashboard` for subject totals and longest study day.
```

- [ ] **Step 2: Re-run the final verification commands**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit the documentation touch-up**

```bash
git add README.md docs/wechat-release-playbook.md
git commit -m "docs: capture redesigned navigation and dashboard"
```
