const express = require("express");
const router  = express.Router();
const rateLimit = require("express-rate-limit");
const { register, login, refresh, logout, getMe, forgotPassword, resetPassword } = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");

// Strict rate-limit on auth endpoints (15 req / 15 min per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: "Too many requests — try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register",        authLimiter, register);
router.post("/login",           authLimiter, login);
router.post("/refresh",         authLimiter, refresh);
router.post("/logout",          protect,     logout);
router.get ("/me",              protect,     getMe);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password",  authLimiter, resetPassword);

module.exports = router;
