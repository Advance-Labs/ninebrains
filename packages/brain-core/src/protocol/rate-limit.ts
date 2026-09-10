/** SEC-06: per-token request budget for the Brain endpoint. */
export interface RateLimiter {
  /** Spends one request for `key`. False means reject with 429. */
  take(key: object): boolean;
}

export interface TokenBucketOptions {
  /** Sustained requests per second. Default 20. */
  ratePerSecond?: number;
  /** Requests allowed in a burst. Default 60. */
  burst?: number;
  now?: () => number;
}

/**
 * Token bucket keyed by object identity (the grant a token resolves to), so
 * no identity string is ever built. A `WeakMap` lets revoked grants' buckets
 * be garbage-collected.
 */
export function createTokenBucketLimiter(options: TokenBucketOptions = {}): RateLimiter {
  const rate = options.ratePerSecond ?? 20;
  const burst = options.burst ?? 60;
  const now = options.now ?? Date.now;
  const buckets = new WeakMap<object, { tokens: number; at: number }>();

  return {
    take(key) {
      const at = now();
      const bucket = buckets.get(key) ?? { tokens: burst, at };
      bucket.tokens = Math.min(burst, bucket.tokens + ((at - bucket.at) * rate) / 1000);
      bucket.at = at;
      buckets.set(key, bucket);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
