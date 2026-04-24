/// <reference types="miniprogram-api-typings" />

declare interface IAppOption {
  globalData: {
    profile: import("../miniprogram/types/models").UserProfile | null;
    bootstrapped: boolean;
    needsProfile: boolean;
    pendingProfileAction: "startSession" | null;
  };
  bootstrapProfileState(): Promise<{
    profile: import("../miniprogram/types/models").UserProfile;
    needsOnboarding: boolean;
    serverTime: string;
  }>;
  queuePendingProfileAction(action: "startSession" | null): void;
  consumePendingProfileAction(): "startSession" | null;
}
