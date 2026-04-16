import fs from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { createApp } from "./app";

const envCandidates = [
  path.resolve(process.cwd(), "server/.env"),
  path.resolve(process.cwd(), ".env")
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  loadEnv({ path: envPath });
}

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`CPA study check-in server listening on port ${port}`);
});
