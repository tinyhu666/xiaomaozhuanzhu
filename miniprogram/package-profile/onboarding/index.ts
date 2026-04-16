// @ts-nocheck
import { saveProfile } from "../../utils/api";

type OnboardingPageData = {
  mode: "create" | "edit";
  nickname: string;
  avatarUrl: string;
  saving: boolean;
};

Page<{}, OnboardingPageData>({
  data: {
    mode: "create",
    nickname: "",
    avatarUrl: "",
    saving: false
  },

  onLoad(query) {
    const mode = (query.mode as "create" | "edit") || "create";
    const profile = getApp<IAppOption>().globalData.profile;
    this.setData({
      mode,
      nickname: profile?.nickname || "",
      avatarUrl: profile?.avatarUrl || ""
    });
  },

  handleNicknameInput(event: WechatMiniprogram.Input) {
    this.setData({
      nickname: event.detail.value
    });
  },

  handleChooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({
      avatarUrl: event.detail.avatarUrl
    });
  },

  async submit() {
    if (!this.data.nickname.trim() || !this.data.avatarUrl) {
      wx.showToast({
        title: "请先填写昵称并选择头像",
        icon: "none"
      });
      return;
    }

    this.setData({ saving: true });
    try {
      const result = await saveProfile({
        nickname: this.data.nickname.trim(),
        avatarUrl: this.data.avatarUrl
      });
      getApp<IAppOption>().globalData.profile = result.profile;
      wx.showToast({
        title: "保存成功",
        icon: "success"
      });
      setTimeout(() => {
        if (this.data.mode === "edit") {
          wx.navigateBack();
        } else {
          wx.switchTab({
            url: "/pages/home/index"
          });
        }
      }, 300);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "保存失败",
        icon: "none"
      });
    } finally {
      this.setData({ saving: false });
    }
  }
});
