const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

let io = null;

/**
 * Initialize Socket.IO on top of the existing HTTP server.
 * Auth: client must connect with `auth: { token: "<JWT access token>" }`.
 * Rooms: `project:<id>` — joined only after verifying the user is a member.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  // ── Auth middleware ──────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token provided"));

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return next(new Error("Invalid or expired token"));
      }

      const [rows] = await db.query(
        "SELECT id, name, email, initials, color, avatar FROM users WHERE id = ?",
        [decoded.id]
      );
      if (!rows.length) return next(new Error("User not found"));

      socket.user = rows[0];
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    // Personal room — lets us push notifications/invites to this user
    // across all of their open tabs/devices.
    socket.join(`user:${socket.user.id}`);

    // ── Join a project room (verifies membership server-side) ──
    socket.on("project:join", async (projectId, ack) => {
      try {
        const [rows] = await db.query(
          "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
          [projectId, socket.user.id]
        );
        if (!rows.length) {
          return ack?.({ ok: false, error: "Not a member of this project" });
        }
        socket.join(`project:${projectId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Failed to join project room" });
      }
    });

    socket.on("project:leave", (projectId) => {
      socket.leave(`project:${projectId}`);
    });

    // ── Chat: typing indicator ──────────────────────────────
    socket.on("chat:typing", ({ projectId }) => {
      if (!projectId) return;
      socket.to(`project:${projectId}`).emit("chat:typing", {
        userId: socket.user.id,
        name: socket.user.name,
      });
    });

    socket.on("disconnect", () => {
      // socket.io auto-leaves all rooms on disconnect
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO not initialized — call initSocket(server) first");
  return io;
}

/** Emit an event to everyone in a project room (e.g. "project:5"). */
function emitToProject(projectId, event, payload) {
  if (!io) return;
  io.to(`project:${projectId}`).emit(event, payload);
}

/** Emit an event to a specific user across all their connected sockets/tabs. */
function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

module.exports = { initSocket, getIO, emitToProject, emitToUser };
