import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..", "..");

describe("container entrypoints", () => {
  it("points the server package main field at the built entry file", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "server", "package.json"), "utf8")
    ) as { main?: string };

    expect(packageJson.main).toBe("dist/src/index.js");
  });

  it("starts both Docker images from the built server entry file", () => {
    const rootDockerfile = fs.readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");
    const serverDockerfile = fs.readFileSync(path.join(projectRoot, "server", "Dockerfile"), "utf8");

    expect(rootDockerfile).toContain('CMD ["node", "dist/src/index.js"]');
    expect(serverDockerfile).toContain('CMD ["node", "dist/src/index.js"]');
  });
});
