import { describe, expect, it } from "vitest";

import { buildBootstrapPlan, parseMysqlAddress } from "../src/mysql-bootstrap";

describe("parseMysqlAddress", () => {
  it("parses host and port from MYSQL_ADDRESS", () => {
    expect(parseMysqlAddress("10.33.112.29:3306")).toEqual({
      host: "10.33.112.29",
      port: 3306
    });
  });

  it("uses the default MySQL port when the port is omitted", () => {
    expect(parseMysqlAddress("10.33.112.29")).toEqual({
      host: "10.33.112.29",
      port: 3306
    });
  });

  it("returns null when MYSQL_ADDRESS is missing", () => {
    expect(parseMysqlAddress("")).toBeNull();
  });
});

describe("buildBootstrapPlan", () => {
  it("builds the SQL bootstrap plan from split MYSQL settings", () => {
    expect(
      buildBootstrapPlan({
        MYSQL_ADDRESS: "10.33.112.29:3306",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "ye8vS2f8",
        MYSQL_DATABASE: "cpa_checkin"
      })
    ).toMatchObject({
      adminConfig: {
        host: "10.33.112.29",
        port: 3306,
        user: "root",
        password: "ye8vS2f8"
      },
      databaseName: "cpa_checkin"
    });
  });

  it("returns null when split MYSQL settings are incomplete", () => {
    expect(
      buildBootstrapPlan({
        MYSQL_ADDRESS: "10.33.112.29:3306",
        MYSQL_USERNAME: "root"
      })
    ).toBeNull();
  });

  // Regression: the VPS deploy sets a single DATABASE_URL (not the discrete
  // MYSQL_* vars). Bootstrap must parse it, else it skips schema creation
  // while the store connects to a table-less DB → ER_NO_SUCH_TABLE.
  it("falls back to DATABASE_URL when discrete MYSQL_* vars are absent", () => {
    expect(buildBootstrapPlan({ DATABASE_URL: "mysql://cpa:abc123@127.0.0.1:3306/cpa" })).toMatchObject({
      adminConfig: { host: "127.0.0.1", port: 3306, user: "cpa", password: "abc123" },
      databaseName: "cpa"
    });
  });

  it("defaults the port to 3306 and URL-decodes credentials from DATABASE_URL", () => {
    expect(
      buildBootstrapPlan({ DATABASE_URL: "mysql://u%40s:p%2Fw@db.example.com/my_db" })
    ).toMatchObject({
      adminConfig: { host: "db.example.com", port: 3306, user: "u@s", password: "p/w" },
      databaseName: "my_db"
    });
  });

  it("prefers discrete MYSQL_* over DATABASE_URL when both are present", () => {
    expect(
      buildBootstrapPlan({
        MYSQL_ADDRESS: "10.0.0.9:3307",
        MYSQL_USERNAME: "root",
        MYSQL_PASSWORD: "pw",
        MYSQL_DATABASE: "cpa_checkin",
        DATABASE_URL: "mysql://cpa:abc@127.0.0.1:3306/other"
      })
    ).toMatchObject({
      adminConfig: { host: "10.0.0.9", port: 3307, user: "root", password: "pw" },
      databaseName: "cpa_checkin"
    });
  });
});
