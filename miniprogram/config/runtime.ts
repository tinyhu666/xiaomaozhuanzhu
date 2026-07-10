export const runtimeConfig = {
  basePath: "/api",
  // Sole transport: HTTPS to the备案'd 腾讯云轻量 VPS (api.buffpp.com), with
  // COS for all media. Must be in the 小程序后台 request 合法域名 whitelist.
  // v0.45 — 微信云托管 was fully removed; there is no longer a cloud:// /
  // wx.cloud fallback (and no rollback target).
  apiBaseUrl: "https://api.buffpp.com",
  appVersion: "0.45.0"
};
