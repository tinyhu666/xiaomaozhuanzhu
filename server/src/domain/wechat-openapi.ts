/**
 * WeChat miniprogram OpenAPI client — minimal surface for v0.20:
 *   - getAccessToken (cached, refreshed shortly before expiry)
 *   - sendSubscribeMessage (一次性订阅消息)
 *
 * Auth model
 * ==========
 * The miniprogram backend authenticates to WeChat using
 *   grant_type=client_credential
 *   appid=$WECHAT_APPID
 *   secret=$WECHAT_APP_SECRET
 * The returned token is good for `expires_in` seconds (commonly
 * 7200). We cache in-process and refresh ~5 minutes before expiry
 * so a 20:30 dispatch never blocks on a slow auth round-trip.
 *
 * Why no external dep
 * ===================
 * We're on Node 18+ (fetch is global). One file, zero deps; easier
 * to reason about than dragging in a WeChat SDK that doesn't ship
 * types we'd trust.
 */

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const SEND_URL =
  "https://api.weixin.qq.com/cgi-bin/message/subscribe/send";
// v0.39 — wx.login code → openid exchange. Uses appid+secret directly
// (no access_token), so it works the moment the server has credentials.
const JSCODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

export type Code2SessionResult = { openid: string; sessionKey: string };

export type SubscribeMessageData = Record<string, { value: string }>;

export type SubscribeMessagePayload = {
  touser: string;
  template_id: string;
  page?: string;
  miniprogram_state?: "developer" | "trial" | "formal";
  lang?: "zh_CN" | "en_US" | "zh_HK" | "zh_TW";
  data: SubscribeMessageData;
};

export type WeChatAPIClientOptions = {
  appId: string;
  appSecret: string;
  /** Override the token cache (testing seam). */
  now?: () => number;
  /** Override the HTTP fetcher (testing seam). */
  fetcher?: typeof fetch;
};

type CachedToken = {
  token: string;
  /** ms-since-epoch when the token must be refreshed. */
  refreshAfter: number;
};

/**
 * Common WeChat send-message return codes we surface specially:
 *  43101: 用户拒绝接收消息 — user revoked subscription; we should
 *         consume the credit silently (it's "gone") and stop
 *         retrying. The cron treats it as a one-shot failure.
 *  40001: invalid credential — token expired; we force-refresh once.
 *  41028 / 41029 / 41030: form_id / template_id / page issue —
 *         configuration error, must be fixed by ops.
 */
export type SendResult =
  | { ok: true }
  | { ok: false; code: number; message: string; revoked?: boolean };

export class WeChatAPIClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private cached: CachedToken | null = null;
  /** Coalesce concurrent fetch-token calls into one round-trip. */
  private inflightTokenFetch: Promise<string> | null = null;

  constructor(opts: WeChatAPIClientOptions) {
    this.appId = opts.appId;
    this.appSecret = opts.appSecret;
    this.now = opts.now ?? (() => Date.now());
    this.fetcher = opts.fetcher ?? fetch.bind(globalThis);
  }

  /**
   * Force-clear the cache. The send path calls this when WeChat
   * returns 40001 (invalid credential) so the *next* attempt fetches
   * a fresh token instead of reusing the expired one.
   */
  invalidateToken() {
    this.cached = null;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAfter) {
      return this.cached.token;
    }
    if (this.inflightTokenFetch) return this.inflightTokenFetch;
    this.inflightTokenFetch = this.fetchToken();
    try {
      return await this.inflightTokenFetch;
    } finally {
      this.inflightTokenFetch = null;
    }
  }

  private async fetchToken(): Promise<string> {
    const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    const response = await this.fetcher(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`wechat token http ${response.status}`);
    }
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!body.access_token || typeof body.expires_in !== "number") {
      throw new Error(`wechat token error ${body.errcode ?? "?"}: ${body.errmsg ?? "no access_token"}`);
    }
    // Refresh 5 minutes before the documented expiry so we don't
    // race the WeChat side. 600s minimum guards against weird tiny
    // expirations from a misconfigured server.
    const ttlMs = Math.max(600, body.expires_in - 300) * 1000;
    this.cached = {
      token: body.access_token,
      refreshAfter: this.now() + ttlMs
    };
    return body.access_token;
  }

  /**
   * v0.39 — Exchange a wx.login() code for the user's openid. Used by
   * the VPS auth flow (云托管 used to inject openid; a plain server must
   * do this round-trip itself). Throws on any WeChat error so the
   * /api/auth/login handler can surface a clean failure.
   */
  async code2session(jsCode: string): Promise<Code2SessionResult> {
    const url =
      `${JSCODE2SESSION_URL}?appid=${encodeURIComponent(this.appId)}` +
      `&secret=${encodeURIComponent(this.appSecret)}` +
      `&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`;
    const response = await this.fetcher(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`wechat code2session http ${response.status}`);
    }
    const body = (await response.json()) as {
      openid?: string;
      session_key?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!body.openid) {
      throw new Error(`wechat code2session error ${body.errcode ?? "?"}: ${body.errmsg ?? "no openid"}`);
    }
    return { openid: body.openid, sessionKey: body.session_key ?? "" };
  }

  /**
   * Send a single 一次性订阅消息. Returns {ok:true} on success,
   * {ok:false,...} for any non-zero errcode (incl. user-revoked).
   * Throws only for hard network / parse errors so the caller can
   * decide between "retry next tick" vs "log + skip".
   */
  async sendSubscribeMessage(payload: SubscribeMessagePayload): Promise<SendResult> {
    let token = await this.getAccessToken();
    let result = await this.attemptSend(token, payload);
    // Token-expired auto-retry: invalidate cache and try once more.
    if (!result.ok && result.code === 40001) {
      this.invalidateToken();
      token = await this.getAccessToken();
      result = await this.attemptSend(token, payload);
    }
    return result;
  }

  private async attemptSend(
    token: string,
    payload: SubscribeMessagePayload
  ): Promise<SendResult> {
    const response = await this.fetcher(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.status,
        message: `http ${response.status}`
      };
    }
    const body = (await response.json()) as { errcode?: number; errmsg?: string };
    const code = body.errcode ?? 0;
    if (code === 0) return { ok: true };
    return {
      ok: false,
      code,
      message: body.errmsg ?? "wechat error",
      revoked: code === 43101
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Message-payload helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Format a Date (or ISO string) as a WeChat-template "date2.DATA"
 * value, in Shanghai timezone: "2026 年 5 月 17 日".
 */
export function formatReminderDate(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()} 年 ${shifted.getUTCMonth() + 1} 月 ${shifted.getUTCDate()} 日`;
}

/**
 * Build the data block for our 学习提醒 template. The four field
 * keys are fixed by the approved template — see docs/roadmap.md
 * v0.20 entry for the source.
 *
 * Field constraints (from WeChat docs):
 *   thing:  ≤ 20 中文字符
 *   time:   HH:mm or HH:mm:ss
 *   date:   yyyy 年 M 月 d 日 (or yyyy-MM-dd)
 */
export function buildReminderData(input: {
  /** Shanghai-local "today" Date for the date2 field. */
  reminderDate: Date | string;
  /** Free text for the main reminder line, ≤ 20 chars. */
  reminderTitle: string;
  /** HH:mm string for the time15 field, e.g. "20:30". */
  reminderTime: string;
  /** Free text for the note line, ≤ 20 chars. */
  reminderNote: string;
}): SubscribeMessageData {
  return {
    date2: { value: formatReminderDate(input.reminderDate) },
    thing3: { value: capTo20(input.reminderTitle) },
    time15: { value: input.reminderTime },
    thing9: { value: capTo20(input.reminderNote) }
  };
}

/** Trim & cap text to 20 chars (WeChat "thing" type max length). */
function capTo20(value: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 20 ? trimmed.slice(0, 20) : trimmed;
}
