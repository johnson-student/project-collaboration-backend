-- ============================================================
--  CollabFlow Migration 003 — Project Chat
-- ============================================================

USE collabflow;

CREATE TABLE IF NOT EXISTS project_messages (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  body         TEXT         NOT NULL,
  edited       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_pmsg_project (project_id, created_at),
  INDEX idx_pmsg_user    (user_id),
  CONSTRAINT fk_pmsg_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pmsg_user    FOREIGN KEY (user_id)    REFERENCES users    (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
