type EnvMap = Partial<Record<string, string | undefined>>;

export type WechatAuthConfig = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
};

export function resolveDatabaseUrl(env: EnvMap = process.env) {
  const directUrl = env.DATABASE_URL?.trim();
  if (directUrl) {
    return directUrl;
  }

  const address = env.MYSQL_ADDRESS?.trim();
  const username = env.MYSQL_USERNAME?.trim();
  const password = env.MYSQL_PASSWORD;
  const database = env.MYSQL_DATABASE?.trim();

  if (!address || !username || password === undefined || !database) {
    return undefined;
  }

  return `mysql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${address}/${encodeURIComponent(database)}`;
}

export function resolveWechatAuthConfig(env: EnvMap = process.env): WechatAuthConfig {
  const appId = env.WECHAT_APP_ID?.trim() ?? "";
  const appSecret = env.WECHAT_APP_SECRET?.trim() ?? "";
  const sessionSecret = env.WECHAT_SESSION_SECRET?.trim() || appSecret;
  const ttlHours = Number(env.WECHAT_SESSION_TTL_HOURS ?? "720");
  const normalizedTtlHours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 720;

  return {
    enabled: Boolean(appId && appSecret && sessionSecret),
    appId,
    appSecret,
    sessionSecret,
    sessionTtlSeconds: Math.floor(normalizedTtlHours * 3600)
  };
}
