// In-memory session store + lifecycle for Ember.
// A session moves through: queued -> ready -> active -> ended.
// Each session belongs to one api_key and one game, and holds an opaque
// embed_token so the (unauthenticated) embed player can attach without
// exposing the api_key to the browser.

import crypto from "node:crypto";

const sessions = new Map(); // uuid -> session

export function createSession({ apiKey, game, maxSeconds }) {
  const uuid = crypto.randomUUID();
  const embed_token = crypto.randomBytes(24).toString("hex");
  const s = {
    uuid,
    embed_token,
    apiKey,
    game,
    status: "queued",        // queued | ready | active | ended
    queue_pos: 0,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    maxSeconds,
    lastPing: Date.now(),
    transport: null,         // filled in by the provider (play_url or signaling info)
    provider_state: {},      // provider scratch space (upstream ids, ws, etc.)
  };
  sessions.set(uuid, s);
  return s;
}

export function getSession(uuid) {
  return sessions.get(uuid) || null;
}

export function getByEmbedToken(token) {
  for (const s of sessions.values()) {
    if (s.embed_token === token && s.status !== "ended") return s;
  }
  return null;
}

export function countActiveForKey(apiKey) {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.apiKey === apiKey && s.status !== "ended") n++;
  }
  return n;
}

export function timeUsed(s) {
  const from = s.startedAt || s.createdAt;
  const to = s.endedAt || Date.now();
  return Math.floor((to - from) / 1000);
}

export function endSession(uuid, reason = "quit") {
  const s = sessions.get(uuid);
  if (!s || s.status === "ended") return;
  s.status = "ended";
  s.endedAt = Date.now();
  s.end_reason = reason;
  try { s.provider_state?.cleanup?.(); } catch (_) {}
}

/** Reap expired / idle sessions. Called on an interval by the server. */
export function reap() {
  const now = Date.now();
  for (const [uuid, s] of sessions) {
    if (s.status === "ended") {
      if (now - s.endedAt > 60_000) sessions.delete(uuid); // keep briefly for final polls
      continue;
    }
    if (timeUsed(s) >= s.maxSeconds) { endSession(uuid, "time_limit"); continue; }
    if (now - s.lastPing > 45_000) endSession(uuid, "idle_timeout");
  }
}
