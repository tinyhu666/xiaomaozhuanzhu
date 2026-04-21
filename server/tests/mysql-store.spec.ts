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
});
