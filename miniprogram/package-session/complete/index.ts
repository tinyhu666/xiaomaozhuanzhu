// @ts-nocheck
import { completeSession, uploadCheckinPhoto } from "../../utils/api";
import { previewCatForSession, type CatCard } from "../../utils/garden";
import { validateCompletionDraft } from "../../utils/view-models";

// v0.18.1 — SUBJECTS list no longer rendered as chips here; the
// subject is read-only and comes from the home-page chip selection.
// Tag chip list stays — tags ARE only chosen at completion time.
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
  /** v0.18.1 — read-only locked subject (chosen on home before start).
   *  Empty string means "user didn't pick" → renders as "未分类". */
  lockedSubject: string;
  tagChips: ChipView[];
  photos: LocalPhoto[];
  submitting: boolean;
  /** Pomodoro cycles completed in this session — display + submit. */
  pomodoroCycles: number;
  pomodoroBadgeText: string;
  /** When non-null, the page renders a celebratory overlay showing the
   *  cat the user just earned. Set after a successful submit; cleared
   *  when we navigate away. */
  earnedCat: CatCard | null;
  earnedCatRarityLabel: string;
};

function makeChips(values: string[]): ChipView[] {
  return values.map((value) => ({ value, selected: false }));
}

Page<{}, CompletePageData>({
  data: {
    sessionId: "",
    durationText: "0 分钟",
    summary: "",
    lockedSubject: "",
    tagChips: makeChips(TAGS),
    photos: [],
    submitting: false,
    pomodoroCycles: 0,
    pomodoroBadgeText: "",
    earnedCat: null,
    earnedCatRarityLabel: ""
  },

  onLoad(query) {
    const minutes = Number(query.minutes ?? 0);
    const preselected = String(query.subject ?? "");
    const cycles = Math.max(0, Math.min(32, Number(query.cycles ?? 0) | 0));
    this.setData({
      sessionId: String(query.sessionId ?? ""),
      durationText: `${minutes} 分钟`,
      // v0.18.1 — subject is locked from the home-page picker. Stored
      // as a single string, no toggling possible on this page.
      lockedSubject: preselected,
      pomodoroCycles: cycles,
      pomodoroBadgeText: cycles > 0 ? `🍅 完成 ${cycles} 个番茄` : ""
    });
  },

  handleSummaryInput(event: WechatMiniprogram.Input) {
    this.setData({
      summary: event.detail.value
    });
  },

  // v0.18.1 — toggleSubject handler removed; subject is locked-in
  // from the home page and rendered read-only above.

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

    const subject = this.data.lockedSubject || null;
    this.setData({ submitting: true });
    try {
      await completeSession(this.data.sessionId, {
        summary: this.data.summary,
        subject,
        tags: selectedTags,
        photos: this.data.photos.map((photo) => ({
          fileId: photo.fileId,
          objectKey: photo.objectKey
        })),
        pomodoroCycles: this.data.pomodoroCycles || 0
      });
      // Derive the cat the user just earned and reveal it inline.
      // This is the v0.18 "instant feedback" moment — the dopamine
      // hit lands at session-complete time instead of being deferred
      // until the user navigates to the garden tab.
      const minutesFromText = Number((this.data.durationText.match(/\d+/) || [0])[0]);
      const earnedCat = previewCatForSession({
        sessionId: this.data.sessionId,
        subject,
        durationMinutes: Number.isFinite(minutesFromText) ? minutesFromText : 0,
        pomodoroCycles: this.data.pomodoroCycles || 0
      });
      const rarityLabelMap: Record<string, string> = {
        common: "普通", rare: "稀有", epic: "史诗", legendary: "传说"
      };
      this.setData({
        submitting: false,
        earnedCat,
        earnedCatRarityLabel: rarityLabelMap[earnedCat.rarity] ?? "普通"
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "提交失败",
        icon: "none"
      });
      this.setData({ submitting: false });
    }
  },

  /**
   * Dismissal — both the "继续专注" CTA and tap-backdrop call this.
   * We always navigate home; the alternative ("stay on the complete
   * page") would leave the user staring at a useless form.
   */
  onTapCatDismiss() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  onTapCatContent(event: WechatMiniprogram.BaseEvent) {
    // Stop tap propagation so the user can read the card details
    // without the backdrop tap dismissing them.
    event.stopPropagation?.();
  },

  onTapOpenGarden() {
    // The garden subpackage lives in package-profile; we navigate
    // there directly rather than going through 我的 tab.
    wx.navigateTo({ url: "/package-profile/garden/index" });
  }
});
