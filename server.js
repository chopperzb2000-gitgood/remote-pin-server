// Central relay server. Deploy behind HTTPS/WSS (e.g. Render).
// Host agents connect outbound; users never enter an IP address.
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.ALLOWED_ORIGIN || "*" } });
app.use(express.static(path.join(__dirname, "web")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();       // pin -> {host, controller, createdAt, approved}
const socketRoom = new Map();  // socket.id -> pin
const PIN_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map();

function newPin() {
  for (let i = 0; i < 100; i++) {
    const pin = String(crypto.randomInt(0, 1000)).padStart(3, "0");
    if (!rooms.has(pin)) return pin;
  }
  throw new Error("No free PINs. Try again shortly.");
}
function clean() {
  const now = Date.now();
  for (const [pin, room] of rooms) {
    if (now - room.createdAt > PIN_TTL_MS || !room.host.connected) {
      if (room.controller?.connected) room.controller.emit("session-ended", { reason: "PIN expired or host disconnected" });
      rooms.delete(pin);
    }
  }
}
setInterval(clean, 10_000).unref();

io.on("connection", socket => {
  socket.on("host-register", (_data, ack = () => {}) => {
    try {
      clean();
      const pin = newPin();
      rooms.set(pin, { host: socket, controller: null, createdAt: Date.now(), approved: false });
      socketRoom.set(socket.id, pin);
      socket.emit("host-pin", { pin, expiresInSeconds: 120 });
      ack({ ok: true, pin });
    } catch (e) { ack({ ok: false, error: e.message }); }
  });

  socket.on("controller-join", ({ pin } = {}, ack = () => {}) => {
    clean();
    pin = String(pin ?? "");
    const ipKey = socket.handshake.address || "unknown";
    const now = Date.now();
    const bucket = attempts.get(ipKey) || [];
    const recent = bucket.filter(t => now - t < 5 * 60 * 1000);
    if (recent.length >= MAX_ATTEMPTS) {
      attempts.set(ipKey, recent);
      return ack({ ok: false, error: "Too many attempts. Wait five minutes." });
    }
    const room = rooms.get(pin);
    if (!/^\d{3}$/.test(pin) || !room || room.controller) {
      recent.push(now); attempts.set(ipKey, recent);
      return ack({ ok: false, error: "PIN is invalid, expired, or already in use." });
    }
    room.controller = socket;
    room.approved = false;
    socketRoom.set(socket.id, pin);
    room.host.emit("controller-request", { pin, requestId: socket.id });
    ack({ ok: true, waiting: true, message: "Waiting for the host to approve this connection." });
  });

  socket.on("host-approve", ({ approve } = {}, ack = () => {}) => {
    const pin = socketRoom.get(socket.id);
    const room = rooms.get(pin);
    if (!room || room.host !== socket) return ack({ ok: false, error: "Not the host." });
    room.approved = Boolean(approve && room.controller?.connected);
    if (room.approved) {
      room.controller.emit("connection-approved", { pin });
      socket.emit("controller-status", { connected: true });
      ack({ ok: true });
    } else {
      room.controller?.emit("connection-denied");
      room.controller = null;
      ack({ ok: true });
    }
  });

  socket.on("frame", ({ jpeg } = {}) => {
    const pin = socketRoom.get(socket.id);
    const room = rooms.get(pin);
    if (room?.host === socket && room.approved && room.controller?.connected && typeof jpeg === "string" && jpeg.length < 1_500_000) {
      room.controller.emit("frame", { jpeg });
    }
  });

  socket.on("remote-input", payload => {
    const pin = socketRoom.get(socket.id);
    const room = rooms.get(pin);
    if (room?.controller === socket && room.approved && room.host.connected) {
      // Forward only bounded, known event types. Host agent validates again.
      const allowed = ["move", "click", "key", "scroll"];
      if (payload && allowed.includes(payload.kind)) room.host.emit("remote-input", payload);
    }
  });

  socket.on("disconnect", () => {
    const pin = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    const room = rooms.get(pin);
    if (!room) return;
    if (room.host === socket) {
      room.controller?.emit("session-ended", { reason: "Host disconnected" });
      rooms.delete(pin);
    } else if (room.controller === socket) {
      room.controller = null;
      room.approved = false;
      room.host.emit("controller-status", { connected: false });
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log(`Remote PIN relay listening on ${port}`));
