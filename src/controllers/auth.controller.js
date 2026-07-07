const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../config/db");
const { ok, created, fail } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { signAccess, signRefresh } = require("../middleware/auth.middleware");
const { sendVerificationEmail } = require("../utils/email");

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  path: "/api/auth",
  maxAge: REFRESH_COOKIE_MAX_AGE,
};

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions);
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...refreshCookieOptions,
    maxAge: undefined,
  });
};

const getRefreshTokenFromCookie = (req) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));

  if (!cookie) return null;

  return decodeURIComponent(cookie.slice(REFRESH_COOKIE_NAME.length + 1));
};

// Whitelist of columns returned to the client — never expose password_hash etc.
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatar: u.avatar,
  initials: u.initials,
  color: u.color,
  status: u.status,
});

const generateInitials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 2);

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
];

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const issueVerificationToken = async (userId) => {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  await db.query(
    "UPDATE users SET verify_token = ?, verify_token_expires = ? WHERE id = ?",
    [token, expires, userId],
  );
  return token;
};

const buildVerifyUrl = (token) =>
  `${process.env.CLIENT_URL || "http://localhost:5173"}/verify-email?token=${token}`;

// ── POST /api/auth/register ──────────────────────────────────────────────
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return fail(res, "name, email and password are required", 400);
  if (password.length < 8)
    return fail(res, "Password must be at least 8 characters", 400);

  const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
    email.toLowerCase(),
  ]);
  if (existing.length) return fail(res, "Email already registered", 409);

  const hash = await bcrypt.hash(password, 12);
  const initials = generateInitials(name);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  const [result] = await db.query(
    `INSERT INTO users (name, email, password_hash, initials, color, status, email_verified)
     VALUES (?,?,?,?,?,'Active',0)`,
    [name.trim(), email.toLowerCase(), hash, initials, color],
  );

  const token = await issueVerificationToken(result.insertId);
  try {
    await sendVerificationEmail(email.toLowerCase(), name.trim(), buildVerifyUrl(token));
  } catch (err) {
    console.error("[email] failed to send verification email:", err.message);
  }

  created(
    res,
    { requiresVerification: true, email: email.toLowerCase() },
    "Account created — check your email to verify your address",
  );
});

// ── POST /api/auth/login ─────────────────────────────────────────────────
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return fail(res, "Email and password are required", 400);

  const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [
    email.toLowerCase(),
  ]);
  if (!rows.length) return fail(res, "Invalid credentials", 401);

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return fail(res, "Invalid credentials", 401);

  if (!user.email_verified)
    return fail(
      res,
      "Please verify your email address before signing in. Check your inbox for the verification link.",
      403,
    );

  const accessToken = signAccess({ id: user.id });
  const refreshToken = signRefresh({ id: user.id });
  const hashedRefresh = await bcrypt.hash(refreshToken, 8);
  await db.query(
    "UPDATE users SET refresh_token = ?, status = 'Active' WHERE id = ?",
    [hashedRefresh, user.id],
  );

  setRefreshCookie(res, refreshToken);
  ok(res, { user: safeUser(user), accessToken });
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = getRefreshTokenFromCookie(req);
  if (!refreshToken) return fail(res, "Refresh token required", 400);

  let decoded;
  try {
    const jwt = require("jsonwebtoken");
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return fail(res, "Invalid or expired refresh token", 401);
  }

  const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [
    decoded.id,
  ]);
  if (!rows.length) return fail(res, "User not found", 401);

  const user = rows[0];
  const valid =
    user.refresh_token &&
    (await bcrypt.compare(refreshToken, user.refresh_token));
  if (!valid) return fail(res, "Refresh token revoked", 401);

  const newAccess = signAccess({ id: user.id });
  const newRefresh = signRefresh({ id: user.id });
  const hashed = await bcrypt.hash(newRefresh, 8);
  await db.query("UPDATE users SET refresh_token = ? WHERE id = ?", [
    hashed,
    user.id,
  ]);

  setRefreshCookie(res, newRefresh);
  ok(res, { accessToken: newAccess });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────
const logout = asyncHandler(async (req, res) => {
  // req.user attached by protect middleware
  await db.query("UPDATE users SET refresh_token = NULL WHERE id = ?", [
    req.user.id,
  ]);
  clearRefreshCookie(res);
  ok(res, null, "Logged out");
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────
const getMe = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT id,name,email,role,avatar,initials,color,status,joined_at FROM users WHERE id = ?",
    [req.user.id],
  );
  if (!rows.length) return fail(res, "User not found", 404);
  ok(res, rows[0]);
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  // Always return 200 to prevent email enumeration
  const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [
    email?.toLowerCase(),
  ]);
  if (rows.length) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.query(
      "UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?",
      [token, expires, rows[0].id],
    );
    // In production: sendPasswordResetEmail(email, token)
    console.info(`[password-reset] token for ${email}: ${token}`);
  }
  ok(res, null, "If that email exists, a reset link has been sent");
});

// ── POST /api/auth/reset-password ───────────────────────────────────────
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return fail(res, "Token and new password are required", 400);
  if (password.length < 8)
    return fail(res, "Password must be at least 8 characters", 400);

  const [rows] = await db.query(
    "SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()",
    [token],
  );
  if (!rows.length)
    return fail(res, "Reset token is invalid or has expired", 400);

  const hash = await bcrypt.hash(password, 12);
  await db.query(
    "UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, refresh_token = NULL WHERE id = ?",
    [hash, rows[0].id],
  );
  clearRefreshCookie(res);
  ok(res, null, "Password reset successfully — please sign in again");
});

// ── POST /api/auth/verify-email ─────────────────────────────────────────
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return fail(res, "Verification token is required", 400);

  const [rows] = await db.query(
    "SELECT id, email_verified FROM users WHERE verify_token = ? AND verify_token_expires > NOW()",
    [token],
  );
  if (!rows.length)
    return fail(res, "Verification link is invalid or has expired", 400);

  await db.query(
    "UPDATE users SET email_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?",
    [rows[0].id],
  );
  ok(res, null, "Email verified successfully — you can now sign in");
});

// ── POST /api/auth/resend-verification ──────────────────────────────────
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  // Always return 200 to prevent email enumeration
  const [rows] = await db.query(
    "SELECT id, name, email_verified FROM users WHERE email = ?",
    [email?.toLowerCase()],
  );
  if (rows.length && !rows[0].email_verified) {
    const token = await issueVerificationToken(rows[0].id);
    try {
      await sendVerificationEmail(email.toLowerCase(), rows[0].name, buildVerifyUrl(token));
    } catch (err) {
      console.error("[email] failed to send verification email:", err.message);
    }
  }
  ok(res, null, "If that email is registered and unverified, a new link has been sent");
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
};
