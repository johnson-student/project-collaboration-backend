-- ============================================================
-- CollabFlow  —  Migration 001: Security & Membership Overhaul
-- Run this ONCE against your existing database.
-- Safe to run on a fresh database too.
-- ============================================================

-- ── 0. Housekeeping ─────────────────────────────────────────
SET FOREIGN_KEY_CHECKS = 0;

-- ── 1. USERS — add security columns if missing ──────────────
ALTER TABLE users
  MODIFY COLUMN status ENUM('Active','Away','Busy','Offline') NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS refresh_token     TEXT         NULL,
  ADD COLUMN IF NOT EXISTS reset_token       VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS reset_token_expires DATETIME  NULL,
  ADD COLUMN IF NOT EXISTS joined_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Index for reset-token lookups
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);

-- ── 2. PROJECTS — add owner_id if missing ───────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id INT NULL,
  ADD COLUMN IF NOT EXISTS color    VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS icon     VARCHAR(10) NOT NULL DEFAULT '🚀',
  ADD COLUMN IF NOT EXISTS category VARCHAR(64) NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS progress TINYINT UNSIGNED NOT NULL DEFAULT 0;

-- Back-fill owner_id from existing creator/user_id column if it exists
-- (Adjust 'creator_id' to whatever your current column name is)
UPDATE projects p
  JOIN (
    SELECT project_id, user_id FROM project_members WHERE role = 'Owner' LIMIT 1
  ) AS pm ON pm.project_id = p.id
  SET p.owner_id = pm.user_id
  WHERE p.owner_id IS NULL;

ALTER TABLE projects
  MODIFY COLUMN owner_id INT NOT NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_projects_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── 3. PROJECT_MEMBERS — create if missing ──────────────────
CREATE TABLE IF NOT EXISTS project_members (
  project_id  INT       NOT NULL,
  user_id     INT       NOT NULL,
  role        ENUM('Owner','Admin','Member','Viewer') NOT NULL DEFAULT 'Member',
  joined_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);

-- Ensure every project has its owner as a member
INSERT IGNORE INTO project_members (project_id, user_id, role)
  SELECT id, owner_id, 'Owner' FROM projects WHERE owner_id IS NOT NULL;

-- ── 4. TASKS — add reporter_id, position, enforce project FK ─
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reporter_id     INT NULL,
  ADD COLUMN IF NOT EXISTS position        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS actual_hours    DECIMAL(5,2) NULL;

-- Back-fill reporter_id to owner of the project where possible
UPDATE tasks t
  JOIN projects p ON p.id = t.project_id
  SET t.reporter_id = p.owner_id
  WHERE t.reporter_id IS NULL;

ALTER TABLE tasks
  ADD CONSTRAINT IF NOT EXISTS fk_tasks_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;

-- Enforce: task assignee must be a member of the project
-- (Runtime enforcement is in the controller; this constraint is advisory)
-- We cannot do this as a DB-level FK without a check constraint in MySQL 8+:
-- (MySQL 8.0.16+ supports CHECK constraints but they can't reference other tables)
-- So we rely on application-level enforcement (assertAssigneeIsMember).

-- ── 5. TAGS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_tag_label (label)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INT NOT NULL,
  tag_id  INT NOT NULL,
  PRIMARY KEY (task_id, tag_id),
  CONSTRAINT fk_tt_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_tag  FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

-- ── 6. TASK_COMMENTS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  task_id    INT       NOT NULL,
  user_id    INT       NOT NULL,
  body       TEXT      NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 7. NOTIFICATIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  type       VARCHAR(64)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT         NOT NULL,
  action_url VARCHAR(255) NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);

-- ── 8. Useful indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_pm_user         ON project_members (user_id);

SET FOREIGN_KEY_CHECKS = 1;

-- ── 9. Verification queries (run manually to confirm) ───────
-- SELECT 'projects with owner_id NULL' AS check_name, COUNT(*) AS issues FROM projects WHERE owner_id IS NULL;
-- SELECT 'projects missing owner in members' AS check_name, COUNT(*) AS issues
--   FROM projects p WHERE NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.role='Owner');
-- SELECT 'tasks with non-member assignee' AS check_name, COUNT(*) AS issues
--   FROM tasks t WHERE t.assignee_id IS NOT NULL AND t.project_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=t.assignee_id);
