require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const path = require("path");
const rateLimit = require("express-rate-limit");

const authRoutes         = require("./routes/auth.routes");
const userRoutes         = require("./routes/user.routes");
const projectRoutes      = require("./routes/project.routes");
const taskRoutes         = require("./routes/task.routes");
const notificationRoutes = require("./routes/notification.routes");
const invitationRoutes   = require("./routes/invitation.routes");
const requestRoutes      = require("./routes/request.routes");
const { errorHandler }   = require("./middleware/error.middleware");
const { initSocket }     = require("./socket");

const app  = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── Security ──────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use("/uploads", cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }),
  express.static(path.join(__dirname, "..", "uploads")));

// ── Rate limiting ─────────────────────────────────────────
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
  message: { success: false, message: "Too many auth requests, please try again later." } }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 300,
  message: { success: false, message: "Rate limit exceeded." } }));

// ── Body parsing ──────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// ── Static uploads ────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ── Health check ──────────────────────────────────────────
app.get("/health", (req, res) =>
  res.json({ status: "ok", env: process.env.NODE_ENV, ts: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/projects",      projectRoutes);
app.use("/api/tasks",         taskRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/invitations",   invitationRoutes);
app.use("/api/requests",      requestRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` }));

// ── Global error handler ──────────────────────────────────
app.use(errorHandler);

// ── Real-time (Socket.IO) ────────────────────────────────
initSocket(httpServer);

// ── Start ─────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🚀  CollabFlow API running on http://localhost:${PORT}`);
  console.log(`🔌  Socket.IO ready for real-time connections`);
  console.log(`📄  Env: ${process.env.NODE_ENV}`);
});

module.exports = app;
