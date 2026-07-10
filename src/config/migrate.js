// Idempotent schema migrations — safe to run multiple times.
// Usage: npm run db:migrate
const db = require("./db");

const tableExists = async (table) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return rows[0].cnt > 0;
};

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

  // ── Chat attachments ────────────────────────────────────────────────
  if (!(await columnExists("project_messages", "attachment_id"))) {
    await db.query(
      `ALTER TABLE project_messages
         ADD COLUMN attachment_id INT UNSIGNED NULL DEFAULT NULL AFTER body,
         ADD INDEX idx_pmsg_attachment (attachment_id),
         ADD CONSTRAINT fk_pmsg_attachment FOREIGN KEY (attachment_id)
           REFERENCES project_files (id) ON DELETE SET NULL`,
    );
    console.log("✅  Added project_messages.attachment_id");
  }

  // ── AI assistant chat history ───────────────────────────────────────
  if (!(await tableExists("ai_messages"))) {
    await db.query(
      `CREATE TABLE ai_messages (
         id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
         project_id    INT UNSIGNED  NOT NULL,
         user_id       INT UNSIGNED  NOT NULL,
         role          ENUM('user','assistant') NOT NULL,
         message_type  ENUM('text','tasks','clarification') NOT NULL DEFAULT 'text',
         content       MEDIUMTEXT    NOT NULL,
         created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (id),
         INDEX idx_ai_project_user (project_id, user_id),
         CONSTRAINT fk_ai_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
         CONSTRAINT fk_ai_user    FOREIGN KEY (user_id)    REFERENCES users (id)    ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    console.log("✅  Created ai_messages table");
  }

  console.log("✅  Migrations complete");
  process.exit(0);
};

migrate().catch((err) => {
  console.error("❌  Migration failed:", err.message);
  process.exit(1);
});
