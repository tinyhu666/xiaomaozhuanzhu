import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserProfile } from "../types/models";

const apiMocks = vi.hoisted(() => ({
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
  handleChooseAvatar(event: { detail: { avatarUrl: string } }): void;
  handleNicknameInput(event: { detail: { value: string } }): void;
  submitWechatLogin(): Promise<void>;
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

describe("profile page official WeChat login flow", () => {
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

  it("shows the login form for incomplete profiles without loading dashboard analytics", async () => {
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

    expect(page.data.needsProfile).toBe(true);
    expect(page.data.nicknameDraft).toBe("");
    expect(page.data.avatarDraftUrl).toBe("");
    expect(page.data.canSubmitLogin).toBe(false);
  });

  it("submits nickname and avatar through the official login helper and continues the pending start flow", async () => {
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

    const definition = await loadProfilePageDefinition();
    const page = instantiatePage(definition);

    page.handleChooseAvatar({
      detail: {
        avatarUrl: "/tmp/wechat-avatar.png"
      }
    });
    page.handleNicknameInput({
      detail: {
        value: "微信昵称"
      }
    });

    await page.submitWechatLogin();
    vi.runAllTimers();

    expect(authMocks.authorizeWechatProfile).toHaveBeenCalledWith({
      avatarUrl: "/tmp/wechat-avatar.png",
      nickname: "微信昵称"
    });
    expect(apiMocks.startSession).toHaveBeenCalledTimes(1);
    expect(wx.switchTab).toHaveBeenCalledWith({
      url: "/pages/home/index"
    });
  });

  it("prevents submission until both nickname and avatar are ready", async () => {
    const definition = await loadProfilePageDefinition();
    const page = instantiatePage(definition);

    page.handleNicknameInput({
      detail: {
        value: "只有昵称"
      }
    });

    await page.submitWechatLogin();

    expect(authMocks.authorizeWechatProfile).not.toHaveBeenCalled();
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "请先选择微信头像并填写昵称",
      icon: "none"
    });
  });
});
