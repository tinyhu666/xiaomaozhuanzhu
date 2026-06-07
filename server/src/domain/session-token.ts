import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * v0.39 — stateless signed session token for the VPS auth flow.
 *
 * 云托管 injected a trusted `x-wx-openid` header; a plain server can't
 * trust a client-sent openid (anyone could spoof it). So after
 * wx.login → code2session yields the real openid, we hand the client a
 * token = base64url(payload) "." base64url(HMAC-SHA256(payload, secret)).
 * The client sends it back as `Authorization: Bearer <token>`; we
 * re-verify the HMAC server-side, so the openid inside is trustworthy.
 * Stateless (no DB/session store); rotate by changing SESSION_SECRET.
 */
type SessionPayload = { o: string; t: number };

/**
 * v0.39 — token lifetime. wx.login refresh is silent (the client just
 * calls wx.login() again → new code → new token, no user interaction),
 * so we can expire aggressively without UX cost. 90 days covers a user
 * who studies daily for a full exam season but drops the app for a
 * week or two. The client (M3) should silently re-login on a 401.
 */
const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Real WeChat openids are 28-char base64url-ish strings; we accept a
 * generous band so a future format tweak doesn't lock users out, but
 * still reject whitespace / type-confusion values as defense-in-depth.
 */
const OPENID_RE = /^[A-Za-z0-9_-]{6,128}$/;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signSession(openid: string, secret: string, issuedAtMs = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ o: openid, t: issuedAtMs } satisfies SessionPayload)));
  return `${payload}.${hmac(payload, secret)}`;
}

export type VerifySessionOptions = {
  /** Reject tokens older than this many ms (default 90d). 0 disables the check. */
  maxAgeMs?: number;
  /** Injectable clock for tests (ms-since-epoch). */
  now?: number;
};

export function verifySession(
  token: string,
  secret: string,
  options: VerifySessionOptions = {}
): { openid: string } | null {
  // Empty secret ⇒ Bearer auth is disabled (云托管 mode); never verify.
  if (!secret || !token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws otherwise).
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let parsed: SessionPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.o !== "string" || !OPENID_RE.test(parsed.o)) return null;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (maxAgeMs > 0) {
    if (typeof parsed.t !== "number" || !Number.isFinite(parsed.t)) return null;
    const now = options.now ?? Date.now();
    // Reject far-future issuance (clock skew / forged-looking) and expiry.
    if (parsed.t > now + 60_000) return null;
    if (now - parsed.t > maxAgeMs) return null;
  }
  return { openid: parsed.o };
}
