import { createHmac, timingSafeEqual } from "node:crypto";

import type { Request, Response } from "express";

export type AdminAuthConfig = {
  enabled: boolean;
  password: string;
  sessionSecret: string;
  cookieName: string;
  sessionTtlMs: number;
};

const DEFAULT_COOKIE_NAME = "admin_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function resolveAdminAuthConfig(env: NodeJS.ProcessEnv): AdminAuthConfig {
  const password = env.ADMIN_PASSWORD?.trim() ?? "";
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim() || password;

  return {
    enabled: password.length > 0,
    password,
    sessionSecret,
    cookieName: DEFAULT_COOKIE_NAME,
    sessionTtlMs: DEFAULT_SESSION_TTL_MS
  };
}

export function isAdminAuthenticated(request: Request, config: AdminAuthConfig, now: Date) {
  if (!config.enabled) {
    return false;
  }

  const cookies = parseCookies(request.header("cookie"));
  const token = cookies[config.cookieName];
  if (!token) {
    return false;
  }

  return verifySessionToken(token, config.sessionSecret, now.getTime());
}

export function setAdminSessionCookie(response: Response, config: AdminAuthConfig, now: Date, secure: boolean) {
  const expiresAtMs = now.getTime() + config.sessionTtlMs;
  const token = createSessionToken(expiresAtMs, config.sessionSecret);

  response.setHeader(
    "Set-Cookie",
    serializeCookie(config.cookieName, token, {
      httpOnly: true,
      maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
      path: "/",
      sameSite: "Lax",
      secure
    })
  );
}

export function clearAdminSessionCookie(response: Response, config: AdminAuthConfig, secure: boolean) {
  response.setHeader(
    "Set-Cookie",
    serializeCookie(config.cookieName, "", {
      httpOnly: true,
      maxAgeSeconds: 0,
      path: "/",
      sameSite: "Lax",
      secure
    })
  );
}

function createSessionToken(expiresAtMs: number, sessionSecret: string) {
  const payload = String(expiresAtMs);
  const signature = sign(payload, sessionSecret);
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string, sessionSecret: string, nowMs: number) {
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) {
    return false;
  }

  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }

  const expectedSignature = sign(payload, sessionSecret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function sign(payload: string, sessionSecret: string) {
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function parseCookies(cookieHeader?: string) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const fragment of cookieHeader.split(";")) {
    const [name, ...rest] = fragment.trim().split("=");
    if (!name) {
      continue;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAgeSeconds?: number;
    path?: string;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
  }
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
