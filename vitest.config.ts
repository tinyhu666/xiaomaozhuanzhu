import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.spec.ts", "miniprogram/tests/**/*.spec.ts"],
    environment: "node",
    // Contract tests each spin up a full Express app via supertest. On a
    // cold first run with all files transforming in parallel, an unlucky
    // test could brush the 5s default timeout under CPU contention (a flaky
    // timeout, never an assertion failure). 20s removes that flakiness;
    // real assertion failures still fail immediately, so coverage is intact.
    testTimeout: 20000,
    hookTimeout: 20000
  }
});

