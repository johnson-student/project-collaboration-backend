const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { userRepository } = require("../repositories");
const { ok, created, fail } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { signAccess, signRefresh } = require("../middleware/auth.middleware");
const { sendVerificationEmail } = require("../utils/email");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";

// SameSite=None requires Secure, which browsers reject on plain-HTTP localhost —
// use Lax in dev (localhost:5173 → localhost:3000 is same-site, so Lax works)
const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
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
  await userRepository.updateById(userId, {
    verify_token: token,
    verify_token_expires: expires,
  });
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

  const existing = await userRepository.findByEmail(email.toLowerCase());
  if (existing) return fail(res, "Email already registered", 409);

  const hash = await bcrypt.hash(password, 12);
  const initials = generateInitials(name);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  const user = await userRepository.create({
    name: name.trim(),
    email: email.toLowerCase(),
    password_hash: hash,
    initials,
    color,
    status: "Active",
    email_verified: false,
  });

  const token = await issueVerificationToken(user.id);
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

  const user = await userRepository.findByEmail(email.toLowerCase());
  if (!user) return fail(res, "Invalid credentials", 401);

  if (!user.password_hash)
    return fail(res, "This account uses Google Sign-In — click 'Sign in with Google' instead", 400);

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
  await userRepository.updateById(user.id, {
    refresh_token: hashedRefresh,
    status: "Active",
  });
  user.status = "Active";

  setRefreshCookie(res, refreshToken);
  ok(res, { user: safeUser(user), accessToken });
});

// ── POST /api/auth/google ────────────────────────────────────────────────
// The frontend uses Google's OAuth2 token-client (a custom-styled button)
// rather than the pre-rendered GIS credential button, so we receive an
// access token here instead of a signed ID token. getTokenInfo() confirms
// Google issued it for OUR client id (without this check, an access token
// minted for a completely different app — with overlapping scopes — could
// be replayed here to impersonate that account holder), then userinfo
// fetches the profile the token authorizes.
const googleLogin = asyncHandler(async (req, res) => {
  const { accessToken: googleAccessToken } = req.body;
  if (!googleAccessToken) return fail(res, "Google access token is required", 400);

  let tokenInfo;
  try {
    tokenInfo = await googleClient.getTokenInfo(googleAccessToken);
  } catch {
    return fail(res, "Invalid Google credential", 401);
  }
  if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID)
    return fail(res, "Invalid Google credential", 401);

  let profile;
  try {
    const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    if (!resp.ok) throw new Error("userinfo request failed");
    profile = await resp.json();
  } catch {
    return fail(res, "Could not verify Google account", 401);
  }

  const { sub: googleId, email, name, email_verified: googleEmailVerified } = profile;
  if (!email || !googleEmailVerified)
    return fail(res, "Google account email is not verified", 401);

  let user = await userRepository.findByGoogleId(googleId);

  if (!user) {
    // Google has already verified ownership of this email, so an existing
    // password-based account with the same address is safe to link rather
    // than reject or duplicate.
    const existing = await userRepository.findByEmail(email.toLowerCase());
    if (existing) {
      await userRepository.updateById(existing.id, {
        google_id: googleId,
        email_verified: true,
      });
      user = await userRepository.findById(existing.id);
    } else {
      const initials = generateInitials(name || email);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      user = await userRepository.create({
        name: (name || email.split("@")[0]).trim(),
        email: email.toLowerCase(),
        google_id: googleId,
        password_hash: null,
        initials,
        color,
        status: "Active",
        email_verified: true,
      });
    }
  }

  const accessToken = signAccess({ id: user.id });
  const refreshToken = signRefresh({ id: user.id });
  const hashedRefresh = await bcrypt.hash(refreshToken, 8);
  await userRepository.updateById(user.id, {
    refresh_token: hashedRefresh,
    status: "Active",
  });
  user.status = "Active";

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

  const user = await userRepository.findById(decoded.id);
  if (!user) return fail(res, "User not found", 401);

  const valid =
    user.refresh_token &&
    (await bcrypt.compare(refreshToken, user.refresh_token));
  if (!valid) return fail(res, "Refresh token revoked", 401);

  const newAccess = signAccess({ id: user.id });
  const newRefresh = signRefresh({ id: user.id });
  const hashed = await bcrypt.hash(newRefresh, 8);
  await userRepository.updateById(user.id, { refresh_token: hashed });

  setRefreshCookie(res, newRefresh);
  ok(res, { accessToken: newAccess });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────
const logout = asyncHandler(async (req, res) => {
  // req.user attached by protect middleware
  await userRepository.updateById(req.user.id, { refresh_token: null });
  clearRefreshCookie(res);
  ok(res, null, "Logged out");
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────
const getMe = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id, {
    attributes: ["id", "name", "email", "role", "avatar", "initials", "color", "status", "joined_at"],
  });
  if (!user) return fail(res, "User not found", 404);
  ok(res, user);
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  // Always return 200 to prevent email enumeration
  const user = await userRepository.findByEmail(email?.toLowerCase() || "");
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await userRepository.updateById(user.id, {
      reset_token: token,
      reset_token_expires: expires,
    });
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

  const user = await userRepository.findByValidResetToken(token);
  if (!user)
    return fail(res, "Reset token is invalid or has expired", 400);

  const hash = await bcrypt.hash(password, 12);
  await userRepository.updateById(user.id, {
    password_hash: hash,
    reset_token: null,
    reset_token_expires: null,
    refresh_token: null,
  });
  clearRefreshCookie(res);
  ok(res, null, "Password reset successfully — please sign in again");
});

// ── POST /api/auth/verify-email ─────────────────────────────────────────
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return fail(res, "Verification token is required", 400);

  const user = await userRepository.findByValidVerifyToken(token);
  if (!user)
    return fail(res, "Verification link is invalid or has expired", 400);

  await userRepository.updateById(user.id, {
    email_verified: true,
    verify_token: null,
    verify_token_expires: null,
  });
  ok(res, null, "Email verified successfully — you can now sign in");
});

// ── POST /api/auth/resend-verification ──────────────────────────────────
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  // Always return 200 to prevent email enumeration
  const user = await userRepository.findByEmail(email?.toLowerCase() || "");
  if (user && !user.email_verified) {
    const token = await issueVerificationToken(user.id);
    try {
      await sendVerificationEmail(email.toLowerCase(), user.name, buildVerifyUrl(token));
    } catch (err) {
      console.error("[email] failed to send verification email:", err.message);
    }
  }
  ok(res, null, "If that email is registered and unverified, a new link has been sent");
});

module.exports = {
  register,
  login,
  googleLogin,
  refresh,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
};
