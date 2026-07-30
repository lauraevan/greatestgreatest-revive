// Ember API — a premium cloud-games API.
// Fetches games from Raccoon Games and serves them so they can be played
// through the API. Inspired by (and shaped like) stratus-api.
//
//   Run:   node ember.js            (PORT env to change port, default 8787)
//   Demo:  PROVIDER=mock node ember.js
//   Live:  PROVIDER=raccoon node ember.js   (configure config/raccoon.json first)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attachWebSocketServer } from "./lib/wsserver.js";
import { checkIp, checkKey, clientIp } from "./lib/ratelimit.js";
import * as store from "./lib/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PROVIDER_NAME = process.env.PROVIDER || "mock";

// ---- load config + provider ------------------------------------------------
const sites = readJson("config/sites.json");
let cloud = readJson("config/cloud.json");
const provider = await import(`./providers/${PROVIDER_NAME}.js`);
console.log(`[ember] provider=${PROVIDER_NAME} games=${cloud.games?.length || 0} port=${PORT}`);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, rel), "utf8"));
}

// ---- helpers ---------------------------------------------------------------
function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function apiKeyFrom(req, url, body) {
  return req.headers["x-api-key"] || url.searchParams.get("api_key") || body?.api_key || null;
}

// Authenticate + enforce per-IP and per-key limits. Returns { site } or sends an error.
function authorize(req, res, url, body) {
  const ip = clientIp(req);
  const ipCheck = checkIp(ip);
  if (!ipCheck.ok) { send(res, 429, { error: "ip_rate_limited", retry_after: ipCheck.retryAfter }); return null; }

  const key = apiKeyFrom(req, url, body);
  if (!key) { send(res, 401, { error: "missing_api_key" }); return null; }
  const site = sites[key];
  if (!site || site["//"]) { send(res, 401, { error: "invalid_api_key" }); return null; }
  if (!site.enabled) { send(res, 403, { error: "api_key_disabled" }); return null; }

  const keyCheck = checkKey(key, site.limits);
  if (!keyCheck.ok) { send(res, 429, { error: "quota_exceeded", quota: keyCheck.quota }); return null; }

  return { key, site, quota: keyCheck.quota };
}

function publicGame(g) {
  return {
    key: g.key, name: g.name, publisher: g.publisher,
    genre: g.genre, icon: g.icon, streamable: !!g.streamable,
  };
}

// ---- HTTP router -----------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    // --- public: health + catalog metadata ---
    if (req.method === "GET" && p === "/v1/health") {
      return send(res, 200, { ok: true, provider: PROVIDER_NAME, games: cloud.games?.length || 0 });
    }

    // --- public embed player (uses embed_token, never the api_key) ---
    if (req.method === "GET" && p === "/v1/embed") {
      const html = fs.readFileSync(path.join(__dirname, "public", "embed.html"), "utf8");
      return send(res, 200, html);
    }
    if (req.method === "GET" && p === "/v1/embed-data") {
      const s = store.getByEmbedToken(url.searchParams.get("token"));
      if (!s) return send(res, 404, { error: "unknown_or_ended_session" });
      return send(res, 200, {
        status: s.status, game: publicGame(s.game),
        queue_pos: s.queue_pos, transport: s.transport,
      });
    }

    // --- authenticated: catalog ---
    if (req.method === "GET" && p === "/v1/games") {
      const auth = authorize(req, res, url); if (!auth) return;
      return send(res, 200, { provider: cloud.provider, games: (cloud.games || []).map(publicGame) });
    }
    const gameMatch = p.match(/^\/v1\/games\/([^/]+)$/);
    if (req.method === "GET" && gameMatch) {
      const auth = authorize(req, res, url); if (!auth) return;
      const g = (cloud.games || []).find((x) => x.key === gameMatch[1]);
      if (!g) return send(res, 404, { error: "game_not_found" });
      return send(res, 200, publicGame(g));
    }

    // --- authenticated: create a play session ---
    if (req.method === "POST" && p === "/v1/session") {
      const body = await readBody(req);
      const auth = authorize(req, res, url, body); if (!auth) return;
      const g = (cloud.games || []).find((x) => x.key === body.game_key);
      if (!g) return send(res, 404, { error: "game_not_found" });

      if (store.countActiveForKey(auth.key) >= (auth.site.max_concurrent_sessions || 1)) {
        return send(res, 429, { error: "concurrency_limit_reached" });
      }
      const s = store.createSession({
        apiKey: auth.key, game: g,
        maxSeconds: Math.min(auth.site.max_session_seconds || 900, 3600),
      });
      try { await provider.acquire(s); }
      catch (e) { store.endSession(s.uuid, "provider_error"); return send(res, 502, { error: "provider_error", detail: String(e.message || e) }); }

      return send(res, 200, sessionView(s, url));
    }

    // --- authenticated: session lifecycle ---
    const sessMatch = p.match(/^\/v1\/session\/([^/]+)(\/ping)?$/);
    if (sessMatch) {
      const uuid = sessMatch[1];
      const body = req.method === "GET" ? {} : await readBody(req);
      const auth = authorize(req, res, url, body); if (!auth) return;
      const s = store.getSession(uuid);
      if (!s || s.apiKey !== auth.key) return send(res, 404, { error: "session_not_found" });

      if (req.method === "GET") return send(res, 200, sessionView(s, url));

      if (req.method === "POST" && sessMatch[2] === "/ping") {
        s.lastPing = Date.now();
        return send(res, 200, {
          uuid: s.uuid, status: s.status,
          session_time_used_seconds: store.timeUsed(s),
          session_time_limit_seconds: s.maxSeconds,
          quota: auth.quota,
        });
      }
      if (req.method === "DELETE") {
        try { await provider.quit(s); } catch (_) {}
        store.endSession(uuid, "quit");
        return send(res, 200, { uuid, status: "ended" });
      }
    }

    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 500, { error: "internal_error", detail: String(e.message || e) });
  }
});

function sessionView(s, url) {
  const base = `${url.protocol}//${url.host}`;
  const view = {
    uuid: s.uuid, status: s.status, game: publicGame(s.game),
    queue_pos: s.queue_pos,
    session_time_limit_seconds: s.maxSeconds,
  };
  if (s.status === "ready" || s.status === "active") {
    view.transport = s.transport;
    view.embed_url = `${base}/v1/embed?token=${s.embed_token}`;
    view.embed_token = s.embed_token;
  }
  return view;
}

// ---- WebSocket signaling relay --------------------------------------------
attachWebSocketServer(server, {
  path: "/v1/signal/",
  onConnection: (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const uuid = url.pathname.split("/").pop();
    const s = store.getSession(uuid);
    if (!s || s.status === "ended") { socket.send({ type: "error", error: "no_session" }); socket.close(); return; }
    s.status = "active";
    if (!s.startedAt) s.startedAt = Date.now();
    s.lastPing = Date.now();
    try { provider.onSignal(s, socket); }
    catch (e) { socket.send({ type: "error", error: String(e.message || e) }); socket.close(); }
  },
});

setInterval(() => store.reap(), 5000).unref();

server.listen(PORT, () => console.log(`[ember] listening on http://localhost:${PORT}`));
