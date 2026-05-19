// @ts-nocheck
// v0.22 — bottom-tab slimmed from 4 to 3. The「动态」(news) tab was
// removed because it never tied back to the core focus loop (it was
// a CPA-news aggregator) and required ongoing scraper / moderation
// cost. The server-side news APIs are kept for now so any cached
// share URL still resolves, but there's no UI entry point.
Component({
  data: {
    selected: 0,
    items: [
      { pagePath: "/pages/home/index", text: "首页" },
      { pagePath: "/pages/calendar/index", text: "日历" },
      { pagePath: "/pages/profile/index", text: "我的" }
    ]
  },
  methods: {
    switchTab(event: WechatMiniprogram.BaseEvent) {
      const { path, index } = event.currentTarget.dataset as { path: string; index: number };
      if (this.data.selected === index) return;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
