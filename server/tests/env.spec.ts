import { describe, expect, it } from "vitest";

import { resolveDatabaseUrl } from "../src/env";

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL when it is present", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: "mysql://root:password@127.0.0.1:3306/direct_db",
        MYSQL_ADDRESS: "10.33.112.29:3306",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "secret",
        MYSQL_DATABASE: "ignored_db"
      })
    ).toBe("mysql://root:password@127.0.0.1:3306/direct_db");
  });

  it("builds DATABASE_URL from split MYSQL settings", () => {
    expect(
      resolveDatabaseUrl({
        MYSQL_ADDRESS: "10.33.112.29:3306",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "ye8vS2f8",
        MYSQL_DATABASE: "cpa_checkin"
      })
    ).toBe("mysql://root:ye8vS2f8@10.33.112.29:3306/cpa_checkin");
  });

  it("returns undefined when split MYSQL settings are incomplete", () => {
    expect(
      resolveDatabaseUrl({
        MYSQL_ADDRESS: "10.33.112.29:3306",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "ye8vS2f8"
      })
    ).toBeUndefined();
  });
});
