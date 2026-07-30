# 🔥 Ember API

A **premium cloud-games API**. Ember fetches games from **Raccoon Games** and
serves them so they can be played *through the API* — drop it behind your giant
game website and stream games to your visitors. Same shape as
[stratus-api](https://github.com/x8rr/stratus-api): premium API keys, per-tier
rate limits, a session lifecycle with a queue, an embeddable player, and a
WebRTC signaling relay.

```
┌────────────┐   /v1/games            ┌───────────┐   upstream    ┌───────────────┐
│ your game  │   /v1/session          │   Ember   │   catalog +   │ Raccoon Games │
│  website   │ ─────────────────────► │    API    │ ─ signaling ► │   (upstream)  │
│ (browser)  │ ◄── embed player ────  │           │ ◄── stream ─  │               │
└────────────┘   WebRTC relay         └───────────┘               └───────────────┘
```

## What runs today vs. what you configure

Raccoon Games is a third-party service with a **private, undocumented backend**.
Ember will not fake those internals. So it ships in two layers:

- **The whole API framework runs right now** with a built-in **mock provider** —
  auth, quotas, sessions, queue, embed player, and a live signaling relay. Great
  for wiring up your site and demos.
- **The Raccoon-specific upstream** (account creation, queue tickets, the real
  signaling host + catalog) lives in **one file**: `providers/raccoon.js`, driven
  by `config/raccoon.json`. Fill in Raccoon's real endpoints there and switch the
  provider — nothing else in the codebase changes.

## Quick start

```bash
cd ember-api
node ember.js                 # starts the mock demo on http://localhost:8787
# open website/ember-demo.html in a browser and press Connect
```

Talk to it:

```bash
curl -H "x-api-key: demo-key-change-me" http://localhost:8787/v1/games

curl -H "x-api-key: demo-key-change-me" -H "content-type: application/json" \
     -d '{"game_key":"raccoon-demo-runner"}' \
     http://localhost:8787/v1/session
```

Switch providers with an env var:

```bash
PROVIDER=mock    node ember.js     # built-in demo (default)
PROVIDER=raccoon node ember.js     # real upstream (configure config/raccoon.json first)
```

## Endpoints

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/v1/health` | – | Liveness + provider/catalog size |
| GET | `/v1/games` | key | Full game catalog |
| GET | `/v1/games/:key` | key | One game's metadata |
| POST | `/v1/session` | key | Create a play session (`{ "game_key": "..." }`) |
| GET | `/v1/session/:uuid` | key | Poll status / queue position |
| POST | `/v1/session/:uuid/ping` | key | Keepalive + quota report |
| DELETE | `/v1/session/:uuid` | key | End the session |
| GET | `/v1/embed?token=…` | embed token | The embeddable player page |
| GET | `/v1/embed-data?token=…` | embed token | Transport info for the player |
| WS | `/v1/signal/:uuid` | session | WebRTC signaling relay |

**Auth:** send the key as header `x-api-key`, query `?api_key=`, or body `api_key`.
The **embed** routes use a per-session `embed_token` (not the API key) so the key
never has to reach the player iframe.

### Session lifecycle

`POST /v1/session` → `queued` (poll `GET /v1/session/:uuid` until `ready`) →
open `embed_url` (or the `signal` WS directly) → `active` → `DELETE` to quit.
Direct-embeddable games skip the queue and are `ready` immediately.

## Configuration

### `config/sites.json` — premium keys & tiers
Each key is a client of your API with an on/off switch, concurrency cap, session
length cap, and rolling `minute/hour/day/month` quotas. Set `enabled: false` to
revoke instantly. **Change `demo-key-change-me` before deploying.**

### `config/cloud.json` — the game catalog
The equivalent of stratus's `cloud.json`. Each game has a `key`, display metadata,
`streamable`, and either a `play_url` (direct embed) or a `raccoon_id` (streamed).
Refresh it from upstream with:

```bash
node scripts/sync-catalog.js      # needs RACCOON_CATALOG_URL / config/raccoon.json
```

### `config/raccoon.json` — the upstream seam
Copy `config/raccoon.example.json` → `config/raccoon.json` and fill in Raccoon's
real `base_url`, `signaling_url`, `catalog_url`, and account strategy
(`pooled` credentials or `tempmail`). This file is git-ignored. Streamed
relaying uses a WebSocket client — enable it with `npm i ws` (optional; the rest
runs without it).

## Putting it on your website

```html
<script src="ember-client.js"></script>
<script>
  const ember = new EmberClient({ base: "https://your-ember-host", apiKey: "YOUR_SITE_KEY" });
  const games = await ember.games();                 // list
  ember.play(games[0].key, document.getElementById("player"));  // launch in an iframe
</script>
```

- `website/ember-client.js` — the browser client.
- `website/ember-demo.html` — a full working storefront/player you can crib from.

Your existing catalog format is `[source, path, icon, name]`. Ember games map
cleanly onto it — add a dedicated "Ember Cloud Games" row whose cards call
`ember.play(key, playerContainer)`, or, if you prefer your own iframe, create a
session first and use its returned `embed_url` as the launch path.

### A note on the front-end API key
Any key in browser JS is visible to visitors (this is true of stratus site keys
too). Mitigations: issue a **dedicated site key** with tight limits in
`sites.json`, rotate it if abused, and/or proxy `/v1/*` through your own backend
so the real key stays server-side.

## Files

```
ember-api/
  ember.js                 # HTTP + WebSocket server, routing, auth, rate limits
  config/
    sites.json             # premium API keys + per-tier limits
    cloud.json             # game catalog (synced from Raccoon)
    raccoon.example.json   # template for the private upstream config
  lib/
    wsserver.js            # dependency-free WebSocket server (signaling relay)
    ratelimit.js           # per-IP + per-key rolling-window quotas
    sessions.js            # session store + lifecycle + reaping
  providers/
    mock.js                # built-in demo provider (runs with zero setup)
    raccoon.js             # the Raccoon Games upstream adapter
  public/embed.html        # the embeddable player (iframe + WebRTC)
  scripts/sync-catalog.js  # refresh cloud.json from Raccoon
  website/                 # browser client + demo storefront for your site
```

## License

AGPL-3.0, matching the stratus-api project this is modeled on.
