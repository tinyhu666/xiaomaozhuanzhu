import fs from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { createApp } from "./app";
import { ensureMySqlSchema } from "./mysql-bootstrap";
import { ReminderScheduler } from "./domain/reminder-scheduler";
import { WeChatAPIClient } from "./domain/wechat-openapi";
import { MySQLStore } from "./store/mysql-store";
import { resolveDatabaseUrl } from "./env";

const envCandidates = [
  path.resolve(process.cwd(), "server/.env"),
  path.resolve(process.cwd(), ".env")
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  loadEnv({ path: envPath });
}

// 监听端口需与 VPS 上 nginx 的 proxy_pass 端口一致；可通过 PORT 环境变量覆盖。
const port = Number(process.env.PORT ?? 3000);

// v0.39 — WeChat credentials, resolved once and shared by both the
// wx.login auth route (createApp) and the reminder scheduler below.
// We accept both `WECHAT_APP_ID` (云托管 console convention) and
// `WECHAT_APPID` (WeChat-docs spelling) so the deploy works either way.
const wechatAppId = process.env.WECHAT_APP_ID ?? process.env.WECHAT_APPID ?? "";
const wechatAppSecret = process.env.WECHAT_APP_SECRET ?? "";
const sessionSecret = process.env.SESSION_SECRET ?? "";
const wechatClient =
  wechatAppId && wechatAppSecret
    ? new WeChatAPIClient({ appId: wechatAppId, appSecret: wechatAppSecret })
    : undefined;

// v0.39 — fail closed on a weak secret. A non-empty but short/guessable
// SESSION_SECRET produces fully-functional yet brute-forceable Bearer
// tokens (full identity forgery). In production we refuse to boot rather
// than serve forgeable tokens; off-production we only warn so local dev
// with a throwaway secret still works. Generate with e.g.
//   openssl rand -base64 48
if (sessionSecret && sessionSecret.length < 32) {
  const msg = `SESSION_SECRET too short (${sessionSecret.length} chars, need ≥32) — Bearer tokens would be brute-forceable`;
  if (process.env.NODE_ENV === "production") {
    console.error(msg + " — refusing to start");
    process.exit(1);
  }
  console.warn(msg + " (allowed off-production)");
}

// Surface a clear heads-up when wx.login can't work yet. On the VPS both
// must be set; in 云托管 mode neither is needed (openid is injected
// upstream), so this is just informational.
if (!sessionSecret) {
  console.warn("SESSION_SECRET unset — POST /api/auth/login disabled (Bearer auth off)");
} else if (!wechatClient) {
  console.warn("WECHAT_APP_ID/SECRET unset — POST /api/auth/login disabled");
}

const app = createApp({ wechat: wechatClient, sessionSecret });

// Listen first so the cloud-run health check passes; bootstrap MySQL in the
// background so a slow / misconfigured DB does not abort startup.
app.listen(port, () => {
  console.log(`CPA study check-in server listening on port ${port}`);
});

ensureMySqlSchema(process.env)
  .then((bootstrapped) => {
    if (bootstrapped) {
      console.log("MySQL schema bootstrap complete");
    } else {
      console.warn("MySQL bootstrap skipped (using in-memory store)");
    }
  })
  .catch((error) => {
    console.error("MySQL bootstrap failed (continuing in degraded state)", error);
  });

// v0.20 — daily 20:30 Asia/Shanghai reminder scheduler. We only
// start it when both prerequisites are present:
//   - a real MySQL store (so user state persists across restarts)
//   - the WeChat appid + app secret in env (so we can actually send)
// Missing either → log a warning and skip; the rest of the server
// still works. The cron is a setInterval; restart cost is one
// possibly-missed minute, which is acceptable for a daily moment.
//
// Credentials (wechatAppId / wechatAppSecret / wechatClient) are
// resolved once at the top of this file and shared with the auth route.
const reminderDbUrl = resolveDatabaseUrl(process.env);
if (reminderDbUrl && wechatClient) {
  try {
    const store = MySQLStore.fromConnectionString(reminderDbUrl);
    const scheduler = new ReminderScheduler({ store: store as never, apiClient: wechatClient });
    scheduler.start();
    console.log("Reminder scheduler started (Asia/Shanghai 20:30 daily)");
  } catch (error) {
    console.error("Failed to start reminder scheduler", error);
  }
} else {
  console.warn(
    "Reminder scheduler not started — set WECHAT_APPID + WECHAT_APP_SECRET + MYSQL_* envs"
  );
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
});
