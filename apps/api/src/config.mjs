export function config(env = process.env) {
  for (const key of ['JWT_SECRET', 'FLAG_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  for (const key of ['JWT_SECRET', 'FLAG_SECRET']) if (env[key].length < 32) throw new Error(`${key} needs at least 32 characters`);
  const root = env.CHALLENGE_DOMAIN || 'localhost';
  if (!/^[a-z0-9.-]+$/.test(root)) throw new Error('Invalid CHALLENGE_DOMAIN');
  return {
    databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET, flagSecret: env.FLAG_SECRET,
    dockerUrl: env.DOCKER_URL || 'http://socket-write:2375',
    domain: root, appOrigin: env.APP_ORIGIN || 'http://ctf.localhost:8080',
    webPort: Number(env.PUBLIC_WEB_PORT || 8080), tcpHost: env.TCP_HOST || 'localhost',
    secure: env.COOKIE_SECURE === 'true', https: env.PUBLIC_HTTPS === 'true',
    maxInstances: Number(env.MAX_INSTANCES || 10), ttlSeconds: 900,
    imagePrefix: env.IMAGE_PREFIX || 'sigmactf', imageTag: env.IMAGE_TAG || 'v1',
    port: Number(env.PORT || 4000), firewallConfirmed: env.SANDBOX_FIREWALL_CONFIRMED === 'true'
  };
}
