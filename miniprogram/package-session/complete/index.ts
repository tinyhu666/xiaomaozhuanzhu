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

type CompletePageData = {
  sessionId: string;
  durationText: string;
  summary: string;
  selectedSubject: string;
  selectedTags: string[];
  subjects: string[];
  tags: string[];
  photos: LocalPhoto[];
  submitting: boolean;
};

Page<{}, CompletePageData>({
  data: {
    sessionId: "",
    durationText: "0 分钟",
    summary: "",
    selectedSubject: "",
    selectedTags: [],
    subjects: SUBJECTS,
    tags: TAGS,
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
    this.setData({
      selectedSubject: this.data.selectedSubject === value ? "" : value
    });
  },

  toggleTag(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    const exists = this.data.selectedTags.includes(value);
    this.setData({
      selectedTags: exists
        ? this.data.selectedTags.filter((tag) => tag !== value)
        : [...this.data.selectedTags, value]
    });
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
        wx.showToast({
          title: error instanceof Error ? error.message : "选择图片失败，请重试",
          icon: "none"
        });
      }
      return;
    }

    if (!chooser.tempFiles.length) return;

    wx.showLoading({
      title: "上传中"
    });

    const originalCount = this.data.photos.length;
    const nextPhotos = [...this.data.photos];
    let failedCount = 0;

    try {
      for (const file of chooser.tempFiles) {
        try {
          const result = await uploadCheckinPhoto(file.tempFilePath);
          nextPhotos.push(result);
          this.setData({
            photos: [...nextPhotos]
          });
        } catch {
          failedCount += 1;
        }
      }
    } finally {
      wx.hideLoading();
    }

    if (failedCount > 0) {
      const successCount = nextPhotos.length - originalCount;
      wx.showToast({
        title: successCount > 0 ? `已上传${successCount}张，${failedCount}张失败` : "图片上传失败，请重试",
        icon: "none"
      });
    }
  },

  removePhoto(event: WechatMiniprogram.BaseEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      photos: this.data.photos.filter((_item, itemIndex) => itemIndex !== index)
    });
  },

  async submit() {
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
        subject: this.data.selectedSubject || null,
        tags: this.data.selectedTags,
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
