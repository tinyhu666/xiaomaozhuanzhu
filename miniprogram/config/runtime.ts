export const runtimeConfig = {
  cloudEnv: "prod-d4g3sqnpj0acb9be5",
  service: "cpa-study-checkin",
  basePath: "/api",
  // v0.41 (M3) — transport switch for the 云托管 → VPS migration.
  //   ""            → legacy 云托管 mode: wx.cloud.callContainer +
  //                   wx.cloud.uploadFile (cloud:// fileIds).
  //   "https://..." → VPS mode: wx.request to this origin + Bearer token
  //                   (wx.login auth) + COS direct upload.
  // The client is otherwise identical, so shipping with "" is a no-op;
  // cutover = set this to the备案'd HTTPS domain, rollback = clear it.
  // Must also be in the 小程序后台 request 合法域名 whitelist.
  apiBaseUrl: "",
  appVersion: "0.41.0"
};
