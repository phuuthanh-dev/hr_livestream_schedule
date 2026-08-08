const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

type LoginBucket = {
  failures: number;
  resetAt: number;
};

declare global {
  var __hrStreamingLoginBuckets: Map<string, LoginBucket> | undefined;
}

function getBuckets() {
  if (!globalThis.__hrStreamingLoginBuckets) {
    globalThis.__hrStreamingLoginBuckets = new Map();
  }
  return globalThis.__hrStreamingLoginBuckets;
}

export function checkLoginRateLimit(key: string) {
  const buckets = getBuckets();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) {
    buckets.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: bucket.failures < MAX_FAILURES,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000))
  };
}

export function recordLoginFailure(key: string) {
  const buckets = getBuckets();
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.failures += 1;
}

export function clearLoginFailures(key: string) {
  getBuckets().delete(key);
}
