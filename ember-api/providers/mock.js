// Mock provider — lets the whole Ember API run end-to-end with zero external
// dependencies or accounts. It fakes a short queue, then serves either a direct
// embeddable play_url or a tiny "streamed" frame loop over the signaling channel.
//
// Use this for local development, demos, and CI. Swap PROVIDER=raccoon (see
// providers/raccoon.js) to talk to the real Raccoon Games backend.

export const name = "mock";

/**
 * Begin acquiring a game slot for a session. May resolve immediately (ready)
 * or place the session in a fake queue that drains over a few seconds.
 */
export async function acquire(session) {
  const game = session.game;

  // Direct-embed games need no streaming; hand back a play_url straight away.
  if (game.streamable === false && game.play_url) {
    session.status = "ready";
    session.transport = { kind: "iframe", play_url: game.play_url };
    return;
  }

  // Streamed games: simulate a queue that finishes within a few seconds.
  session.status = "queued";
  session.queue_pos = 2;
  const tick = setInterval(() => {
    if (session.status === "ended") { clearInterval(tick); return; }
    session.queue_pos -= 1;
    if (session.queue_pos <= 0) {
      clearInterval(tick);
      session.status = "ready";
      session.transport = {
        kind: "stream",
        signaling_path: `/v1/signal/${session.uuid}`,
        ice_servers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
    }
  }, 1500);
  session.provider_state.cleanup = () => clearInterval(tick);
}

/**
 * Called when the embed player opens the signaling socket. For the mock we
 * just emit a "demo" stream: a caption the embed page renders so you can see
 * the relay is alive without any real WebRTC peer.
 */
export function onSignal(session, socket) {
  socket.send({ type: "hello", provider: "mock", game: session.game.name });
  let frame = 0;
  const timer = setInterval(() => {
    if (session.status === "ended") { clearInterval(timer); socket.close(); return; }
    socket.send({ type: "demo_frame", n: frame++, ts: Date.now() });
  }, 1000);

  socket.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    // Echo an "answer" for any offer so the embed's state machine advances.
    if (msg.type === "rtc_offer") socket.send({ type: "rtc_answer", sdp: null, demo: true });
    if (msg.type === "input") { /* would forward gamepad/keyboard upstream */ }
  });

  socket.on("close", () => clearInterval(timer));
}

export async function quit(session) {
  session.provider_state?.cleanup?.();
}
