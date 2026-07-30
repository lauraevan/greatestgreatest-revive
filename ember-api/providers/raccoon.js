// Raccoon Games provider — the single seam where Ember talks to the real
// upstream. Everything else in the codebase is provider-agnostic.
//
// ---------------------------------------------------------------------------
// IMPORTANT / READ ME
// ---------------------------------------------------------------------------
// Raccoon Games is a third-party cloud-gaming service with a PRIVATE, undocumented
// backend. Ember cannot invent those internals for you. This adapter implements
// the *flow* that a stratus-style proxy uses, with every upstream URL and payload
// behind config so you can point it at the real endpoints once you have them:
//
//   1. Mint a throwaway Raccoon account (temp-mail flow), or use a pooled account.
//   2. Request a game slot for game.raccoon_id  ->  get a queue ticket.
//   3. Poll/await the queue, then open Raccoon's signaling WebSocket.
//   4. Relay WebRTC offers/candidates between the player's browser and Raccoon.
//
// Fill in the RACCOON_* values via config/raccoon.json or environment variables.
// Until they are set, acquire() throws a clear "not configured" error instead of
// pretending to work — Ember stays honest.
//
// Real-time upstream relaying needs a WebSocket *client*; install `ws`
// (npm i ws) to enable it. The rest of the API runs without it.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const name = "raccoon";

function loadConfig() {
  const file = path.join(__dirname, "..", "config", "raccoon.json");
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  }
  return {
    base_url: process.env.RACCOON_BASE_URL || cfg.base_url || "",
    signaling_url: process.env.RACCOON_SIGNALING_URL || cfg.signaling_url || "",
    account_mode: process.env.RACCOON_ACCOUNT_MODE || cfg.account_mode || "tempmail",
    tempmail_api: process.env.RACCOON_TEMPMAIL_API || cfg.tempmail_api || "https://api.mail.tm",
    pooled_accounts: cfg.pooled_accounts || [],
    ice_servers: cfg.ice_servers || [{ urls: "stun:stun.l.google.com:19302" }],
  };
}

function assertConfigured(cfg) {
  if (!cfg.base_url || !cfg.signaling_url) {
    throw new Error(
      "Raccoon provider is not configured. Set base_url and signaling_url in " +
      "config/raccoon.json (or RACCOON_BASE_URL / RACCOON_SIGNALING_URL), or run " +
      "with PROVIDER=mock for the built-in demo."
    );
  }
}

// --- Step 1: obtain an authenticated Raccoon account ------------------------
async function getAccount(cfg) {
  if (cfg.account_mode === "pooled") {
    if (!cfg.pooled_accounts.length) throw new Error("No pooled Raccoon accounts configured.");
    return cfg.pooled_accounts[Math.floor(Math.random() * cfg.pooled_accounts.length)];
  }
  // tempmail mode: create a disposable inbox, register, confirm, log in.
  // The concrete calls depend on Raccoon's real signup + your temp-mail provider.
  // Implement against cfg.tempmail_api and cfg.base_url here.
  throw new Error(
    "tempmail account flow not implemented for your upstream. Provide Raccoon's " +
    "real signup/login endpoints here, or use account_mode:'pooled' with credentials."
  );
}

// --- Step 2 & 3: request a slot and wait for the queue ----------------------
export async function acquire(session) {
  const cfg = loadConfig();
  assertConfigured(cfg);
  const game = session.game;
  if (!game.raccoon_id) throw new Error(`Game '${game.key}' has no raccoon_id in cloud.json.`);

  const account = await getAccount(cfg);

  // Example shape — adapt to Raccoon's real API:
  //   POST {base_url}/queue  { game_id }  ->  { ticket, position }
  const res = await fetch(`${cfg.base_url}/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ game_id: game.raccoon_id }),
  });
  if (!res.ok) throw new Error(`Raccoon queue request failed: ${res.status}`);
  const data = await res.json();

  session.provider_state.account = account;
  session.provider_state.ticket = data.ticket;
  session.queue_pos = data.position ?? 0;
  session.status = session.queue_pos > 0 ? "queued" : "ready";
  session.transport = {
    kind: "stream",
    signaling_path: `/v1/signal/${session.uuid}`,
    ice_servers: cfg.ice_servers,
  };
}

// --- Step 4: relay signaling between the browser and Raccoon ----------------
export async function onSignal(session, socket) {
  const cfg = loadConfig();
  let WS;
  try { ({ WebSocket: WS } = await import("ws")); }
  catch {
    socket.send({ type: "error", error: "Streaming needs the 'ws' package: npm i ws" });
    socket.close();
    return;
  }

  const ticket = session.provider_state.ticket;
  const upstream = new WS(`${cfg.signaling_url}?ticket=${encodeURIComponent(ticket)}`);

  upstream.on("open", () => socket.send({ type: "connected" }));
  upstream.on("message", (buf) => socket.send(buf.toString()));      // Raccoon -> browser
  upstream.on("close", () => socket.close());
  upstream.on("error", (e) => { socket.send({ type: "error", error: String(e.message || e) }); socket.close(); });

  socket.on("message", (raw) => { try { upstream.send(raw); } catch (_) {} }); // browser -> Raccoon
  socket.on("close", () => { try { upstream.close(); } catch (_) {} });

  session.provider_state.cleanup = () => { try { upstream.close(); } catch (_) {} };
}

export async function quit(session) {
  const cfg = loadConfig();
  const account = session.provider_state?.account;
  const ticket = session.provider_state?.ticket;
  session.provider_state?.cleanup?.();
  // Best-effort: tell Raccoon to release the slot / tear down the temp account.
  if (cfg.base_url && account && ticket) {
    try {
      await fetch(`${cfg.base_url}/quit`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ ticket }),
      });
    } catch (_) {}
  }
}
