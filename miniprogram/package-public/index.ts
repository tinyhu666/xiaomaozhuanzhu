// @ts-nocheck
import { getPublicProfile } from "../utils/api";
import { buildMonthGrid, formatDuration } from "../utils/view-models";

type PublicPageData = {
  profile: {
    nickname: string;
    avatarUrl: string;
  } | null;
  totalText: string;
  streakText: string;
  grid: ReturnType<typeof buildMonthGrid>;
  photos: Array<{ objectKey: string; tempUrl: string }>;
  summaries: Array<{ id: string; summary: string; subject: string | null; tags: string[] }>;
};

Page<{}, PublicPageData>({
  data: {
    profile: null,
    totalText: "0m",
    streakText: "0 天",
    grid: [],
    photos: [],
    summaries: []
  },

  async onLoad(query) {
    const slug = String(query.slug ?? "");
    if (!slug) {
      wx.showToast({ title: "缺少分享参数", icon: "none" });
      return;
    }
    await this.loadPublic(slug);
  },

  async loadPublic(slug: string) {
    try {
      const result = await getPublicProfile(slug);
      const latestDate = result.calendar[0]?.date ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
      const month = latestDate.slice(0, 7);
      const days = result.calendar
        .filter((item: { date: string }) => item.date.startsWith(month))
        .reduce<Record<string, { totalMinutes: number; heatLevel: number }>>((map, item) => {
          map[item.date] = {
            totalMinutes: item.totalMinutes,
            heatLevel: item.heatLevel
          };
          return map;
        }, {});

      this.setData({
        profile: result.profile,
        totalText: formatDuration(result.summary.totalMinutes),
        streakText: `${result.summary.currentStreakDays} 天`,
        grid: buildMonthGrid(month, days),
        photos: result.photos,
        summaries: result.recentSummaries
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载主页失败",
        icon: "none"
      });
    }
  }
});
