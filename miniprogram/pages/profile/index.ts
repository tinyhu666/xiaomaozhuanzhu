// @ts-nocheck
import type { UserProfile } from "../../types/models";
import { startSession } from "../../utils/api";
import { authorizeWechatProfile } from "../../utils/profile-auth";

type ProfilePageData = {
  profile: UserProfile | null;
  needsProfile: boolean;
  pendingStartAfterAuth: boolean;
  authLoading: boolean;
  authButtonText: string;
  nicknameDraft: string;
  avatarDraftUrl: string;
  canSubmitLogin: boolean;
};

function getAuthButtonText(action: "startSession" | null) {
  return action === "startSession" ? "微信登录并开始计时" : "微信登录";
}

function canSubmitLogin(nickname: string, avatarDraftUrl: string) {
  return nickname.trim().length > 0 && avatarDraftUrl.trim().length > 0;
}

Page<{}, ProfilePageData>({
  data: {
    profile: null,
    needsProfile: false,
    pendingStartAfterAuth: false,
    authLoading: false,
    authButtonText: "微信登录",
    nicknameDraft: "",
    avatarDraftUrl: "",
    canSubmitLogin: false
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 2 });

    const app = getApp<IAppOption>();
    const pendingAction = app.globalData.pendingProfileAction;

    try {
      const bootstrap = await app.bootstrapProfileState();
      const needsProfile = bootstrap.needsOnboarding;

      this.setData({
        profile: bootstrap.profile,
        needsProfile,
        pendingStartAfterAuth: needsProfile && pendingAction === "startSession",
        authButtonText: needsProfile ? getAuthButtonText(pendingAction) : "已登录",
        nicknameDraft: needsProfile ? "" : bootstrap.profile.nickname,
        avatarDraftUrl: needsProfile ? "" : bootstrap.profile.avatarUrl,
        canSubmitLogin: needsProfile ? false : true
      });
    } catch (error) {
      if (!isMissingWechatIdentity(error)) {
        wx.showToast({
          title: error instanceof Error ? error.message : "加载个人信息失败",
          icon: "none"
        });
      }

      this.setData({
        profile: null,
        needsProfile: true,
        pendingStartAfterAuth: pendingAction === "startSession",
        authButtonText: getAuthButtonText(pendingAction),
        nicknameDraft: "",
        avatarDraftUrl: "",
        canSubmitLogin: false
      });
    }
  },

  handleChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
    const avatarDraftUrl = event.detail?.avatarUrl?.trim?.() ?? "";
    this.setData({
      avatarDraftUrl,
      canSubmitLogin: canSubmitLogin(this.data.nicknameDraft, avatarDraftUrl)
    });
  },

  handleNicknameInput(event: { detail?: { value?: string } }) {
    const nicknameDraft = event.detail?.value ?? "";
    this.setData({
      nicknameDraft,
      canSubmitLogin: canSubmitLogin(nicknameDraft, this.data.avatarDraftUrl)
    });
  },

  handleNicknameReview(event: { detail?: { pass?: boolean; timeout?: boolean } }) {
    if (event.detail?.pass === false && !event.detail.timeout) {
      wx.showToast({
        title: "该昵称暂时不可用，请换一个试试",
        icon: "none"
      });
    }
  },

  async submitWechatLogin() {
    if (this.data.authLoading) return;

    if (!this.data.canSubmitLogin) {
      wx.showToast({
        title: "请先选择微信头像并填写昵称",
        icon: "none"
      });
      return;
    }

    this.setData({ authLoading: true });
    try {
      const app = getApp<IAppOption>();
      const profile = await authorizeWechatProfile({
        nickname: this.data.nicknameDraft,
        avatarUrl: this.data.avatarDraftUrl
      });
      const pendingAction = app.globalData.pendingProfileAction;

      this.setData({
        profile,
        needsProfile: false,
        pendingStartAfterAuth: false,
        authButtonText: "已登录",
        nicknameDraft: profile.nickname,
        avatarDraftUrl: profile.avatarUrl,
        canSubmitLogin: true
      });

      if (pendingAction === "startSession") {
        await startSession();
        app.consumePendingProfileAction();
        wx.showToast({
          title: "已开始计时",
          icon: "success"
        });
        setTimeout(() => {
          wx.switchTab({
            url: "/pages/home/index"
          });
        }, 300);
        return;
      }

      wx.showToast({
        title: "微信登录成功",
        icon: "success"
      });
    } catch (error) {
      const message = typeof error === "object" && error && "errMsg" in error ? String(error.errMsg) : "";
      if (message.includes("cancel")) {
        wx.showToast({
          title: "你取消了微信登录",
          icon: "none"
        });
        return;
      }

      wx.showToast({
        title: error instanceof Error ? error.message : "微信登录失败，请稍后重试",
        icon: "none"
      });
    } finally {
      this.setData({ authLoading: false });
    }
  }
});

function isMissingWechatIdentity(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Wechat identity is required") || message.includes("HTTP 401");
}
