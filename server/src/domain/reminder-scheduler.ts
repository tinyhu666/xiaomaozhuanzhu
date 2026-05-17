/**
 * Daily 20:30 reminder dispatcher.
 *
 * Why an in-process loop (and not a real cron)
 * ============================================
 * 微信云托管 runs a Node container; the cheapest reliable scheduler
 * is a one-minute setInterval inside the same process. We tolerate
 * one missed minute on container restart — the dispatch window is
 * 20:30–20:31 Shanghai, so even a 30-second hiccup is recoverable.
 * If we ever scale to N replicas we'll need a distributed lock; for
 * now WeChat 云托管 keeps a single instance unless we ask otherwise.
 *
 * Idempotency
 * ===========
 * We dispatch once per user per Shanghai-local day. Each user row
 * carries `reminder_last_sent_at`; the cron skips anyone whose last
 * send is already in today's Shanghai bucket. So even if setInterval
 * misfires twice in the same minute, no user gets two messages.
 */

import { formatShanghaiDate } from "./date-utils";
import { getExamSchedule } from "./exam-dates";
import {
  buildReminderData,
  type WeChatAPIClient
} from "./wechat-openapi";
import type { DataStore } from "../store/types";
import type { User } from "../types";

/**
 * Static dispatch window in Shanghai local time. We fire when the
 * minute equals 20:30; the setInterval checks every 60s so the window
 * is effectively 20:30:00 → 20:30:59.
 */
const DISPATCH_HOUR = 20;
const DISPATCH_MINUTE = 30;

const TEMPLATE_ID = process.env.REMINDER_TEMPLATE_ID || "d9nbGAGrvb8EJ_IocuKskOhrvK-EtH9_UIjtWLlVPt8";
const TARGET_PAGE = process.env.REMINDER_TARGET_PAGE_PATH || "pages/home/index";
const MINI_STATE: "developer" | "trial" | "formal" =
  (process.env.REMINDER_MINIPROGRAM_STATE as "developer" | "trial" | "formal") || "formal";

export type SchedulerOptions = {
  store: DataStore;
  apiClient: WeChatAPIClient;
  /** Test seam — defaults to process.uptime-based clock. */
  now?: () => Date;
  /** Test seam — return today's Shanghai day key for `now`. */
  shanghaiToday?: (now: Date) => string;
  /** Hook for log lines so the test can assert without console noise. */
  logger?: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
};

export class ReminderScheduler {
  private readonly store: DataStore;
  private readonly apiClient: WeChatAPIClient;
  private readonly now: () => Date;
  private readonly shanghaiToday: (now: Date) => string;
  private readonly logger: NonNullable<SchedulerOptions["logger"]>;
  private timer: NodeJS.Timeout | null = null;
  /** When we last attempted a dispatch — used to avoid double-fire
   *  within the same Shanghai-day. We still defer to the DB column
   *  for per-user idempotency, but this fast-path skips the whole
   *  loop the second time it fires in the same minute. */
  private lastTickDay: string | null = null;

  constructor(opts: SchedulerOptions) {
    this.store = opts.store;
    this.apiClient = opts.apiClient;
    this.now = opts.now ?? (() => new Date());
    this.shanghaiToday = opts.shanghaiToday ?? defaultShanghaiToday;
    this.logger = opts.logger ?? defaultLogger;
  }

  start() {
    if (this.timer) return;
    // Tick every 60s. We could be smarter (sleep until 20:30) but
    // 60s ticks add negligible CPU and survive clock skew gracefully.
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger("error", "[reminder] tick failed", err);
      });
    }, 60 * 1000);
    // Kick once on start so a 20:30:30 deploy doesn't wait a minute.
    setImmediate(() => {
      this.tick().catch((err) => {
        this.logger("error", "[reminder] initial tick failed", err);
      });
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Single tick — invoked once per minute. Public for tests so they
   * can drive the scheduler deterministically without setInterval.
   */
  async tick(): Promise<void> {
    const now = this.now();
    const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
    const shHour = shifted.getUTCHours();
    const shMinute = shifted.getUTCMinutes();
    if (shHour !== DISPATCH_HOUR || shMinute !== DISPATCH_MINUTE) {
      return;
    }
    const todayKey = this.shanghaiToday(now);
    if (this.lastTickDay === todayKey) {
      // We already ran today; subsequent ticks within the same minute
      // are no-ops at the process level.
      return;
    }
    this.lastTickDay = todayKey;

    const recipients = await this.store.listReminderRecipients();
    if (!recipients.length) {
      this.logger("info", "[reminder] no recipients eligible");
      return;
    }
    this.logger("info", `[reminder] dispatching to ${recipients.length} users`);
    for (const user of recipients) {
      // Per-user idempotency: skip if last send falls in today's bucket.
      if (user.reminderLastSentAt) {
        const sentKey = this.shanghaiToday(new Date(user.reminderLastSentAt));
        if (sentKey === todayKey) continue;
      }
      await this.dispatchOne(user, now);
    }
  }

  private async dispatchOne(user: User, now: Date) {
    if (!user.openid) return;
    const data = buildReminderData({
      reminderDate: now,
      reminderTitle: "今晚的专注时间到啦",
      reminderTime: `${String(DISPATCH_HOUR).padStart(2, "0")}:${String(DISPATCH_MINUTE).padStart(2, "0")}`,
      reminderNote: buildExamCountdownNote(now)
    });
    try {
      const result = await this.apiClient.sendSubscribeMessage({
        touser: user.openid,
        template_id: TEMPLATE_ID,
        page: TARGET_PAGE,
        miniprogram_state: MINI_STATE,
        lang: "zh_CN",
        data
      });
      if (result.ok) {
        await this.store.recordReminderDispatch(user.id, now.toISOString());
      } else {
        const errMsg = `wechat ${result.code}: ${result.message}`;
        this.logger("warn", `[reminder] send failed for user ${user.id}`, errMsg);
        // For "user revoked subscription" we still consume the credit
        // (it's effectively used and won't re-grant). For everything
        // else we record the error and leave the credit for retry.
        if (result.revoked) {
          await this.store.recordReminderDispatch(user.id, now.toISOString());
        } else {
          await this.store.recordReminderDispatch(user.id, now.toISOString(), errMsg);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger("error", `[reminder] dispatch threw for ${user.id}`, errMsg);
      try {
        await this.store.recordReminderDispatch(user.id, now.toISOString(), errMsg);
      } catch {
        /* swallow — last-ditch logging only */
      }
    }
  }
}

function defaultShanghaiToday(now: Date): string {
  return formatShanghaiDate(now);
}

/**
 * Build the "备注" line for the reminder, baking in the days-to-next-
 * CPA-exam countdown. Six subjects each have their own exam day; the
 * "next exam" is the nearest one in the future. Returns a string
 * within the WeChat thing (≤ 20 中文字符) limit.
 *
 * Edge cases:
 *  - schedule empty / all invalid → keep the original generic line
 *  - days === 0 (exam day) → urgency message instead of countdown
 *  - days < 0 (shouldn't happen — exam-dates rolls forward) → generic
 */
export function buildExamCountdownNote(now: Date): string {
  const schedule = getExamSchedule(now);
  if (!schedule.length) return "打开小程序开始今晚的专注";
  const upcoming = schedule
    .map((s) => s.daysRemaining)
    .filter((d) => Number.isFinite(d) && d > 0);
  if (upcoming.length === 0) {
    const anyToday = schedule.some((s) => s.daysRemaining === 0);
    return anyToday ? "今天就是考试日，加油！" : "打开小程序开始今晚的专注";
  }
  const days = Math.min(...upcoming);
  return `距考试还有 ${days} 天，加油！`;
}

function defaultLogger(level: "info" | "warn" | "error", msg: string, meta?: unknown) {
  if (level === "error") {
    console.error(msg, meta);
  } else if (level === "warn") {
    console.warn(msg, meta);
  } else {
    console.log(msg, meta ?? "");
  }
}
