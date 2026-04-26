// @ts-nocheck
import { saveProfile, uploadAvatar } from "../../utils/api";

type OnboardingPageData = {
  mode: "create" | "edit";
  nickname: string;
  avatarUrl: string;
  avatarLocalPath: string;
  saving: boolean;
};

Page<{}, OnboardingPageData>({
  data: {
    mode: "create",
    nickname: "",
    avatarUrl: "",
    avatarLocalPath: "",
    saving: false
  },

  onLoad(query) {
    const mode = (query.mode as "create" | "edit") || "create";
    const profile = getApp<IAppOption>().globalData.profile;
    this.setData({
      mode,
      nickname: profile?.nickname || "",
      avatarUrl: profile?.avatarUrl || "",
      avatarLocalPath: ""
    });
  },

  onChooseAvatar(event: WechatMiniprogram.CustomEvent) {
    const avatarUrl = event.detail?.avatarUrl as string | undefined;
    if (!avatarUrl) return;
    this.setData({
      avatarUrl,
      avatarLocalPath: avatarUrl
    });
  },

  onNicknameInput(event: WechatMiniprogram.Input) {
    this.setData({
      nickname: event.detail.value
    });
  },

  onNicknameBlur(event: WechatMiniprogram.CustomEvent) {
    const value = (event.detail?.value as string | undefined) ?? this.data.nickname;
    this.setData({
      nickname: (value || "").trim()
    });
  },

  async handleSave() {
    if (this.data.saving) return;

    const nickname = (this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    if (!this.data.avatarUrl) {
      wx.showToast({ title: "请选择头像", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    try {
      let avatarUrl = this.data.avatarUrl;
      if (this.data.avatarLocalPath) {
        const uploaded = await uploadAvatar(this.data.avatarLocalPath);
        avatarUrl = uploaded.fileId;
      }

      const result = await saveProfile({ nickname, avatarUrl });
      getApp<IAppOption>().globalData.profile = result.profile;
      this.setData({
        nickname: result.profile.nickname,
        avatarUrl: result.profile.avatarUrl,
        avatarLocalPath: ""
      });

      wx.showToast({ title: "保存成功", icon: "success" });
      setTimeout(() => {
        if (this.data.mode === "edit") {
          wx.navigateBack();
        } else {
          wx.switchTab({ url: "/pages/home/index" });
        }
      }, 320);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "errMsg" in error
            ? String((error as { errMsg: string }).errMsg)
            : "保存失败，请稍后重试";
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
