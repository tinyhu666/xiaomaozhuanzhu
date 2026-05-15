import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Mock wx storage BEFORE importing the module — vitest module-mock
// initialization order means the wx global has to exist by the time
// utils/garden.ts is evaluated, even though we only need it for the
// milestone helpers.
const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key)
};

import {
  __resetMilestoneStorageForTests,
  buildGarden,
  consumeMilestoneEvent,
  GARDEN_MILESTONES,
  rarityLabel
} from "../utils/garden";
import type { CompletedSession } from "../utils/api";

beforeEach(() => storage.clear());
afterEach(() => storage.clear());

function session(overrides: Partial<CompletedSession> = {}): CompletedSession {
  return {
    id: "s1",
    subject: "会计",
    mode: "free",
    durationMinutes: 60,
    pomodoroCycles: 0,
    startedAt: "2026-05-10T01:00:00.000Z",
    endedAt: "2026-05-10T02:00:00.000Z",
    ...overrides
  };
}

describe("buildGarden", () => {
  it("returns an empty garden for no sessions", () => {
    const vm = buildGarden([]);
    expect(vm.cats).toEqual([]);
    expect(vm.stats.total).toBe(0);
    expect(vm.stats.byRarity.common).toBe(0);
  });

  it("maps a 60-min free session to a rare 会计 cat", () => {
    const vm = buildGarden([session()]);
    expect(vm.cats).toHaveLength(1);
    const cat = vm.cats[0];
    expect(cat.subject).toBe("会计");
    expect(cat.accessory).toBe("算盘");
    expect(cat.rarity).toBe("rare");
    expect(cat.fromPomodoro).toBe(false);
  });

  it("classifies <30 min free sessions as common", () => {
    const vm = buildGarden([session({ durationMinutes: 12 })]);
    expect(vm.cats[0].rarity).toBe("common");
  });

  it("classifies >120 min free sessions as epic", () => {
    const vm = buildGarden([session({ durationMinutes: 180 })]);
    expect(vm.cats[0].rarity).toBe("epic");
  });

  it("classifies 4-cycle pomodoro as epic regardless of duration", () => {
    const vm = buildGarden([session({ mode: "pomodoro", pomodoroCycles: 4, durationMinutes: 100 })]);
    expect(vm.cats[0].rarity).toBe("epic");
  });

  it("classifies 8-cycle pomodoro as legendary", () => {
    const vm = buildGarden([session({ mode: "pomodoro", pomodoroCycles: 8, durationMinutes: 220 })]);
    expect(vm.cats[0].rarity).toBe("legendary");
  });

  it("classifies 1-3 cycle pomodoro as rare", () => {
    const vm = buildGarden([session({ mode: "pomodoro", pomodoroCycles: 2, durationMinutes: 55 })]);
    expect(vm.cats[0].rarity).toBe("rare");
  });

  it("buckets unknown subjects into 其它", () => {
    const vm = buildGarden([session({ subject: null }), session({ id: "s2", subject: "外语" as never })]);
    expect(vm.cats.map((c) => c.subject)).toEqual(["其它", "其它"]);
    expect(vm.stats.bySubject["其它"]).toBe(2);
  });

  it("orders newest-first by endedAt", () => {
    const vm = buildGarden([
      session({ id: "old", endedAt: "2026-05-09T02:00:00.000Z" }),
      session({ id: "newer", endedAt: "2026-05-12T02:00:00.000Z" }),
      session({ id: "mid", endedAt: "2026-05-10T02:00:00.000Z" })
    ]);
    expect(vm.cats.map((c) => c.id)).toEqual(["newer", "mid", "old"]);
  });

  it("formats dateText in Shanghai timezone (YYYY.MM.DD)", () => {
    // 17:00 UTC = 01:00 next-day Shanghai. Verify the rollover.
    const vm = buildGarden([session({ endedAt: "2026-05-10T17:00:00.000Z" })]);
    expect(vm.cats[0].dateText).toBe("2026.05.11");
  });

  it("aggregates stats correctly across multiple cats", () => {
    const vm = buildGarden([
      session({ id: "a", subject: "会计", durationMinutes: 60 }),                         // rare
      session({ id: "b", subject: "审计", durationMinutes: 20 }),                         // common
      session({ id: "c", subject: "财管", mode: "pomodoro", pomodoroCycles: 8, durationMinutes: 220 }) // legendary
    ]);
    expect(vm.stats.total).toBe(3);
    expect(vm.stats.byRarity.rare).toBe(1);
    expect(vm.stats.byRarity.common).toBe(1);
    expect(vm.stats.byRarity.legendary).toBe(1);
    expect(vm.stats.bySubject["会计"]).toBe(1);
    expect(vm.stats.bySubject["审计"]).toBe(1);
    expect(vm.stats.bySubject["财管"]).toBe(1);
  });
});

describe("rarityLabel", () => {
  it("returns the Chinese label for each rarity", () => {
    expect(rarityLabel("common")).toBe("普通");
    expect(rarityLabel("rare")).toBe("稀有");
    expect(rarityLabel("epic")).toBe("史诗");
    expect(rarityLabel("legendary")).toBe("传说");
  });
});

describe("consumeMilestoneEvent", () => {
  beforeEach(() => __resetMilestoneStorageForTests());

  it("returns null when no milestone has been crossed yet", () => {
    expect(consumeMilestoneEvent(0)).toBeNull();
    expect(consumeMilestoneEvent(5)).toBeNull();
    expect(consumeMilestoneEvent(9)).toBeNull();
  });

  it("fires the 10-milestone the first time the user hits 10", () => {
    const event = consumeMilestoneEvent(10);
    expect(event).not.toBeNull();
    expect(event!.milestone).toBe(10);
    expect(event!.title).toContain("10");
  });

  it("does not refire the same milestone on the next call with the same total", () => {
    consumeMilestoneEvent(10);
    expect(consumeMilestoneEvent(10)).toBeNull();
    expect(consumeMilestoneEvent(15)).toBeNull(); // no new milestone between 10 and 30
  });

  it("fires the next milestone when crossed in a later call", () => {
    consumeMilestoneEvent(10);
    expect(consumeMilestoneEvent(29)).toBeNull();
    const event30 = consumeMilestoneEvent(30);
    expect(event30?.milestone).toBe(30);
  });

  it("jumps to the highest crossed milestone when user grows past several at once", () => {
    // Fresh user goes from 8 → 35 in one update. Should celebrate 30
    // (the "biggest deal" reached), not 10.
    const event = consumeMilestoneEvent(35);
    expect(event?.milestone).toBe(30);
    // Subsequent call at the same total → null
    expect(consumeMilestoneEvent(35)).toBeNull();
  });

  it("celebrates 50 / 100 / 200 in order", () => {
    consumeMilestoneEvent(10);
    consumeMilestoneEvent(30);
    expect(consumeMilestoneEvent(50)?.milestone).toBe(50);
    expect(consumeMilestoneEvent(75)).toBeNull();
    expect(consumeMilestoneEvent(100)?.milestone).toBe(100);
    expect(consumeMilestoneEvent(199)).toBeNull();
    expect(consumeMilestoneEvent(200)?.milestone).toBe(200);
    // No more milestones beyond 200 — even at 500 we get null.
    expect(consumeMilestoneEvent(500)).toBeNull();
  });

  it("exposes the list of milestones for reference", () => {
    expect(GARDEN_MILESTONES).toEqual([10, 30, 50, 100, 200]);
  });
});
