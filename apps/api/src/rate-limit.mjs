// One atomic operation: no INCR/EXPIRE race and no sliding-expiry extension.
export const LIMIT_SCRIPT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}`;
export function redisLimiter(redis) {
  return async (key, maximum, seconds) => {
    const [count, ttl] = await redis.eval(LIMIT_SCRIPT, {keys:[`sigma:rate:${key}`],arguments:[String(seconds)]});
    return {allowed:Number(count)<=maximum,retryAfter:Math.max(1,Number(ttl))};
  };
}
