// @ts-nocheck
import { saveProfile } from "../../utils/api";
import { buildAuthorizedProfile } from "../../utils/view-models";

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

  async authorizeProfile() {
    if (this.data.saving) return;

    if (!wx.getUserProfile) {
      wx.showToast({
        title: "当前微信版本不支持授权昵称头像",
        icon: "none"
      });
      return;
    }

    this.setData({ saving: true });
    try {
      const profileResult = await new Promise<WechatMiniprogram.GetUserProfileSuccessCallbackResult>((resolve, reject) => {
        wx.getUserProfile({
          desc: "用于同步你的微信昵称和头像",
          success: resolve,
          fail: reject
        });
      });

      const profile = buildAuthorizedProfile(profileResult.userInfo);
      const result = await saveProfile(profile);

      getApp<IAppOption>().globalData.profile = result.profile;
      this.setData({
        nickname: result.profile.nickname,
        avatarUrl: result.profile.avatarUrl
      });

      wx.showToast({
        title: "同步成功",
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
      const message = typeof error === "object" && error && "errMsg" in error ? String(error.errMsg) : "";
      if (message.includes("cancel")) {
        wx.showToast({
          title: "你取消了微信授权",
          icon: "none"
        });
        return;
      }

      wx.showToast({
        title: error instanceof Error ? error.message : "同步失败，请稍后重试",
        icon: "none"
      });
    } finally {
      this.setData({ saving: false });
    }
  }
});
