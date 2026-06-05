// @ts-nocheck
import { completeSession, uploadCheckinPhoto } from "../../utils/api";
import type { Badge } from "../../types/models";
import { validateCompletionDraft } from "../../utils/view-models";

// v0.21.3 — restored subject-as-chips on the complete page (reverts
// v0.18.1's "pick before start" experiment). Subject is now a single-
// select chip row picked AFTER the session, which is when the user
// actually knows what they studied + dodges the URL-encoding round-
// trip bug that broke submits in v0.21.2.
const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"];
const TAGS = ["顺利", "卡住", "高效", "复习", "刷题", "新课"];

type LocalPhoto = {
  fileId: string;
  objectKey: string;
  localPath: string;
};

type ChipView = {
  value: string;
  selected: boolean;
};

type CompletePageData = {
  sessionId: string;
  durationText: string;
  summary: string;
  /** v0.37 — A3: optional free-text chapter/topic within the subject. */
  topic: string;
  /** v0.21.3 — restored single-select subject chip row. */
  subjectChips: ChipView[];
  tagChips: ChipView[];
  photos: LocalPhoto[];
  submitting: boolean;
  /** Pomodoro cycles completed in this session — display + submit. */
  pomodoroCycles: number;
  pomodoroBadgeText: string;
  /** v0.25 — when set, the user just unlocked an achievement on this
   *  submit. We surface a dedicated unlock overlay. If null, we just
   *  toast "已记录" and head home — no celebratory noise for sessions
   *  that didn't actually cross a threshold. (Replaces the per-
   *  session 「收获一只小猫」 modal that lived here in v0.18 - v0.24,
   *  which felt repetitive: every session triggered it.) */
  unlockedBadge: Badge | null;
  unlockedBadgeRarityLabel: string;
};

function makeChips(values: string[]): ChipView[] {
  return values.map((value) => ({ value, selected: false }));
}

Page<{}, CompletePageData>({
  data: {
    sessionId: "",
    durationText: "0 分钟",
    summary: "",
    topic: "",
    subjectChips: makeChips(SUBJECTS),
    tagChips: makeChips(TAGS),
    photos: [],
    submitting: false,
    pomodoroCycles: 0,
    pomodoroBadgeText: "",
    unlockedBadge: null,
    unlockedBadgeRarityLabel: ""
  },

  onLoad(query) {
    const minutes = Number(query.minutes ?? 0);
    const cycles = Math.max(0, Math.min(32, Number(query.cycles ?? 0) | 0));
    // v0.26 — removed the v0.21.3 defensive `query.subject` decode.
    // It was a transition-period fallback for v0.21.2 in-flight
    // sessions that had encoded subject in the URL. By now, every
    // installed client passes subject=null on start (v0.21.3+), so
    // the URL never carries a subject. Subject is always chosen on
    // this page via the chip row.
    this.setData({
      sessionId: String(query.sessionId ?? ""),
      durationText: `${minutes} 分钟`,
      subjectChips: SUBJECTS.map((value) => ({ value, selected: false })),
      pomodoroCycles: cycles,
      pomodoroBadgeText: cycles > 0 ? `🍅 完成 ${cycles} 个番茄` : ""
    });
  },

  handleSummaryInput(event: WechatMiniprogram.Input) {
    this.setData({
      summary: event.detail.value
    });
  },

  handleTopicInput(event: WechatMiniprogram.Input) {
    this.setData({
      topic: event.detail.value
    });
  },

  toggleSubject(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    // Single-select: tapping the active chip clears it; tapping a
    // different chip switches selection.
    const next = this.data.subjectChips.map((chip) => ({
      value: chip.value,
      selected: chip.value === value ? !chip.selected : false
    }));
    this.setData({ subjectChips: next });
  },

  toggleTag(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    const next = this.data.tagChips.map((chip) =>
      chip.value === value ? { value: chip.value, selected: !chip.selected } : chip
    );
    this.setData({ tagChips: next });
  },

  async choosePhotos() {
    const remain = 3 - this.data.photos.length;
    if (remain <= 0) return;

    let chooser: WechatMiniprogram.ChooseMediaSuccessCallbackResult;
    try {
      chooser = await wx.chooseMedia({
        count: remain,
        mediaType: ["image"],
        sourceType: ["album", "camera"]
      });
    } catch (error) {
      const message = typeof error === "object" && error && "errMsg" in error ? String(error.errMsg) : "";
      if (!message.includes("cancel")) {
        wx.showToast({ title: "选择照片失败", icon: "none" });
      }
      return;
    }

    if (!chooser?.tempFiles?.length) return;

    wx.showLoading({
      title: "上传中",
      mask: true
    });
    try {
      const uploaded: LocalPhoto[] = [];
      for (const file of chooser.tempFiles) {
        const result = await uploadCheckinPhoto(file.tempFilePath);
        uploaded.push(result);
      }
      this.setData({
        photos: [...this.data.photos, ...uploaded]
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "照片上传失败",
        icon: "none"
      });
    } finally {
      wx.hideLoading();
    }
  },

  removePhoto(event: WechatMiniprogram.BaseEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      photos: this.data.photos.filter((_item, itemIndex) => itemIndex !== index)
    });
  },

  previewPhoto(event: WechatMiniprogram.BaseEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const urls = this.data.photos.map((photo) => photo.localPath).filter((path) => Boolean(path));
    if (!urls.length) return;
    wx.previewImage({
      current: urls[Math.max(0, Math.min(index, urls.length - 1))],
      urls
    });
  },

  async submit() {
    const selectedSubjectChip = this.data.subjectChips.find((chip) => chip.selected);
    const selectedTags = this.data.tagChips.filter((chip) => chip.selected).map((chip) => chip.value);

    const validation = validateCompletionDraft({
      summary: this.data.summary,
      photos: this.data.photos
    });

    if (!validation.valid) {
      wx.showToast({
        title: validation.message,
        icon: "none"
      });
      return;
    }

    const subject = selectedSubjectChip?.value ?? null;
    this.setData({ submitting: true });
    try {
      // v0.25 — the server now responds with `newlyUnlockedBadge` set
      // when this completion crossed an achievement threshold. If so,
      // we show a dedicated achievement-unlock overlay. Otherwise we
      // just toast and head home — no per-session "你又收获了一只
      // 小猫" noise (the old garden cat-reveal modal was removed).
      const response = await completeSession(this.data.sessionId, {
        summary: this.data.summary,
        subject,
        topic: this.data.topic.trim() || null,
        tags: selectedTags,
        photos: this.data.photos.map((photo) => ({
          fileId: photo.fileId,
          objectKey: photo.objectKey
        })),
        pomodoroCycles: this.data.pomodoroCycles || 0
      });
      const unlocked = (response as { newlyUnlockedBadge?: Badge }).newlyUnlockedBadge ?? null;
      if (unlocked) {
        const rarityLabelMap: Record<string, string> = {
          common: "普通", rare: "稀有", epic: "史诗", legendary: "传说"
        };
        this.setData({
          submitting: false,
          unlockedBadge: unlocked,
          unlockedBadgeRarityLabel: rarityLabelMap[unlocked.rarity ?? "common"] ?? "普通"
        });
      } else {
        // No new achievement → quietly head home. The toast is just a
        // beat of acknowledgement so the tap doesn't feel like it
        // vanished into nothing.
        wx.showToast({ title: "已记录", icon: "success", duration: 1200 });
        setTimeout(() => wx.switchTab({ url: "/pages/home/index" }), 800);
      }
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "提交失败",
        icon: "none"
      });
      this.setData({ submitting: false });
    }
  },

  /**
   * Achievement-unlock overlay dismissal. Both the primary CTA
   * 「继续专注」 and backdrop-tap call this. Always heads home —
   * staying on a useless form is worse than auto-nav.
   */
  onTapUnlockDismiss() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  onTapUnlockContent(event: WechatMiniprogram.BaseEvent) {
    // Stop propagation so the card body doesn't dismiss.
    event.stopPropagation?.();
  },

  onTapOpenAchievements() {
    // v0.26 — was wx.navigateTo. Reading the flow end-to-end:
    //   complete (modal) → navigateTo badges → user back-gesture →
    //   complete still on stack with modal open → user has to tap
    //   "继续专注" again to actually leave.
    // redirectTo replaces /complete on the stack, so back from
    // badges goes straight to home (the tab the user was on before
    // they opened /complete). One fewer tap.
    wx.redirectTo({ url: "/package-profile/badges/index" });
  }
});
