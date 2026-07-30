// Minimal, dependency-free RFC 6455 WebSocket server.
// Enough to relay JSON text frames for Ember's signaling channel.
// If you prefer the battle-tested `ws` package, this can be swapped out; it is
// kept dependency-free so `node ember.js` runs with only the Node standard lib.

import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Very small EventEmitter-ish socket wrapper around a raw TCP socket. */
class EmberSocket {
  constructor(socket) {
    this._socket = socket;
    this._handlers = { message: [], close: [], error: [] };
    this.closed = false;
    this._buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("close", () => this._fire("close"));
    socket.on("error", (e) => this._fire("error", e));
  }

  on(event, cb) {
    if (this._handlers[event]) this._handlers[event].push(cb);
    return this;
  }

  _fire(event, arg) {
    for (const cb of this._handlers[event] || []) {
      try { cb(arg); } catch (_) { /* handler errors must not kill the socket */ }
    }
  }

  send(data) {
    if (this.closed) return;
    const payload = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    this._socket.write(encodeFrame(payload, 0x1)); // 0x1 = text frame
  }

  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    try { this._socket.write(encodeFrame(body, 0x8)); } catch (_) {}
    try { this._socket.end(); } catch (_) {}
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    let frame;
    while ((frame = decodeFrame(this._buffer))) {
      this._buffer = frame.rest;
      if (frame.opcode === 0x8) { this.close(); this._fire("close"); return; }      // close
      if (frame.opcode === 0x9) { this._socket.write(encodeFrame(frame.payload, 0xA)); continue; } // ping -> pong
      if (frame.opcode === 0xA) { continue; }                                        // pong
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        this._fire("message", frame.payload.toString("utf8"));
      }
    }
  }
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) === 0x80;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, rest: buf.slice(offset + len) };
}

/**
 * Attach a WebSocket upgrade handler to an http.Server.
 * onConnection(socket, request) fires with an EmberSocket for each accepted client.
 */
export function attachWebSocketServer(httpServer, { path, onConnection }) {
  httpServer.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (path && !url.pathname.startsWith(path)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    onConnection(new EmberSocket(socket), req);
  });
}
