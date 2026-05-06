// @ts-nocheck
import { completeSession, uploadCheckinPhoto } from "../../utils/api";
import { validateCompletionDraft } from "../../utils/view-models";

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
  subjectChips: ChipView[];
  tagChips: ChipView[];
  photos: LocalPhoto[];
  submitting: boolean;
};

function makeChips(values: string[]): ChipView[] {
  return values.map((value) => ({ value, selected: false }));
}

Page<{}, CompletePageData>({
  data: {
    sessionId: "",
    durationText: "0 分钟",
    summary: "",
    subjectChips: makeChips(SUBJECTS),
    tagChips: makeChips(TAGS),
    photos: [],
    submitting: false
  },

  onLoad(query) {
    const minutes = Number(query.minutes ?? 0);
    this.setData({
      sessionId: String(query.sessionId ?? ""),
      durationText: `${minutes} 分钟`
    });
  },

  handleSummaryInput(event: WechatMiniprogram.Input) {
    this.setData({
      summary: event.detail.value
    });
  },

  toggleSubject(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    const next = this.data.subjectChips.map((chip) => ({
      value: chip.value,
      // single-select: tapping the active chip clears it; tapping another
      // chip switches selection to that one.
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

    this.setData({ submitting: true });
    try {
      await completeSession(this.data.sessionId, {
        summary: this.data.summary,
        subject: selectedSubjectChip?.value ?? null,
        tags: selectedTags,
        photos: this.data.photos.map((photo) => ({
          fileId: photo.fileId,
          objectKey: photo.objectKey
        }))
      });
      wx.showToast({
        title: "打卡完成",
        icon: "success"
      });
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/home/index"
        });
      }, 400);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "提交失败",
        icon: "none"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
