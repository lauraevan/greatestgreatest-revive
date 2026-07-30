// Refresh config/cloud.json from the upstream Raccoon Games catalog.
//
//   node scripts/sync-catalog.js
//
// Point RACCOON_CATALOG_URL (or config/raccoon.json -> catalog_url) at Raccoon's
// real game-list endpoint. Ember maps each upstream entry into its own catalog
// shape so the API surface stays stable regardless of upstream changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudPath = path.join(__dirname, "..", "config", "cloud.json");
const rcfgPath = path.join(__dirname, "..", "config", "raccoon.json");

function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

async function main(){
  let rcfg = {};
  if (fs.existsSync(rcfgPath)) { try { rcfg = JSON.parse(fs.readFileSync(rcfgPath, "utf8")); } catch(_){} }
  const catalogUrl = process.env.RACCOON_CATALOG_URL || rcfg.catalog_url;

  if(!catalogUrl){
    console.error("No catalog URL. Set RACCOON_CATALOG_URL or config/raccoon.json -> catalog_url.");
    console.error("Leaving config/cloud.json unchanged.");
    process.exit(1);
  }

  console.log("[sync] fetching", catalogUrl);
  const res = await fetch(catalogUrl, { headers: rcfg.catalog_headers || {} });
  if(!res.ok){ console.error("[sync] upstream returned", res.status); process.exit(1); }
  const raw = await res.json();

  // Adapt this mapping to Raccoon's real payload shape.
  const upstream = Array.isArray(raw) ? raw : (raw.games || raw.data || []);
  const games = upstream.map((g) => ({
    key: slug(g.slug || g.name || g.id),
    name: g.name || g.title || String(g.id),
    publisher: g.publisher || "Raccoon Games",
    genre: g.genre || g.category || "Game",
    icon: g.icon || g.thumbnail || g.image || "",
    streamable: g.streamable !== false,
    play_url: g.play_url || g.embed_url || null,
    raccoon_id: g.id ?? g.game_id ?? null,
  }));

  const out = {
    generated_at: new Date().toISOString(),
    provider: "raccoon",
    games,
  };
  fs.writeFileSync(cloudPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`[sync] wrote ${games.length} games to config/cloud.json`);
}

main().catch((e) => { console.error("[sync] failed:", e.message); process.exit(1); });
