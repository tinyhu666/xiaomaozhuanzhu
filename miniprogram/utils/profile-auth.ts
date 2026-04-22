// @ts-nocheck
import { loginWithWechatCode, saveProfile, uploadWechatAvatar } from "./api";

function buildAvatarStorageRef(objectKey: string) {
  return `storage://${objectKey.replace(/^\/+/, "")}`;
}

export async function authorizeWechatProfile(input: { nickname: string; avatarUrl: string }) {
  const nickname = input.nickname.trim();
  const avatarLocalPath = input.avatarUrl.trim();

  if (!nickname || !avatarLocalPath) {
    throw new Error("请先选择微信头像并填写昵称");
  }

  const loginResult = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject
    });
  });

  if (!loginResult.code) {
    throw new Error("微信登录失败，请重试");
  }

  await loginWithWechatCode(loginResult.code);
  const uploadedAvatar = await uploadWechatAvatar(avatarLocalPath);

  const result = await saveProfile({
    nickname,
    avatarUrl: buildAvatarStorageRef(uploadedAvatar.objectKey)
  });

  const app = getApp<IAppOption>();
  app.globalData.profile = result.profile;
  app.globalData.bootstrapped = true;
  app.globalData.needsProfile = !result.profile.profileCompleted;

  return result.profile;
}
