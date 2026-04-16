// @ts-nocheck
Component({
  data: {
    selected: 0,
    items: [
      { pagePath: "/pages/home/index", text: "学习", short: "学" },
      { pagePath: "/pages/calendar/index", text: "日历", short: "历" },
      { pagePath: "/pages/share/index", text: "共享", short: "享" },
      { pagePath: "/pages/profile/index", text: "我的", short: "我" }
    ]
  },
  methods: {
    switchTab(event: WechatMiniprogram.BaseEvent) {
      const { path, index } = event.currentTarget.dataset as { path: string; index: number };
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
