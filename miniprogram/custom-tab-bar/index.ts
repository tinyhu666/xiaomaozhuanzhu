// @ts-nocheck
// v0.22 — bottom-tab slimmed from 4 to 3. The「动态」(news) tab was
// removed because it never tied back to the core focus loop (it was
// a CPA-news aggregator) and required ongoing scraper / moderation
// cost. The server-side news APIs are kept for now so any cached
// share URL still resolves, but there's no UI entry point.
//
// v0.25.4 — added the `hidden` data field so the home page can
// collapse the tab bar during focus mode. The previous attempt
// (v0.22) misused wx.hideTabBar / wx.showTabBar to hide the tab
// bar; those APIs operate on the NATIVE tab bar and under
// `custom: true` spawn a phantom native bar ON TOP of the custom
// one. Pages must use this.getTabBar().setData({ hidden: true })
// instead. See CLAUDE.md + docs/ui-review-checklist.md §2A.
Component({
  data: {
    selected: 0,
    /**
     * v0.25.4 — when true, the root view collapses (display:none),
     * uncovering whatever the page draws below. Home's syncFocusMode
     * toggles this on session start / end so the focus-mode timer's
     * action buttons aren't covered.
     */
    hidden: false,
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
