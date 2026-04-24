// @ts-nocheck
import type { CalendarDayResponse } from "../../types/models";
import { getCalendar, getCalendarDay, getTempUrls } from "../../utils/api";
import { buildMonthGrid, formatDuration } from "../../utils/view-models";

type CalendarDayDetail = Omit<CalendarDayResponse, "sessions"> & {
  sessions: Array<CalendarDayResponse["sessions"][number] & { subjectText: string }>;
};

type CalendarPageData = {
  month: string;
  monthTitle: string;
  grid: ReturnType<typeof buildMonthGrid>;
  monthTotalText: string;
  selectedDate: string;
  selectedDateText: string;
  selectedTotalText: string;
  selectedDetail: CalendarDayDetail | null;
};

Page<{}, CalendarPageData>({
  data: {
    month: "",
    monthTitle: "",
    grid: [],
    monthTotalText: "0m",
    selectedDate: "",
    selectedDateText: "",
    selectedTotalText: "0m",
    selectedDetail: null
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 1 });
    try {
      await getApp<IAppOption>().bootstrapProfileState();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载用户状态失败",
        icon: "none"
      });
      return;
    }
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
      const grid = buildMonthGrid(month, result.days);
      const selectedDate = this.pickSelectedDate(grid);
      const [yearText, monthText] = month.split("-");

      this.setData({
        monthTitle: `${yearText}年${monthText}月`,
        grid,
        monthTotalText: formatDuration(totalMinutes),
        selectedDate
      });

      await this.loadDay(selectedDate);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载日历失败",
        icon: "none"
      });
    }
  },

  async loadDay(date: string) {
    try {
      const detail = await getCalendarDay(date);
      const objectKeys = detail.sessions.flatMap((session) => session.photos.map((photo) => photo.objectKey));
      let tempUrls: Awaited<ReturnType<typeof getTempUrls>> = { items: [] };
      if (objectKeys.length) {
        try {
          tempUrls = await getTempUrls(objectKeys);
        } catch (error) {
          wx.showToast({
            title: error instanceof Error ? error.message : "图片加载失败，已显示记录",
            icon: "none"
          });
        }
      }
      const urlMap = new Map(tempUrls.items.map((item) => [item.objectKey, item.url]));

      this.setData({
        selectedDate: date,
        selectedDateText: date.replace(/-/g, "."),
        selectedTotalText: formatDuration(detail.totalMinutes),
        selectedDetail: {
          ...detail,
          sessions: detail.sessions.map((session) => ({
            ...session,
            subjectText: session.subjects.length ? session.subjects.join("、") : "学习记录",
            photos: session.photos.map((photo) => ({
              ...photo,
              tempUrl: urlMap.get(photo.objectKey) || photo.tempUrl || photo.fileId || ""
            }))
          }))
        }
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载当天详情失败",
        icon: "none"
      });
    }
  },

  pickSelectedDate(grid: ReturnType<typeof buildMonthGrid>) {
    if (this.data.selectedDate && this.data.selectedDate.startsWith(this.data.month)) {
      return this.data.selectedDate;
    }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (today.startsWith(this.data.month) && grid.some((item) => item.date === today && item.inMonth)) {
      return today;
    }

    const inMonth = grid.filter((item) => item.inMonth);
    const hottest = [...inMonth]
      .filter((item) => item.totalMinutes > 0)
      .sort((left, right) => {
        if (right.totalMinutes !== left.totalMinutes) {
          return right.totalMinutes - left.totalMinutes;
        }
        return right.date.localeCompare(left.date);
      })[0];

    return hottest?.date ?? inMonth[0]?.date ?? "";
  },

  async handlePrevMonth() {
    this.shiftMonth(-1);
    await this.loadMonth();
  },

  async handleNextMonth() {
    this.shiftMonth(1);
    await this.loadMonth();
  },

  async openDay(event: WechatMiniprogram.BaseEvent) {
    const { date, inmonth } = event.currentTarget.dataset as { date: string; inmonth: boolean };
    if (!inmonth) return;
    await this.loadDay(date);
  },

  shiftMonth(amount: number) {
    const [yearText, monthText] = this.data.month.split("-");
    const value = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + amount, 1));
    this.setData({
      month: `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`
    });
  }
});
