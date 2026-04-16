import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.spec.ts", "miniprogram/tests/**/*.spec.ts"],
    environment: "node"
  }
});

