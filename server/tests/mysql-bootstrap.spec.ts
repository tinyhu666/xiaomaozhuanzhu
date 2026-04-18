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
});
