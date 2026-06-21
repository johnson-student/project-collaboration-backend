-- ============================================================
--  CollabFlow Migration 002 — New Features
--  Tasks 1-4+6: Invitations, Task Requests, Files, Activity, Comments
-- ============================================================

USE collabflow;

-- ============================================================
-- 1. PROJECT INVITATIONS (Task 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_invitations (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED NOT NULL,
  inviter_id   INT UNSIGNED NOT NULL,
  invitee_id   INT UNSIGNED NOT NULL,
  role         ENUM('Admin','Member','Viewer') NOT NULL DEFAULT 'Member',
  status       ENUM('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pi (project_id, invitee_id),
  INDEX idx_pi_invitee (invitee_id),
  INDEX idx_pi_project (project_id),
  INDEX idx_pi_status  (status),
  CONSTRAINT fk_pi_project  FOREIGN KEY (project_id)  REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_inviter  FOREIGN KEY (inviter_id)  REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_invitee  FOREIGN KEY (invitee_id)  REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. TASK ASSIGNMENT REQUESTS (Task 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignment_requests (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id      INT UNSIGNED NOT NULL,
  requester_id INT UNSIGNED NOT NULL,
  assignee_id  INT UNSIGNED NOT NULL,
  status       ENUM('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tar_task     (task_id),
  INDEX idx_tar_assignee (assignee_id),
  INDEX idx_tar_status   (status),
  CONSTRAINT fk_tar_task      FOREIGN KEY (task_id)      REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_tar_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_tar_assignee  FOREIGN KEY (assignee_id)  REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. PROJECT FILES (Task 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_files (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED  NOT NULL,
  uploader_id  INT UNSIGNED  NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  stored_name  VARCHAR(500)  NOT NULL,
  mime_type    VARCHAR(200)  NOT NULL,
  size_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_pf_project  (project_id),
  INDEX idx_pf_uploader (uploader_id),
  CONSTRAINT fk_pf_project  FOREIGN KEY (project_id)  REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pf_uploader FOREIGN KEY (uploader_id) REFERENCES users    (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. ACTIVITY LOG (Task 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED     NULL,
  event_type   VARCHAR(60)  NOT NULL COMMENT 'project_created|member_invited|member_joined|member_removed|task_created|task_assigned|task_completed|file_uploaded|file_deleted|comment_added',
  description  TEXT         NOT NULL,
  meta         JSON             NULL COMMENT 'Extra structured data (task_id, file_id, etc.)',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_al_project (project_id),
  INDEX idx_al_user    (user_id),
  INDEX idx_al_created (created_at),
  CONSTRAINT fk_al_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_al_user    FOREIGN KEY (user_id)    REFERENCES users    (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. ADD reference_id / reference_type to notifications
--    for actionable notifications (Task 5)
-- ============================================================
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS reference_id   INT UNSIGNED NULL DEFAULT NULL AFTER action_url,
  ADD COLUMN IF NOT EXISTS reference_type VARCHAR(60)  NULL DEFAULT NULL AFTER reference_id;
