/// <reference types="miniprogram-api-typings" />

declare interface IAppOption {
  globalData: {
    profile: import("../miniprogram/types/models").UserProfile | null;
    bootstrapped: boolean;
  };
  ensureProfile(): Promise<boolean>;
}
