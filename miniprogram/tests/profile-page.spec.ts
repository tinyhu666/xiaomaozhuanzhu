import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileDashboardResponse, UserProfile } from "../types/models";

const apiMocks = vi.hoisted(() => ({
  getProfileDashboard: vi.fn(),
  startSession: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  authorizeWechatProfile: vi.fn()
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

vi.mock("../utils/api", async () => {
  const actual = await vi.importActual("../utils/api");
  return {
    ...actual,
    getProfileDashboard: apiMocks.getProfileDashboard,
    startSession: apiMocks.startSession
  };
});

vi.mock("../utils/profile-auth", () => authMocks);

type ProfilePageDefinition = {
  data: Record<string, unknown>;
  [key: string]: unknown;
};

type ProfilePageInstance = ProfilePageDefinition & {
  route: string;
  setData(update: Record<string, unknown>): void;
  onShow(): Promise<void>;
  authorizeProfile(): Promise<void>;
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

function createDashboard(overrides: Partial<ProfileDashboardResponse> = {}): ProfileDashboardResponse {
  return {
    profile: createProfile(),
    summary: {
      totalMinutes: 180,
      currentStreakDays: 3
    },
    subjects: [
      {
        subject: "Accounting",
        totalMinutes: 180
      }
    ],
    bestDay: {
      date: "2026-04-20",
      totalMinutes: 120
    },
    ...overrides
  };
}

function instantiatePage(definition: ProfilePageDefinition) {
  return {
    ...definition,
    route: "pages/profile/index",
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }
  } as ProfilePageInstance;
}

async function loadProfilePageDefinition() {
  let captured: ProfilePageDefinition | undefined;
  vi.stubGlobal("Page", (options: ProfilePageDefinition) => {
    captured = options;
    return options;
  });

  await import("../pages/profile/index");

  if (!captured) {
    throw new Error("Profile page definition was not registered");
  }

  return captured;
}

describe("profile page authorization flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    appMock.globalData.profile = createProfile();
    appMock.globalData.needsProfile = false;
    appMock.globalData.pendingProfileAction = null;

    vi.stubGlobal("getApp", () => appMock);
    vi.stubGlobal("wx", {
      showToast: vi.fn(),
      switchTab: vi.fn()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows inline authorization instead of loading dashboard data for incomplete profiles", async () => {
    appMock.bootstrapProfileState.mockResolvedValue({
      profile: createProfile({
        nickname: "",
        avatarUrl: "",
        profileCompleted: false
      }),
      needsOnboarding: true,
      serverTime: "2026-04-21T10:00:00.000Z"
    });

    const definition = await loadProfilePageDefinition();
    const page = instantiatePage(definition);

    await page.onShow();

    expect(apiMocks.getProfileDashboard).not.toHaveBeenCalled();
    expect(page.data.needsProfile).toBe(true);
  });

  it("continues the pending start flow after successful profile authorization", async () => {
    appMock.globalData.pendingProfileAction = "startSession";
    appMock.consumePendingProfileAction.mockReturnValue("startSession");
    authMocks.authorizeWechatProfile.mockResolvedValue(createProfile());
    apiMocks.startSession.mockResolvedValue({
      session: {
        id: "session-1",
        status: "running"
      },
      reused: false
    });
    apiMocks.getProfileDashboard.mockResolvedValue(createDashboard());

    const definition = await loadProfilePageDefinition();
    const page = instantiatePage(definition);

    await page.authorizeProfile();
    vi.runAllTimers();

    expect(authMocks.authorizeWechatProfile).toHaveBeenCalledTimes(1);
    expect(apiMocks.startSession).toHaveBeenCalledTimes(1);
    expect(wx.switchTab).toHaveBeenCalledWith({
      url: "/pages/home/index"
    });
  });

  it("keeps the pending start action when starting the session fails after authorization", async () => {
    appMock.globalData.pendingProfileAction = "startSession";
    authMocks.authorizeWechatProfile.mockResolvedValue(createProfile());
    apiMocks.startSession.mockRejectedValue(new Error("Start failed"));
    apiMocks.getProfileDashboard.mockResolvedValue(createDashboard());

    const definition = await loadProfilePageDefinition();
    const page = instantiatePage(definition);

    await page.authorizeProfile();

    expect(authMocks.authorizeWechatProfile).toHaveBeenCalledTimes(1);
    expect(apiMocks.startSession).toHaveBeenCalledTimes(1);
    expect(appMock.consumePendingProfileAction).not.toHaveBeenCalled();
    expect(appMock.globalData.pendingProfileAction).toBe("startSession");
    expect(wx.switchTab).not.toHaveBeenCalled();
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "Start failed",
      icon: "none"
    });
  });
});
