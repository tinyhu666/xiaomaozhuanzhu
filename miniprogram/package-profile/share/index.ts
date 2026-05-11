// @ts-nocheck
import { getShareMe, updateShareSettings } from "../../utils/api";

type ShareInfo = {
  shareSlug: string;
  isPublic: boolean;
  requireWechatAuth: boolean;
};

type SharePageData = {
  shareInfo: ShareInfo;
  shareUrl: string;
};

Page<{}, SharePageData>({
  data: {
    shareInfo: { shareSlug: "", isPublic: false, requireWechatAuth: true },
    shareUrl: ""
  },

  async onLoad() {
    await this.refresh();
  },

  async refresh() {
    try {
      const result = await getShareMe();
      const profile = result.profile;
      this.applyShareInfo({
        shareSlug: profile.shareSlug,
        isPublic: profile.isPublic,
        requireWechatAuth: profile.requireWechatAuth
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    }
  },

  applyShareInfo(info: ShareInfo) {
    this.setData({
      shareInfo: info,
      // In-app share path. Friends opening this in WeChat land on the
      // public profile sub-page. Outside WeChat, we expose the path
      // as a readable preview (real distribution is always through
      // the WeChat share card below).
      shareUrl: `/pages/public/index?slug=${info.shareSlug}`
    });
  },

  async onToggle(event: WechatMiniprogram.SwitchChange) {
    const next = !!event.detail.value;
    await this.commit({ isPublic: next, requireWechatAuth: this.data.shareInfo.requireWechatAuth });
  },

  async onToggleAuth(event: WechatMiniprogram.SwitchChange) {
    const next = !!event.detail.value;
    await this.commit({ isPublic: this.data.shareInfo.isPublic, requireWechatAuth: next });
  },

  async commit(payload: { isPublic: boolean; requireWechatAuth: boolean }) {
    try {
      const result = await updateShareSettings(payload);
      this.applyShareInfo({
        shareSlug: result.publicProfile.shareSlug,
        isPublic: result.publicProfile.isPublic,
        requireWechatAuth: result.publicProfile.requireWechatAuth
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "保存失败",
        icon: "none"
      });
    }
  },

  copyLink() {
    if (!this.data.shareUrl) return;
    wx.setClipboardData({
      data: this.data.shareUrl,
      success: () => wx.showToast({ title: "已复制", icon: "success" })
    });
  },

  /**
   * WeChat share card returned when the user taps the share button or
   * the right-corner ⋯ menu. Points friends at the public sub-page.
   */
  onShareAppMessage() {
    const slug = this.data.shareInfo.shareSlug;
    return {
      title: "小猫专注 · 我的学习页",
      path: `/pages/public/index?slug=${slug}`,
      imageUrl: ""
    };
  }
});
