// @ts-nocheck
import { getCalendar } from "../../utils/api";
import { buildMonthGrid, formatDuration } from "../../utils/view-models";

type CalendarPageData = {
  month: string;
  monthTitle: string;
  grid: ReturnType<typeof buildMonthGrid>;
  monthTotalText: string;
};

Page<{}, CalendarPageData>({
  data: {
    month: "",
    monthTitle: "",
    grid: [],
    monthTotalText: "0m"
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 1 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    if (!this.data.month) {
      const now = new Date();
      this.setData({
        month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      });
    }
    await this.loadMonth();
  },

  async loadMonth() {
    try {
      const month = this.data.month;
      const result = await getCalendar(month);
      const totalMinutes = Object.values(result.days).reduce((sum, day) => sum + day.totalMinutes, 0);
      this.setData({
        monthTitle: month.replace("-", " 年 ") + " 月",
        grid: buildMonthGrid(month, result.days),
        monthTotalText: formatDuration(totalMinutes)
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载日历失败",
        icon: "none"
      });
    }
  },

  async handlePrevMonth() {
    this.shiftMonth(-1);
    await this.loadMonth();
  },

  async handleNextMonth() {
    this.shiftMonth(1);
    await this.loadMonth();
  },

  openDay(event: WechatMiniprogram.BaseEvent) {
    const { date, inmonth } = event.currentTarget.dataset as { date: string; inmonth: boolean };
    if (!inmonth) return;
    wx.navigateTo({
      url: `/package-calendar/day/index?date=${date}`
    });
  },

  shiftMonth(amount: number) {
    const [yearText, monthText] = this.data.month.split("-");
    const value = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + amount, 1));
    this.setData({
      month: `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`
    });
  }
});
