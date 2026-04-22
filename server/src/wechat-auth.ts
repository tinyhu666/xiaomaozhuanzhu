import { createHmac, timingSafeEqual } from "node:crypto";

import type { WechatAuthConfig } from "./env";
import { AppError } from "./errors";

type FetchLike = typeof fetch;

type WechatCode2SessionResponse = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type SessionTokenPayload = {
  openid: string;
  iat: number;
  exp: number;
};

export async function exchangeWechatCodeForSession(
  code: string,
  config: WechatAuthConfig,
  fetchImpl: FetchLike = fetch
) {
  if (!config.enabled) {
    throw new AppError(503, "WECHAT_LOGIN_DISABLED", "WeChat login is not configured");
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new AppError(502, "WECHAT_LOGIN_FAILED", `WeChat login request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as WechatCode2SessionResponse;
  if (payload.errcode) {
    throw mapWechatLoginError(payload.errcode, payload.errmsg);
  }

  if (!payload.openid || !payload.session_key) {
    throw new AppError(502, "WECHAT_LOGIN_FAILED", "WeChat login response was missing openid or session_key");
  }

  return {
    openid: payload.openid,
    sessionKey: payload.session_key,
    unionid: payload.unionid ?? ""
  };
}

export function createUserSessionToken(openid: string, config: WechatAuthConfig, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: SessionTokenPayload = {
    openid,
    iat: issuedAt,
    exp: issuedAt + config.sessionTtlSeconds
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signTokenPayload(encodedPayload, config.sessionSecret);
  return `${encodedPayload}.${signature}`;
}

export function readOpenIdFromSessionToken(token: string, config: WechatAuthConfig, now = new Date()) {
  if (!config.enabled) {
    return "";
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }

  const [encodedPayload, signature] = trimmed.split(".");
  if (!encodedPayload || !signature) {
    return "";
  }

  const expectedSignature = signTokenPayload(encodedPayload, config.sessionSecret);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length) {
    return "";
  }
  if (!timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return "";
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionTokenPayload;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!payload.openid || payload.exp <= nowSeconds) {
      return "";
    }
    return payload.openid;
  } catch {
    return "";
  }
}

function signTokenPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function mapWechatLoginError(errcode: number, errmsg?: string) {
  if (errcode === 40029) {
    return new AppError(401, "WECHAT_CODE_INVALID", "WeChat login code is invalid or expired");
  }
  if (errcode === 40226) {
    return new AppError(403, "WECHAT_CODE_BLOCKED", "WeChat login code has been blocked");
  }
  if (errcode === 45011) {
    return new AppError(429, "WECHAT_RATE_LIMITED", "WeChat login is being called too frequently");
  }
  return new AppError(502, "WECHAT_LOGIN_FAILED", errmsg?.trim() || "WeChat login failed");
}
