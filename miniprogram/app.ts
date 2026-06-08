// @ts-nocheck
import { runtimeConfig } from "./config/runtime";
import { bootstrapProfile, fetchAppConfig, isClientVersionBelow, warmUpBackend } from "./utils/api";

App<IAppOption>({
  globalData: {
    profile: null,
    bootstrapped: false
  },
  async onLaunch() {
    // 云托管 mode only — VPS mode (runtimeConfig.apiBaseUrl set) talks plain
    // HTTPS and must stay wx.cloud-free, so don't init the cloud SDK there.
    if (!runtimeConfig.apiBaseUrl) {
      wx.cloud.init({
        env: runtimeConfig.cloudEnv,
        traceUser: true
      });
    }
    // v0.42 — aggressively apply 小程序 updates so a published version drains
    // the old one fast (key during the 云托管 → VPS cutover).
    this.setupAutoUpdate();
    // Fire-and-forget probe so the backend is warm (and, in VPS mode, the
    // session token is pre-fetched) by the time a page calls bootstrap /
    // start. Errors are swallowed.
    warmUpBackend().catch(() => {});
    // v0.42 — launch gate: show「维护中」/「请升级」when the server says so.
    // Fail-open (never blocks launch on a fetch error).
    this.checkAppGate();
  },

  setupAutoUpdate() {
    const um = wx.getUpdateManager && wx.getUpdateManager();
    if (!um) return;
    um.onUpdateReady(() => {
      wx.showModal({
        title: "更新提示",
        content: "新版本已就绪，重启后生效",
        showCancel: false,
        confirmText: "立即重启",
        success: () => um.applyUpdate()
      });
    });
    um.onUpdateFailed(() => {
      console.warn("[app] 新版本下载失败，下次启动会重试");
    });
  },

  async checkAppGate() {
    const cfg = await fetchAppConfig();
    if (!cfg) return; // fail open
    if (cfg.maintenance) {
      wx.showModal({
        title: "服务维护中",
        content: cfg.message || "服务正在升级，请稍后再试。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
    if (cfg.minClientVersion && isClientVersionBelow(runtimeConfig.appVersion, cfg.minClientVersion)) {
      wx.showModal({
        title: "请更新版本",
        content: cfg.message || "当前版本过低，请更新到最新版后继续使用。",
        showCancel: false,
        confirmText: "去更新",
        success: () => {
          const um = wx.getUpdateManager && wx.getUpdateManager();
          if (um) um.applyUpdate();
        }
      });
    }
  },
  async ensureProfile() {
    // Onboarding is intentionally bypassed in this build: the WeChat
    // login flow is unreliable, so we never navigate to the profile
    // setup page. The server still tracks `needsOnboarding`, but the
    // miniprogram simply uses default identity until login is fixed.
    try {
      const result = await bootstrapProfile();
      this.globalData.profile = result.profile;
      this.globalData.bootstrapped = true;
    } catch (error) {
      console.warn("[app] bootstrapProfile failed", error);
    }
    return true;
  }
});
