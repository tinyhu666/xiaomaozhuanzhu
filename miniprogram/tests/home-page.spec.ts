import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeQuote, HomeResponse, UserProfile } from "../types/models";

const apiMocks = vi.hoisted(() => ({
  getCalendar: vi.fn(),
  getHome: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  startSession: vi.fn()
}));

const appMock = vi.hoisted(() => ({
  globalData: {
    profile: null as UserProfile | null,
    bootstrapped: true,
    needsProfile: false,
    pendingProfileAction: null as "startSession" | null
  },
  bootstrapProfileState: vi.fn(),
  queuePendingProfileAction: vi.fn(),
  consumePendingProfileAction: vi.fn()
}));

vi.mock("../utils/api", () => apiMocks);

type HomePageDefinition = {
  data: Record<string, unknown>;
  onShow(): Promise<void>;
  onPullDownRefresh(): Promise<void>;
  handleStart(): Promise<void>;
  [key: string]: unknown;
};

type HomePageInstance = HomePageDefinition & {
  route: string;
  data: Record<string, unknown>;
  getTabBar?: () => { setData: (payload: Record<string, unknown>) => void };
  setData(update: Record<string, unknown>): void;
};

function createProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    nickname: "Mini User",
    avatarUrl: "https://example.com/avatar.png",
    profileCompleted: true,
    shareSlug: "slug-1",
    isPublic: false,
    requireWechatAuth: true,
    ...overrides
  };
}

function createQuote(overrides: Partial<HomeQuote> = {}): HomeQuote {
  return {
    id: "quote-1",
    en: "Stay with the work.",
    zh: "稳住，继续做题。",
    author: "Seed",
    topic: "discipline",
    dailyIndex: 1,
    dailyLimit: 5,
    ...overrides
  };
}

function createHomeResponse(overrides: Partial<HomeResponse> = {}): HomeResponse {
  return {
    profile: createProfile(),
    activeSession: null,
    quote: createQuote(),
    today: {
      userId: "user-1",
      date: "2026-04-21",
      totalMinutes: 0,
      sessionCount: 0,
      heatLevel: 0,
      streakDays: 0,
      updatedAt: "2026-04-21T10:00:00.000Z"
    },
    summary: {
      totalMinutes: 0,
      currentStreakDays: 0,
      lastSummary: ""
    },
    ...overrides
  };
}

function instantiatePage(definition: HomePageDefinition) {
  return {
    ...definition,
    route: "pages/home/index",
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }
  } as HomePageInstance;
}

async function loadHomePageDefinition() {
  let captured: HomePageDefinition | undefined;
  vi.stubGlobal("Page", (options: HomePageDefinition) => {
    captured = options;
    return options;
  });

  await import("../pages/home/index");

  if (!captured) {
    throw new Error("Home page definition was not registered");
  }

  return captured;
}

describe("home page session actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-04-21T10:00:00+08:00"));

    appMock.globalData.profile = createProfile();
    appMock.globalData.needsProfile = false;
    appMock.globalData.pendingProfileAction = null;

    vi.stubGlobal("getApp", () => appMock);
    vi.stubGlobal("wx", {
      showToast: vi.fn(),
      navigateTo: vi.fn(),
      stopPullDownRefresh: vi.fn(),
      switchTab: vi.fn()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the timer card in sync after start even when the calendar request fails", async () => {
    const activeSession = {
      id: "session-1",
      status: "running" as const,
      startedAt: "2026-04-21T09:30:00.000Z",
      currentPauseStartedAt: null,
      pauseSegments: [],
      effectiveMinutes: 30
    };

    apiMocks.startSession.mockResolvedValue({
      session: activeSession,
      reused: false
    });
    apiMocks.getHome.mockResolvedValue(
      createHomeResponse({
        activeSession,
        quote: createQuote({
          en: "Server quote",
          zh: "服务端语录"
        }),
        today: {
          userId: "user-1",
          date: "2026-04-21",
          totalMinutes: 30,
          sessionCount: 1,
          heatLevel: 1,
          streakDays: 2,
          updatedAt: "2026-04-21T10:00:00.000Z"
        },
        summary: {
          totalMinutes: 180,
          currentStreakDays: 2,
          lastSummary: "Yesterday was solid."
        }
      })
    );
    apiMocks.getCalendar.mockRejectedValue(new Error("Calendar unavailable"));

    const definition = await loadHomePageDefinition();
    const page = instantiatePage(definition);

    await page.handleStart();

    expect(apiMocks.startSession).toHaveBeenCalledTimes(1);
    expect(apiMocks.getHome).toHaveBeenCalledWith("peek");
    expect(page.data.activeSession).toMatchObject({
      id: "session-1",
      status: "running"
    });
    expect(page.data.actions).toEqual(["pause", "complete"]);
    expect(page.data.todayMinutesText).toBe("30m");
    expect(page.data.quoteEn).toBe("Server quote");
    expect(page.data.quoteZh).toBe("服务端语录");
    expect(page.data.actionLoading).toBe(false);
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "Calendar unavailable",
      icon: "none"
    });
  });

  it("routes incomplete profiles to the profile tab before starting a session", async () => {
    appMock.globalData.profile = createProfile({ profileCompleted: false });
    appMock.globalData.needsProfile = true;

    const definition = await loadHomePageDefinition();
    const page = instantiatePage(definition);

    await page.handleStart();

    expect(appMock.queuePendingProfileAction).toHaveBeenCalledWith("startSession");
    expect(apiMocks.startSession).not.toHaveBeenCalled();
    expect(wx.switchTab).toHaveBeenCalledWith({
      url: "/pages/profile/index"
    });
  });

  it("advances the quote on page show and peeks on pull-down refresh", async () => {
    apiMocks.getHome.mockResolvedValue(createHomeResponse());
    apiMocks.getCalendar.mockResolvedValue({
      month: "2026-04",
      days: {}
    });

    const definition = await loadHomePageDefinition();
    const page = instantiatePage(definition);
    page.getTabBar = () => ({
      setData: vi.fn()
    });

    await page.onShow();
    await page.onPullDownRefresh();

    expect(apiMocks.getHome.mock.calls.map(([event]) => event)).toEqual(["advance", "peek"]);
    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
});
