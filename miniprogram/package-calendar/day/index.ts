// @ts-nocheck
import { getCalendarDay, getTempUrls } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type DayPageData = {
  date: string;
  totalText: string;
  sessions: Array<{
    id: string;
    summary: string;
    subject: string | null;
    tags: string[];
    totalMinutes: number;
    photos: Array<{ objectKey: string; url: string }>;
  }>;
  /** v0.32.7 — distinguishes a genuine "no records" day from a load
   *  failure (network off). Without this the catch path left sessions
   *  empty and the page silently showed the "还没有打卡记录" empty
   *  state, which reads as "you didn't study" rather than "load
   *  failed — tap to retry". */
  loadState: "loading" | "loaded" | "error";
};

Page<{}, DayPageData>({
  data: {
    date: "",
    totalText: "0m",
    sessions: [],
    loadState: "loading"
  },

  async onLoad(query) {
    const date = String(query.date ?? "");
    this.setData({ date });
    await this.loadDay(date);
  },

  /** Retry button on the error state re-runs the load for the same day. */
  retryLoad() {
    if (this.data.date) this.loadDay(this.data.date);
  },

  async loadDay(date: string) {
    this.setData({ loadState: "loading" });
    try {
      const result = await getCalendarDay(date);
      const photoRefs = result.sessions.flatMap((session) =>
        session.photos.map((photo) => ({ objectKey: photo.objectKey, fileId: photo.fileId }))
      );
      let urlMap = new Map<string, string>();
      if (photoRefs.length) {
        try {
          const tempUrls = await getTempUrls(photoRefs);
          urlMap = new Map(tempUrls.items.map((item) => [item.objectKey, item.url]));
        } catch (error) {
          console.warn("[day] getTempUrls failed, fallback to fileId", error);
        }
      }

      this.setData({
        loadState: "loaded",
        totalText: formatDuration(result.totalMinutes),
        sessions: result.sessions.map((session) => ({
          id: session.id,
          summary: session.summary,
          subject: session.subject,
          tags: session.tags,
          totalMinutes: session.totalMinutes,
          photos: session.photos.map((photo) => ({
            objectKey: photo.objectKey,
            fileId: photo.fileId,
            url: urlMap.get(photo.objectKey) || photo.fileId || ""
          }))
        }))
      });
    } catch (error) {
      this.setData({ loadState: "error" });
      wx.showToast({
        title: error instanceof Error ? error.message : "加载详情失败",
        icon: "none"
      });
    }
  },

  previewImage(event: WechatMiniprogram.BaseEvent) {
    const { sessionIndex, photoIndex } = event.currentTarget.dataset as { sessionIndex: string; photoIndex: string };
    const session = this.data.sessions[Number(sessionIndex)];
    if (!session) return;
    const urls = session.photos.map((photo) => photo.url).filter((url) => Boolean(url));
    if (!urls.length) return;
    const current = session.photos[Number(photoIndex)]?.url;
    wx.previewImage({
      current: current && urls.includes(current) ? current : urls[0],
      urls
    });
  }
});
