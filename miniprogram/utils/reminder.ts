/**
 * Client-side wrapper for the daily 20:30 reminder flow.
 *
 * The WeChat 一次性订阅消息 (one-time subscription message) gives the
 * server **one** send credit per user-accept. So we need to:
 *   1. On toggle-on: requestSubscribeMessage → server POST subscribe
 *   2. On every cold-start (if enabled): if credits < REFILL_FLOOR,
 *      silently re-request to top up. This is the standard pattern
 *      from the WeChat docs — without it, the toggle stays "on" but
 *      no messages come through after the first day.
 *
 * Why a separate util
 * ===================
 * Two callers will use this — settings page (explicit toggle) and
 * home page (silent refill on cold-start). Keeping the wx-API quirks
 * in one place means the pages stay readable.
 */

import { getReminderStatus, reminderDisable, reminderSubscribe } from "./api";

/** The approved 日程提醒 template from 公众平台. */
export const REMINDER_TEMPLATE_ID = "d9nbGAGrvb8EJ_IocuKskOhrvK-EtH9_UIjtWLlVPt8";

/**
 * Below this credit count we'll auto-request a refill on cold-start.
 * Two is the sweet spot: gives us one buffer day if the user opens
 * the app right after a 20:30 fire (we'll already be at 0 and have
 * nothing scheduled for tomorrow without a refill).
 */
const REFILL_FLOOR = 2;

/**
 * Last cold-start refill timestamp (Shanghai-local day). We only
 * refill once per day per device — the user shouldn't see the
 * authorization prompt repeatedly within a single session.
 */
const STORAGE_LAST_REFILL_DAY = "cpa.reminder.lastRefillDay";

export type SubscribeOutcome =
  | { ok: true; credits: number }
  | { ok: false; reason: "rejected" | "blocked" | "error"; message?: string };

/**
 * Trigger the native subscribe prompt + record the result with our
 * server. Returns a normalized outcome the page can render directly.
 *
 * "rejected" — user actively tapped "取消"
 * "blocked"  — the user previously picked 总是拒绝 + this template
 * "error"    — wx returned a non-success result we couldn't classify
 */
export async function requestReminderSubscribe(): Promise<SubscribeOutcome> {
  let result: WechatMiniprogram.RequestSubscribeMessageSuccessCallbackResult | null = null;
  try {
    result = await wx.requestSubscribeMessage({
      tmplIds: [REMINDER_TEMPLATE_ID]
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 20004 = user disabled subscription messages in WeChat settings.
    if (message.includes("20004") || message.includes("disabled")) {
      return { ok: false, reason: "blocked", message: "请在微信「服务通知」里允许该小程序发送订阅消息" };
    }
    return { ok: false, reason: "error", message };
  }
  const accept = result?.[REMINDER_TEMPLATE_ID];
  if (accept !== "accept") {
    return { ok: false, reason: accept === "reject" ? "rejected" : "blocked" };
  }
  try {
    const server = await reminderSubscribe(1);
    return { ok: true, credits: server.credits };
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cold-start silent refill. Called from the home page onShow. If the
 * user already enabled the reminder, has openid (otherwise we can't
 * send), and credits are low, we silently re-trigger the wx prompt
 * to keep the pipeline full. The user can still reject — that's fine,
 * we just don't refill this round.
 *
 * Refills are gated by storage to at most once per Shanghai-day, so
 * repeated home opens during the day don't pester the user.
 */
export async function maybeRefillReminderCredits(now: Date): Promise<void> {
  let status;
  try {
    status = await getReminderStatus();
  } catch {
    return;
  }
  if (!status.enabled || !status.hasOpenid) return;
  if (status.credits >= REFILL_FLOOR) return;
  const todayKey = toShanghaiDayKey(now);
  let lastDay = "";
  try {
    const raw = wx.getStorageSync(STORAGE_LAST_REFILL_DAY);
    if (typeof raw === "string") lastDay = raw;
  } catch (_) {
    /* ignore */
  }
  if (lastDay === todayKey) return;
  try {
    wx.setStorageSync(STORAGE_LAST_REFILL_DAY, todayKey);
  } catch (_) {
    /* ignore */
  }
  // Fire-and-forget — we don't surface refill outcomes; the next
  // time the user opens settings they'll see the current credit count.
  await requestReminderSubscribe().catch(() => {});
}

export async function disableReminder(): Promise<void> {
  await reminderDisable().catch(() => {});
}

function toShanghaiDayKey(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
