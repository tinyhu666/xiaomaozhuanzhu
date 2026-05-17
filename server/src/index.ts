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

// 监听端口需与云托管「服务设置 → 监听端口」一致；可通过 PORT 环境变量覆盖。
const port = Number(process.env.PORT ?? 3000);
const app = createApp();

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
const reminderDbUrl = resolveDatabaseUrl(process.env);
const wechatAppId = process.env.WECHAT_APPID ?? "";
const wechatAppSecret = process.env.WECHAT_APP_SECRET ?? "";
if (reminderDbUrl && wechatAppId && wechatAppSecret) {
  try {
    const store = MySQLStore.fromConnectionString(reminderDbUrl);
    const apiClient = new WeChatAPIClient({
      appId: wechatAppId,
      appSecret: wechatAppSecret
    });
    const scheduler = new ReminderScheduler({ store: store as never, apiClient });
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
