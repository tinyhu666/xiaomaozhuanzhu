import fs from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { resolveDatabaseUrl } from "../src/env";
import { ensureMySqlSchema } from "../src/mysql-bootstrap";
import { ingestQuotes } from "../src/quotes/ingest-quotes";
import { MemoryStore } from "../src/store/memory-store";
import { MySQLStore } from "../src/store/mysql-store";
import type { DataStore } from "../src/store/types";

const envCandidates = [
  path.resolve(process.cwd(), "server/.env"),
  path.resolve(process.cwd(), ".env")
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  loadEnv({ path: envPath });
}

async function main() {
  let store: DataStore;
  let storageMode: "mysql" | "memory" | "memory-fallback";
  try {
    store = await createDataStore();
    storageMode = store instanceof MySQLStore ? "mysql" : "memory";
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.log("Quote ingest could not prepare MySQL, retrying with in-memory storage for local validation.");
      console.log(error instanceof Error ? error.message : String(error));
      store = new MemoryStore();
      storageMode = "memory-fallback";
    } else {
      throw error;
    }
  }

  try {
    const summary = await ingestQuotes({ store });
    console.log(
      JSON.stringify(
        {
          ...summary,
          storageMode
        },
        null,
        2
      )
    );
  } catch (error) {
    if (store instanceof MySQLStore && process.env.NODE_ENV !== "production") {
      console.log("Quote ingest lost the MySQL connection, retrying with in-memory storage for local validation.");
      const summary = await ingestQuotes({ store: new MemoryStore() });
      console.log(
        JSON.stringify(
          {
            ...summary,
            storageMode: "memory-fallback"
          },
          null,
          2
        )
      );
      return;
    }
    throw error;
  }
}

async function createDataStore(): Promise<DataStore> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (connectionString) {
    await ensureMySqlSchema(process.env);
    return MySQLStore.fromConnectionString(connectionString);
  }
  return new MemoryStore();
}

main().catch((error) => {
  console.error("Failed to ingest home quotes", error);
  process.exit(1);
});
