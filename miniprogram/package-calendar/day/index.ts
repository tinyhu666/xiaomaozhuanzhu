// @ts-nocheck
import { getCalendarDay, getTempUrls } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type DayPageData = {
  date: string;
  totalText: string;
  sessions: Array<{
    id: string;
    summary: string;
    subjects: string[];
    subjectText: string;
    tags: string[];
    totalMinutes: number;
    photos: Array<{ objectKey: string; url: string }>;
  }>;
};

Page<{}, DayPageData>({
  data: {
    date: "",
    totalText: "0m",
    sessions: []
  },

  async onLoad(query) {
    const date = String(query.date ?? "");
    this.setData({ date });
    await this.loadDay(date);
  },

  async loadDay(date: string) {
    try {
      const result = await getCalendarDay(date);
      const objectKeys = result.sessions.flatMap((session) => session.photos.map((photo) => photo.objectKey));
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
        totalText: formatDuration(result.totalMinutes),
        sessions: result.sessions.map((session) => ({
          id: session.id,
          summary: session.summary,
          subjects: session.subjects,
          subjectText: session.subjects.length ? session.subjects.join("、") : "未选择科目",
          tags: session.tags,
          totalMinutes: session.totalMinutes,
          photos: session.photos.map((photo) => ({
            objectKey: photo.objectKey,
            url: urlMap.get(photo.objectKey) || photo.fileId || ""
          }))
        }))
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载详情失败",
        icon: "none"
      });
    }
  },

  previewImage(event: WechatMiniprogram.BaseEvent) {
    const { sessionIndex, photoIndex } = event.currentTarget.dataset as { sessionIndex: string; photoIndex: string };
    const session = this.data.sessions[Number(sessionIndex)];
    const urls = session.photos.map((photo) => photo.url);
    const current = urls[Number(photoIndex)];
    wx.previewImage({
      current,
      urls
    });
  }
});
