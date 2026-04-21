// @ts-nocheck
import { saveProfile } from "./api";
import { buildAuthorizedProfile } from "./view-models";

export async function authorizeWechatProfile() {
  if (!wx.getUserProfile) {
    throw new Error("当前微信版本不支持授权昵称头像");
  }

  const profileResult = await new Promise<WechatMiniprogram.GetUserProfileSuccessCallbackResult>((resolve, reject) => {
    wx.getUserProfile({
      desc: "用于同步你的微信昵称和头像",
      success: resolve,
      fail: reject
    });
  });

  const profile = buildAuthorizedProfile(profileResult.userInfo);
  const result = await saveProfile(profile);

  const app = getApp<IAppOption>();
  app.globalData.profile = result.profile;
  app.globalData.needsProfile = !result.profile.profileCompleted;

  return result.profile;
}
