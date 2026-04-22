import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { fromMySqlDateTime, toMySqlDateTime } from "../src/store/mysql-date";
import { MySQLStore } from "../src/store/mysql-store";

describe("mysql-date", () => {
  it("converts ISO timestamps into MySQL DATETIME strings", () => {
    expect(toMySqlDateTime("2026-04-21T14:36:37.123Z")).toBe("2026-04-21 14:36:37.123");
  });

  it("converts MySQL DATETIME strings back into ISO timestamps", () => {
    expect(fromMySqlDateTime("2026-04-21 14:36:37.123")).toBe("2026-04-21T14:36:37.123Z");
  });
});

describe("MySQLStore", () => {
  it("formats user timestamps before inserting into MySQL", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: "user-1",
              openid: "openid-1",
              nickname: "",
              avatar_url: "",
              profile_completed: 0,
              created_at: "2026-04-21 14:36:37.123",
              last_login_at: "2026-04-21 14:36:37.123"
            }
          ]
        ])
        .mockResolvedValueOnce([
          [
            {
              user_id: "user-1",
              share_slug: "slug-1",
              is_public: 0,
              require_wechat_auth: 1
            }
          ]
        ]),
      execute: vi.fn().mockResolvedValue([[], []])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    await store.ensureUser("openid-1", "2026-04-21T14:36:37.123Z");

    const firstInsertArgs = vi.mocked(pool.execute).mock.calls[0]?.[1] as unknown[];
    expect(firstInsertArgs[2]).toBe("2026-04-21 14:36:37.123");
    expect(firstInsertArgs[3]).toBe("2026-04-21 14:36:37.123");
    expect(String(vi.mocked(pool.execute).mock.calls[0]?.[0])).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("reuses the same user row when multiple requests hit the same openid", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: "existing-user",
              openid: "openid-1",
              nickname: "",
              avatar_url: "",
              profile_completed: 0,
              created_at: "2026-04-21 14:36:37.123",
              last_login_at: "2026-04-21 14:36:37.123"
            }
          ]
        ])
        .mockResolvedValueOnce([
          [
            {
              user_id: "existing-user",
              share_slug: "stable-slug",
              is_public: 0,
              require_wechat_auth: 1
            }
          ]
        ]),
      execute: vi.fn().mockResolvedValue([[], []])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const result = await store.ensureUser("openid-1", "2026-04-21T14:36:37.123Z");

    expect(result.user.id).toBe("existing-user");
    expect(result.publicProfile.shareSlug).toBe("stable-slug");
  });

  it("converts MySQL DATETIME strings back to ISO when hydrating sessions", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue([
        [
          {
            id: "session-1",
            user_id: "user-1",
            status: "running",
            started_at: "2026-04-21 14:36:37.123",
            ended_at: null,
            current_pause_started_at: null,
            pause_segments_json: "[]",
            duration_minutes: 0,
            summary: "",
            subject: null,
            subjects_json: "[]",
            tags_json: "[]",
            created_at: "2026-04-21 14:36:37.123",
            updated_at: "2026-04-21 14:36:37.123"
          }
        ]
      ])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const session = await store.getSession("session-1");

    expect(session).toMatchObject({
      startedAt: "2026-04-21T14:36:37.123Z",
      createdAt: "2026-04-21T14:36:37.123Z",
      updatedAt: "2026-04-21T14:36:37.123Z"
    });
  });

  it("falls back to empty arrays when historical session JSON fields are malformed", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue([
        [
          {
            id: "session-bad-json",
            user_id: "user-1",
            status: "completed",
            started_at: "2026-04-21 14:36:37.123",
            ended_at: "2026-04-21 15:06:37.123",
            current_pause_started_at: null,
            pause_segments_json: "",
            duration_minutes: 30,
            summary: "done",
            subject: "审计",
            subjects_json: "[",
            tags_json: "[",
            created_at: "2026-04-21 14:36:37.123",
            updated_at: "2026-04-21 15:06:37.123"
          }
        ]
      ])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const session = await store.getSession("session-bad-json");

    expect(session).toMatchObject({
      pauseSegments: [],
      subjects: ["审计"],
      tags: []
    });
  });

  it("accepts arrays returned directly from MySQL JSON columns", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue([
        [
          {
            id: "session-native-json",
            user_id: "user-1",
            status: "completed",
            started_at: "2026-04-21 14:36:37.123",
            ended_at: "2026-04-21 15:06:37.123",
            current_pause_started_at: null,
            pause_segments_json: [{ startedAt: "2026-04-21T14:50:00.000Z", endedAt: "2026-04-21T14:55:00.000Z" }],
            duration_minutes: 25,
            summary: "native",
            subject: "审计",
            subjects_json: ["审计", "税法"],
            tags_json: ["chapter-1", "notes"],
            created_at: "2026-04-21 14:36:37.123",
            updated_at: "2026-04-21 15:06:37.123"
          }
        ]
      ])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const session = await store.getSession("session-native-json");

    expect(session).toMatchObject({
      pauseSegments: [{ startedAt: "2026-04-21T14:50:00.000Z", endedAt: "2026-04-21T14:55:00.000Z" }],
      subjects: ["审计", "税法"],
      tags: ["chapter-1", "notes"]
    });
  });

  it("stores the first subject in the legacy column and the full list in subjects_json", async () => {
    const pool = {
      execute: vi.fn().mockResolvedValue([[], []])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    await store.saveSession({
      id: "session-save",
      userId: "user-1",
      status: "completed",
      startedAt: "2026-04-21T14:36:37.123Z",
      endedAt: "2026-04-21T15:06:37.123Z",
      currentPauseStartedAt: null,
      pauseSegments: [],
      durationMinutes: 30,
      summary: "复盘完成",
      subjects: ["审计", "税法"],
      tags: ["复习"],
      createdAt: "2026-04-21T14:36:37.123Z",
      updatedAt: "2026-04-21T15:06:37.123Z"
    });

    const executeArgs = vi.mocked(pool.execute).mock.calls[0]?.[1] as unknown[];
    expect(executeArgs[9]).toBe("审计");
    expect(executeArgs[10]).toBe("[\"审计\",\"税法\"]");
    expect(executeArgs[11]).toBe("[\"复习\"]");
  });

  it("normalizes DATE rows from MySQL into YYYY-MM-DD strings", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue([
        [
          {
            user_id: "user-1",
            stat_date: new Date("2026-04-21T00:00:00.000Z"),
            total_minutes: 50,
            session_count: 1,
            heat_level: 1,
            streak_snapshot: 2,
            updated_at: "2026-04-21 15:06:37.123"
          }
        ]
      ])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const stats = await store.getDailyStats("user-1");

    expect([...stats.keys()]).toEqual(["2026-04-21"]);
    expect(stats.get("2026-04-21")).toMatchObject({
      date: "2026-04-21",
      totalMinutes: 50
    });
  });

  it("normalizes quote DATE rows from MySQL into YYYY-MM-DD strings", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              user_id: "user-1",
              quote_date: new Date("2026-04-21T00:00:00.000Z"),
              slot: 1,
              quote_id: "quote-1",
              created_at: "2026-04-21 15:06:37.123"
            }
          ]
        ])
        .mockResolvedValueOnce([
          [
            {
              user_id: "user-1",
              quote_date: new Date("2026-04-21T00:00:00.000Z"),
              visit_count: 3,
              created_at: "2026-04-21 15:06:37.123",
              updated_at: "2026-04-21 15:16:37.123"
            }
          ]
        ])
    } as unknown as Pool;
    const store = new MySQLStore(pool);

    const quotes = await store.getUserDailyQuotes("user-1", "2026-04-21");
    const state = await store.getUserDailyQuoteState("user-1", "2026-04-21");

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.quoteDate).toBe("2026-04-21");
    expect(state?.quoteDate).toBe("2026-04-21");
    expect(state?.visitCount).toBe(3);
  });
});
