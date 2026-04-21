import { beforeEach, describe, expect, it, vi } from "vitest";

describe("miniprogram api helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("batches temp-url requests in groups of 30 and merges the response", async () => {
    const init = vi.fn();
    const callContainer = vi.fn(async ({ data }: { data: { objectKeys: string[] } }) => ({
      data: {
        items: data.objectKeys.map((objectKey) => ({
          objectKey,
          url: `https://example.com/${objectKey}`,
          expiresAt: "2026-04-21T12:00:00.000Z"
        }))
      }
    }));

    vi.stubGlobal("wx", {
      cloud: {
        init,
        callContainer
      }
    });

    const { getTempUrls } = await import("../utils/api");
    const objectKeys = Array.from({ length: 61 }, (_item, index) => `checkins/${index}.jpg`);

    const response = await getTempUrls(objectKeys);

    expect(init).toHaveBeenCalledTimes(1);
    expect(callContainer).toHaveBeenCalledTimes(3);
    expect(callContainer.mock.calls.map(([payload]) => payload.data.objectKeys.length)).toEqual([30, 30, 1]);
    expect(response.items).toHaveLength(61);
    expect(response.items.at(0)).toEqual({
      objectKey: "checkins/0.jpg",
      url: "https://example.com/checkins/0.jpg",
      expiresAt: "2026-04-21T12:00:00.000Z"
    });
    expect(response.items.at(-1)?.objectKey).toBe("checkins/60.jpg");
  });
});
