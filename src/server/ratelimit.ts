const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export interface RateLimitConfig {
  capacity: number;
  refillPerMinute: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { capacity: 10, refillPerMinute: 60 };

export function allowRequest(key: string, config: RateLimitConfig = DEFAULT_RATE_LIMIT): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: config.capacity, lastRefill: now };
  const elapsedMinutes = (now - bucket.lastRefill) / 60000;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsedMinutes * config.refillPerMinute);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

export function resetRateLimiter(): void {
  buckets.clear();
}
