type EnvMap = Partial<Record<string, string | undefined>>;

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
