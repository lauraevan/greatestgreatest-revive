// Rolling-window rate limiting for Ember.
// Two independent layers, mirroring stratus-api:
//   1. Coarse per-IP protection (abuse / scraping guard).
//   2. Per-api-key quotas across minute/hour/day/month windows (the "premium" tiers).

const WINDOWS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  month: 2_592_000_000, // 30d rolling
};

// key/ip -> array of request timestamps (ms)
const hits = new Map();

function record(id) {
  const now = Date.now();
  let arr = hits.get(id);
  if (!arr) { arr = []; hits.set(id, arr); }
  arr.push(now);
  // prune anything older than the longest window we care about
  const cutoff = now - WINDOWS.month;
  while (arr.length && arr[0] < cutoff) arr.shift();
  return arr;
}

function countWithin(arr, windowMs) {
  const cutoff = Date.now() - windowMs;
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && arr[i] >= cutoff; i--) n++;
  return n;
}

/** Simple fixed per-IP guard. Returns { ok, retryAfter }. */
export function checkIp(ip, maxPerMinute = 100) {
  const arr = record("ip:" + ip);
  const used = countWithin(arr, WINDOWS.minute);
  return { ok: used <= maxPerMinute, used, limit: maxPerMinute, retryAfter: 60 };
}

/**
 * Per-key quota check against a site's configured limits.
 * Records the hit and returns { ok, quota } where quota reports used/limit per window.
 */
export function checkKey(apiKey, limits) {
  const arr = record("key:" + apiKey);
  const quota = {};
  let ok = true;
  for (const [name, windowMs] of Object.entries(WINDOWS)) {
    const limit = limits?.[name];
    if (limit == null) continue;
    const used = countWithin(arr, windowMs);
    quota[name] = { used, limit };
    if (used > limit) ok = false;
  }
  return { ok, quota };
}

/** Read the client IP, honoring a trusted proxy header when present. */
export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}
