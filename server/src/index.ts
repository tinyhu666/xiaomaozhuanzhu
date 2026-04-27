import fs from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { createApp } from "./app";
import { ensureMySqlSchema } from "./mysql-bootstrap";

const envCandidates = [
  path.resolve(process.cwd(), "server/.env"),
  path.resolve(process.cwd(), ".env")
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  loadEnv({ path: envPath });
}

// 微信云托管默认探针端口为 80，可通过 PORT 环境变量覆盖。
const port = Number(process.env.PORT ?? 80);
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

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
});
