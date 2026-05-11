// @ts-nocheck
Component({
  data: {
    selected: 0,
    items: [
      { pagePath: "/pages/home/index", text: "首页" },
      { pagePath: "/pages/calendar/index", text: "日历" },
      { pagePath: "/pages/profile/index", text: "我的" },
      { pagePath: "/pages/news/index", text: "动态" }
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
