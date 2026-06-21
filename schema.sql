-- ============================================================
--  CollabFlow Database Schema
--  MySQL 8.0+
--  Run:  mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS collabflow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE collabflow;

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE users (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100)     NOT NULL,
  email         VARCHAR(191)     NOT NULL,
  password_hash VARCHAR(255)     NOT NULL,
  role          VARCHAR(100)     NOT NULL DEFAULT 'Member',
  avatar        VARCHAR(500)         NULL DEFAULT NULL,
  initials      VARCHAR(4)           NULL,
  color         VARCHAR(7)       NOT NULL DEFAULT '#6366f1',
  status        ENUM('Active','Away','Busy','Offline') NOT NULL DEFAULT 'Offline',
  joined_at     DATE                 NULL,
  refresh_token VARCHAR(500)         NULL DEFAULT NULL,
  reset_token   VARCHAR(255)         NULL DEFAULT NULL,
  reset_token_expires DATETIME       NULL DEFAULT NULL,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  INDEX idx_users_status (status),
  INDEX idx_users_reset_token (reset_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. PROJECTS
-- ============================================================
CREATE TABLE projects (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name          VARCHAR(200)     NOT NULL,
  description   TEXT                 NULL,
  status        ENUM('Planning','In Progress','Review','Completed','On Hold')
                                 NOT NULL DEFAULT 'Planning',
  priority      ENUM('High','Medium','Low') NOT NULL DEFAULT 'Medium',
  progress      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-100',
  deadline      DATE                 NULL,
  color         VARCHAR(7)       NOT NULL DEFAULT '#6366f1',
  icon          VARCHAR(10)      NOT NULL DEFAULT '🚀',
  category      VARCHAR(100)     NOT NULL DEFAULT 'General',
  owner_id      INT UNSIGNED     NOT NULL,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_projects_owner   (owner_id),
  INDEX idx_projects_status  (status),
  INDEX idx_projects_priority(priority),
  INDEX idx_projects_deadline(deadline),
  CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. PROJECT MEMBERS  (many-to-many)
-- ============================================================
CREATE TABLE project_members (
  project_id    INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  role          ENUM('Owner','Admin','Member','Viewer') NOT NULL DEFAULT 'Member',
  joined_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (project_id, user_id),
  INDEX idx_pm_user (user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. TASKS
-- ============================================================
CREATE TABLE tasks (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  title           VARCHAR(300)     NOT NULL,
  description     TEXT                 NULL,
  status          ENUM('Todo','In Progress','Review','Done') NOT NULL DEFAULT 'Todo',
  priority        ENUM('High','Medium','Low') NOT NULL DEFAULT 'Medium',
  project_id      INT UNSIGNED         NULL,
  assignee_id     INT UNSIGNED         NULL,
  reporter_id     INT UNSIGNED         NULL,
  due_date        DATE                 NULL,
  estimated_hours DECIMAL(6,2)         NULL,
  actual_hours    DECIMAL(6,2)         NULL,
  position        INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Kanban sort order',
  created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tasks_project    (project_id),
  INDEX idx_tasks_assignee   (assignee_id),
  INDEX idx_tasks_reporter   (reporter_id),
  INDEX idx_tasks_status     (status),
  INDEX idx_tasks_priority   (priority),
  INDEX idx_tasks_due_date   (due_date),
  CONSTRAINT fk_tasks_project  FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_reporter FOREIGN KEY (reporter_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. TASK TAGS  (many-to-many via label string)
-- ============================================================
CREATE TABLE tags (
  id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  label VARCHAR(60)   NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_tags (
  task_id INT UNSIGNED NOT NULL,
  tag_id  INT UNSIGNED NOT NULL,

  PRIMARY KEY (task_id, tag_id),
  INDEX idx_tt_tag (tag_id),
  CONSTRAINT fk_tt_task FOREIGN KEY (task_id)
    REFERENCES tasks (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tt_tag FOREIGN KEY (tag_id)
    REFERENCES tags (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 6. TASK COMMENTS
-- ============================================================
CREATE TABLE task_comments (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  body       TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tc_task (task_id),
  INDEX idx_tc_user (user_id),
  CONSTRAINT fk_tc_task FOREIGN KEY (task_id)
    REFERENCES tasks (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tc_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 7. NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  action_url VARCHAR(500) NULL,

  reference_id INT UNSIGNED NULL,
  reference_type VARCHAR(60) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
);

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


-- ============================================================
-- 8. SEED DATA
-- ============================================================

-- Users (passwords are bcrypt of "password123")
INSERT INTO users (id, name, email, password_hash, role, initials, color, status, joined_at) VALUES
(1, 'Alex Rivera',    'alex.rivera@collabflow.io',   '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'Product Manager',    'AR', '#6366f1', 'Active',  '2024-01-15'),
(2, 'Sophia Chen',    'sophia.chen@collabflow.io',   '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'Lead Designer',       'SC', '#8b5cf6', 'Active',  '2024-02-03'),
(3, 'Marcus Williams','marcus.w@collabflow.io',      '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'Senior Developer',    'MW', '#06b6d4', 'Away',    '2024-01-20'),
(4, 'Priya Patel',    'priya.patel@collabflow.io',   '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'Backend Engineer',    'PP', '#f59e0b', 'Offline', '2024-03-10'),
(5, 'Jordan Kim',     'jordan.kim@collabflow.io',    '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'Frontend Developer',  'JK', '#10b981', 'Active',  '2024-02-18'),
(6, 'Elena Vasquez',  'elena.v@collabflow.io',       '$2a$12$KXEOa/3uMV.qHjr6g0N1.eZd2z3FnpzPjSR9mm2b3RYq5ar2j/7uG', 'QA Engineer',         'EV', '#ef4444', 'Active',  '2024-03-22');
 
-- Projects
INSERT INTO projects (id, name, description, status, priority, progress, deadline, color, icon, category, owner_id, created_at) VALUES
(1, 'CollabFlow Platform',   'Build the next-generation project collaboration platform with real-time features, AI-powered insights, and seamless integrations.', 'In Progress', 'High',   65, '2026-08-15', '#6366f1', '🚀', 'Product',     1, '2026-01-10'),
(2, 'Design System v2',      'Rebuild our component library from scratch with Figma tokens, accessibility improvements, and a comprehensive documentation site.', 'In Progress', 'Medium', 42, '2026-07-30', '#8b5cf6', '🎨', 'Design',      2, '2026-02-05'),
(3, 'API Gateway Migration', 'Migrate legacy REST endpoints to GraphQL, implement rate limiting, caching layers, and comprehensive API documentation.',             'Review',      'High',   88, '2026-06-20', '#06b6d4', '⚡', 'Engineering', 3, '2026-01-25'),
(4, 'Mobile App Launch',     'Launch iOS and Android apps with offline support, push notifications, and feature parity with the web platform.',                    'Planning',    'High',   15, '2026-10-01', '#f59e0b', '📱', 'Product',     1, '2026-03-15'),
(5, 'Analytics Dashboard',   'Build a data analytics dashboard with custom charts, export capabilities, and real-time metrics for enterprise customers.',           'Completed',   'Low',   100, '2026-05-01', '#10b981', '📊', 'Engineering', 1, '2025-12-01'),
(6, 'Security Audit',        'Comprehensive security audit including penetration testing, OWASP compliance, and SOC 2 certification preparation.',                  'On Hold',     'Medium', 30, '2026-09-01', '#ef4444', '🔒', 'Security',    3, '2026-02-20');

-- Project Members
INSERT INTO project_members (project_id, user_id, role) VALUES
(1,1,'Owner'),(1,2,'Member'),(1,3,'Member'),(1,5,'Member'),
(2,2,'Owner'),(2,5,'Member'),(2,6,'Member'),
(3,3,'Owner'),(3,4,'Member'),(3,1,'Member'),
(4,1,'Owner'),(4,2,'Member'),(4,3,'Member'),(4,4,'Member'),(4,5,'Member'),
(5,1,'Owner'),(5,3,'Member'),(5,4,'Member'),
(6,3,'Owner'),(6,4,'Member'),(6,6,'Member');

-- Tags
INSERT INTO tags (id, label) VALUES
(1,'backend'),(2,'auth'),(3,'design'),(4,'ux'),(5,'realtime'),
(6,'frontend'),(7,'component'),(8,'docs'),(9,'performance'),
(10,'design-system'),(11,'tokens'),(12,'forms'),(13,'storybook'),
(14,'graphql'),(15,'security'),(16,'cache'),(17,'ui');

-- Tasks
INSERT INTO tasks (id, title, description, status, priority, project_id, assignee_id, reporter_id, due_date, estimated_hours, position, created_at) VALUES
(1,  'Set up authentication flow',         'Implement JWT-based auth with refresh tokens and OAuth2 providers',              'Done',        'High',   1, 3, 1, '2026-06-10', 8,  1, '2026-05-01'),
(2,  'Design onboarding screens',          'Create Figma mockups for user onboarding with smooth animations',                'Done',        'Medium', 1, 2, 1, '2026-06-05', 12, 2, '2026-05-02'),
(3,  'Implement real-time notifications',  'WebSocket-based notification system with read/unread state management',          'In Progress', 'High',   1, 3, 1, '2026-06-20', 16, 1, '2026-05-10'),
(4,  'Build Kanban board component',       'Drag-and-drop Kanban with customizable columns and task cards',                  'In Progress', 'High',   1, 5, 1, '2026-06-18', 20, 2, '2026-05-12'),
(5,  'Write API documentation',            'OpenAPI 3.0 spec with Swagger UI for all endpoints',                            'Todo',        'Low',    1, 1, 1, '2026-07-01', 6,  1, '2026-05-15'),
(6,  'Performance optimization',           'Code splitting, lazy loading, and bundle size reduction',                        'Todo',        'Medium', 1, 5, 1, '2026-07-10', 10, 2, '2026-05-16'),
(7,  'Define color tokens',                'Create semantic color system with dark/light mode support',                      'Done',        'High',   2, 2, 2, '2026-06-01', 4,  1, '2026-04-20'),
(8,  'Build Button component',             'All variants: primary, secondary, ghost, destructive with states',               'Done',        'High',   2, 5, 2, '2026-06-08', 6,  2, '2026-04-25'),
(9,  'Create form components',             'Input, Select, Checkbox, Radio, Textarea with validation states',                'In Progress', 'High',   2, 5, 2, '2026-06-25', 14, 1, '2026-05-01'),
(10, 'Documentation site setup',           'Storybook with MDX stories and interactive playground',                          'Todo',        'Medium', 2, 2, 2, '2026-07-15', 18, 2, '2026-05-20'),
(11, 'GraphQL schema design',              'Define types, queries, mutations, and subscriptions',                            'Done',        'High',   3, 3, 3, '2026-05-15', 12, 1, '2026-04-01'),
(12, 'Rate limiting middleware',           'Redis-based rate limiting with per-user and per-IP rules',                       'Done',        'High',   3, 4, 3, '2026-05-20', 8,  2, '2026-04-05'),
(13, 'Cache layer implementation',         'Multi-level caching with Redis and in-memory fallback',                          'Review',      'Medium', 3, 4, 3, '2026-06-10', 10, 1, '2026-04-10');

-- Task Tags
INSERT INTO task_tags (task_id, tag_id) VALUES
(1,1),(1,2),(2,3),(2,4),(3,1),(3,5),(4,6),(4,7),(5,8),(6,9),(6,6),
(7,10),(7,11),(8,7),(8,17),(9,7),(9,12),(10,8),(10,13),
(11,14),(11,1),(12,1),(12,15),(13,1),(13,16);

-- Notifications
INSERT INTO notifications (id, user_id, type, title, message, is_read, action_url, created_at) VALUES
(1, 1, 'task_assigned',  'Task assigned to you',    'Marcus assigned "Implement real-time notifications" to you', 0, '/tasks/3',    '2026-06-04 09:30:00'),
(2, 1, 'comment',        'New comment on your task', 'Sophia commented on "Build Kanban board component"',         0, '/tasks/4',    '2026-06-04 08:15:00'),
(3, 1, 'deadline',       'Deadline approaching',     '"API Gateway Migration" is due in 2 days',                   0, '/projects/3', '2026-06-04 07:00:00'),
(4, 1, 'project_invite', 'Added to project',         'You were added to "Mobile App Launch" by Alex Rivera',       1, '/projects/4', '2026-06-03 14:22:00'),
(5, 1, 'task_done',      'Task completed',           'Jordan completed "Build Button component"',                  1, '/tasks/8',    '2026-06-03 11:05:00');


-- ===== Added from migrations =====


