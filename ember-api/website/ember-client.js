// Ember browser client — drop this into your game website to list and launch
// Ember cloud games. Usage:
//
//   const ember = new EmberClient({ base: "https://your-ember-host", apiKey: "..." });
//   const games = await ember.games();            // catalog
//   ember.play(games[0].key, document.body);      // opens the player in an iframe
//
// Note: any API key placed in front-end JS is visible to visitors — this is the
// same trade-off stratus-style site keys make. Issue a dedicated site key
// (config/sites.json) scoped with tight limits, and rotate it if abused. For
// stricter control, proxy /v1/* through your own backend so the key stays server-side.

(function (global) {
  class EmberClient {
    constructor({ base, apiKey }) {
      this.base = base.replace(/\/$/, "");
      this.apiKey = apiKey;
    }

    async _get(path) {
      const r = await fetch(this.base + path, { headers: { "x-api-key": this.apiKey } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      return r.json();
    }
    async _post(path, body) {
      const r = await fetch(this.base + path, {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      return r.json();
    }

    /** Full game catalog. */
    async games() { return (await this._get("/v1/games")).games; }

    /** Create a session and return it (includes embed_url once ready/queued). */
    async createSession(gameKey) { return this._post("/v1/session", { game_key: gameKey }); }

    /** Poll a session until it is ready (queue drains), then return it. */
    async waitReady(uuid, { onQueue } = {}) {
      for (;;) {
        const s = await this._get("/v1/session/" + uuid);
        if (s.status === "ready" || s.status === "active") return s;
        if (s.status === "ended") throw new Error("session_ended");
        if (onQueue) onQueue(s.queue_pos);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    async quit(uuid) { try { await fetch(this.base + "/v1/session/" + uuid, { method: "DELETE", headers: { "x-api-key": this.apiKey } }); } catch (_) {} }

    /**
     * One-shot launch: create a session, wait for it, and mount the Ember player
     * iframe into `container`. Returns { uuid, close() }.
     */
    async play(gameKey, container, { onQueue } = {}) {
      const created = await this.createSession(gameKey);
      const ready = created.status === "ready" ? created : await this.waitReady(created.uuid, { onQueue });
      const frame = document.createElement("iframe");
      frame.src = ready.embed_url;
      frame.allow = "fullscreen; autoplay; gamepad; clipboard-write";
      frame.allowFullscreen = true;
      frame.style.cssText = "border:0;width:100%;height:100%;background:#000";
      container.innerHTML = "";
      container.appendChild(frame);
      // keepalive ping so the session isn't reaped
      const ping = setInterval(() => this._post("/v1/session/" + ready.uuid + "/ping").catch(() => {}), 20000);
      return {
        uuid: ready.uuid,
        close: () => { clearInterval(ping); this.quit(ready.uuid); frame.remove(); },
      };
    }
  }

  global.EmberClient = EmberClient;
})(typeof window !== "undefined" ? window : globalThis);
