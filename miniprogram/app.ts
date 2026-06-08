// @ts-nocheck
import { runtimeConfig } from "./config/runtime";
import { bootstrapProfile, warmUpBackend } from "./utils/api";

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
    // Fire-and-forget probe so the backend is warm (and, in VPS mode, the
    // session token is pre-fetched) by the time a page calls bootstrap /
    // start. Errors are swallowed.
    warmUpBackend().catch(() => {});
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
