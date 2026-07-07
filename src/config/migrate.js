// Idempotent schema migrations — safe to run multiple times.
// Usage: npm run db:migrate
const db = require("./db");

const columnExists = async (table, column) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows[0].cnt > 0;
};

const migrate = async () => {
  // ── Email verification columns ──────────────────────────────────────
  if (!(await columnExists("users", "email_verified"))) {
    await db.query(
      "ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER status",
    );
    // Grandfather accounts that existed before this feature so they
    // are not locked out of login.
    await db.query("UPDATE users SET email_verified = 1");
    console.log("✅  Added users.email_verified (existing users marked verified)");
  }
  if (!(await columnExists("users", "verify_token"))) {
    await db.query(
      "ALTER TABLE users ADD COLUMN verify_token VARCHAR(255) NULL DEFAULT NULL AFTER email_verified, ADD INDEX idx_users_verify_token (verify_token)",
    );
    console.log("✅  Added users.verify_token");
  }
  if (!(await columnExists("users", "verify_token_expires"))) {
    await db.query(
      "ALTER TABLE users ADD COLUMN verify_token_expires DATETIME NULL DEFAULT NULL AFTER verify_token",
    );
    console.log("✅  Added users.verify_token_expires");
  }

  console.log("✅  Migrations complete");
  process.exit(0);
};

migrate().catch((err) => {
  console.error("❌  Migration failed:", err.message);
  process.exit(1);
});
