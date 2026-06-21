const db     = require("../config/db");
const { ok, created, paginated, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// ── Helpers ──────────────────────────────────────────────────────────────
const attachTags = async (tasks) => {
  if (!tasks.length) return tasks;
  const ids = tasks.map((t) => t.id);
  const [rows] = await db.query(
    `SELECT tt.task_id, tg.label FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id IN (?)`,
    [ids]
  );
  const map = {};
  rows.forEach((r) => { if (!map[r.task_id]) map[r.task_id] = []; map[r.task_id].push(r.label); });
  return tasks.map((t) => ({ ...t, tags: map[t.id] || [] }));
};

const syncTags = async (conn, taskId, tagLabels) => {
  await conn.query("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
  if (!tagLabels?.length) return;
  for (const label of tagLabels) {
    const [res] = await conn.query(
      "INSERT INTO tags (label) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [label.trim().toLowerCase()]
    );
    await conn.query("INSERT IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)", [taskId, res.insertId]);
  }
};

const recalcProgress = async (projectId) => {
  if (!projectId) return;
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(status='Done') AS done FROM tasks WHERE project_id = ?",
    [projectId]
  );
  const progress = row.total ? Math.round((Number(row.done) / Number(row.total)) * 100) : 0;
  await db.query("UPDATE projects SET progress = ? WHERE id = ?", [progress, projectId]);
};

// FIXED: verify assignee is a member of the given project
const assertAssigneeIsMember = async (projectId, assigneeId) => {
  if (!projectId || !assigneeId) return; // unassigned or no-project tasks are fine
  const [rows] = await db.query(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, assigneeId]
  );
  if (!rows.length) throw Object.assign(new Error("Assignee is not a member of this project"), { status: 400 });
};

// FIXED: verify caller is a member of the task's project
const assertCallerIsMember = async (projectId, userId) => {
  if (!projectId) return;
  const [rows] = await db.query(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (!rows.length) throw Object.assign(new Error("Access denied — not a project member"), { status: 403 });
};

// ── GET /api/tasks — scoped to projects the user belongs to ──────────────
const getTasks = asyncHandler(async (req, res) => {
  const { projectId, status, priority, assigneeId, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // FIXED: always restrict to projects the requesting user is a member of.
  // If projectId is supplied it must also be one they belong to.
  let where = `WHERE (t.project_id IS NULL OR EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?
  ))`;
  const params = [req.user.id];

  if (projectId) { where += " AND t.project_id = ?"; params.push(projectId); }
  if (status)    { where += " AND t.status = ?";      params.push(status); }
  if (priority)  { where += " AND t.priority = ?";    params.push(priority); }
  if (assigneeId){ where += " AND t.assignee_id = ?"; params.push(assigneeId); }

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tasks t ${where}`, params);
  const [rows] = await db.query(
    `SELECT t.*,
            u_a.name AS assignee_name, u_a.initials AS assignee_initials,
            u_a.color AS assignee_color, u_a.avatar AS assignee_avatar,
            p.name AS project_name, p.color AS project_color, p.icon AS project_icon
     FROM tasks t
     LEFT JOIN users u_a ON u_a.id = t.assignee_id
     LEFT JOIN projects p ON p.id = t.project_id
     ${where}
     ORDER BY t.position ASC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const withTags = await attachTags(rows);
  paginated(res, { data: withTags, total, page, limit });
});

// ── GET /api/tasks/:id — verify caller has access via project membership ─
const getTaskById = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.*, u_a.name AS assignee_name, u_a.initials AS assignee_initials, u_a.color AS assignee_color,
            u_r.name AS reporter_name, p.name AS project_name, p.color AS project_color, p.icon AS project_icon
     FROM tasks t
     LEFT JOIN users u_a ON u_a.id = t.assignee_id
     LEFT JOIN users u_r ON u_r.id = t.reporter_id
     LEFT JOIN projects p  ON p.id  = t.project_id
     WHERE t.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return fail(res, "Task not found", 404);
  await assertCallerIsMember(rows[0].project_id, req.user.id);

  const [task] = await attachTags(rows);
  const [comments] = await db.query(
    `SELECT c.*, u.name AS user_name, u.initials, u.color, u.avatar
     FROM task_comments c JOIN users u ON u.id = c.user_id
     WHERE c.task_id = ? ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  task.comments = comments;
  ok(res, task);
});

// ── POST /api/tasks ──────────────────────────────────────────────────────
const createTask = asyncHandler(async (req, res) => {
  const {
    title, description, status = "Todo", priority = "Medium",
    projectId, assigneeId, dueDate, estimatedHours, tags = [],
  } = req.body;

  // Validate: creator must be a project member
  await assertCallerIsMember(projectId, req.user.id);
  // Validate: assignee must also be a project member
  await assertAssigneeIsMember(projectId, assigneeId);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ maxPos }]] = await conn.query(
      "SELECT COALESCE(MAX(position),0)+1 AS maxPos FROM tasks WHERE status = ? AND project_id <=> ?",
      [status, projectId || null]
    );
    const [result] = await conn.query(
      `INSERT INTO tasks (title, description, status, priority, project_id, assignee_id, reporter_id, due_date, estimated_hours, position)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [title, description, status, priority, projectId || null, assigneeId || null, req.user.id, dueDate || null, estimatedHours || null, maxPos]
    );
    const taskId = result.insertId;
    await syncTags(conn, taskId, tags);
    await conn.commit();

    if (assigneeId && Number(assigneeId) !== req.user.id) {
      await createNotification({
        userId: assigneeId, type: "task_assigned", title: "Task assigned to you",
        message: `${req.user.name} assigned "${title}" to you`, actionUrl: `/tasks/${taskId}`,
      });
    }
    if (projectId) {
      await recalcProgress(projectId);
      await logActivity({
        projectId: Number(projectId),
        userId: req.user.id,
        eventType: "task_created",
        description: `${req.user.name} created task "${title}"`,
        meta: { task_id: taskId },
      });
    }

    const [taskRows] = await db.query("SELECT * FROM tasks WHERE id = ?", [taskId]);
    const [task] = await attachTags(taskRows);
    created(res, task, "Task created");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── PUT /api/tasks/:id ───────────────────────────────────────────────────
const updateTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body   = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query("SELECT * FROM tasks WHERE id = ?", [id]);
    if (!existing.length) { await conn.rollback(); return fail(res, "Task not found", 404); }
    const task = existing[0];

    // Verify caller membership in the task's project
    await assertCallerIsMember(task.project_id, req.user.id);

    // If assignee is being changed, validate new assignee is a project member
    const newAssigneeId = body.assigneeId ?? body.assignee_id;
    if (newAssigneeId !== undefined) {
      await assertAssigneeIsMember(task.project_id, newAssigneeId || null);
    }

    const allowed = ["title","description","status","priority","due_date","estimated_hours","actual_hours","position","assignee_id"];
    const fields = [], vals = [];
    allowed.forEach((k) => {
      const camel = k.replace(/_([a-z])/g, (_,l) => l.toUpperCase());
      const val   = body[camel] ?? body[k];
      if (val !== undefined) { fields.push(`${k} = ?`); vals.push(val); }
    });
    if (fields.length) { vals.push(id); await conn.query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, vals); }
    if (body.tags !== undefined) await syncTags(conn, id, body.tags);
    await conn.commit();

    const projectId = task.project_id;
    if (projectId) await recalcProgress(projectId);

    const [taskRows] = await db.query("SELECT * FROM tasks WHERE id = ?", [id]);
    const [updated] = await attachTags(taskRows);
    ok(res, updated, "Task updated");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────
const deleteTask = asyncHandler(async (req, res) => {
  const [rows] = await db.query("SELECT project_id, reporter_id FROM tasks WHERE id = ?", [req.params.id]);
  if (!rows.length) return fail(res, "Task not found", 404);
  await assertCallerIsMember(rows[0].project_id, req.user.id);
  await db.query("DELETE FROM tasks WHERE id = ?", [req.params.id]);
  if (rows[0].project_id) await recalcProgress(rows[0].project_id);
  noContent(res);
});

// ── PATCH /api/tasks/:id/status — Kanban move ───────────────────────────
const moveTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ["Todo","In Progress","Review","Done"];
  if (!valid.includes(status)) return fail(res, `status must be one of: ${valid.join(", ")}`, 400);

  const [rows] = await db.query("SELECT project_id FROM tasks WHERE id = ?", [id]);
  if (!rows.length) return fail(res, "Task not found", 404);
  await assertCallerIsMember(rows[0].project_id, req.user.id);

  await db.query("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
  if (rows[0].project_id) {
    await recalcProgress(rows[0].project_id);
    if (status === "Done") {
      const [taskInfo] = await db.query("SELECT title FROM tasks WHERE id = ?", [id]);
      if (taskInfo.length) {
        await logActivity({
          projectId: rows[0].project_id,
          userId: req.user.id,
          eventType: "task_completed",
          description: `${req.user.name} completed task "${taskInfo[0].title}"`,
          meta: { task_id: Number(id) },
        });
      }
    }
  }
  const [updated] = await db.query("SELECT * FROM tasks WHERE id = ?", [id]);
  const [task] = await attachTags(updated);
  ok(res, task, "Task moved");
});

// ── PATCH /api/tasks/:id/assign ──────────────────────────────────────────
const assignTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const [rows] = await db.query("SELECT title, project_id FROM tasks WHERE id = ?", [id]);
  if (!rows.length) return fail(res, "Task not found", 404);
  const task = rows[0];

  await assertCallerIsMember(task.project_id, req.user.id);
  await assertAssigneeIsMember(task.project_id, userId || null);

  await db.query("UPDATE tasks SET assignee_id = ? WHERE id = ?", [userId || null, id]);

  if (userId && Number(userId) !== req.user.id) {
    await createNotification({
      userId, type: "task_assigned", title: "Task assigned to you",
      message: `${req.user.name} assigned "${task.title}" to you`, actionUrl: `/tasks/${id}`,
    });
  }
  ok(res, null, "Task assigned");
});

// ── GET /api/projects/:projectId/tasks ───────────────────────────────────
// Note: requireProjectMember runs on this route in routes file
const getTasksByProject = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.*, u.name AS assignee_name, u.initials AS assignee_initials, u.color AS assignee_color
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = ?
     ORDER BY t.position ASC, t.created_at DESC`,
    [req.params.projectId]
  );
  const withTags = await attachTags(rows);
  ok(res, withTags);
});

// ── POST /api/tasks/:id/comments ─────────────────────────────────────────
const addComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  const [rows] = await db.query("SELECT title, assignee_id, project_id FROM tasks WHERE id = ?", [id]);
  if (!rows.length) return fail(res, "Task not found", 404);
  await assertCallerIsMember(rows[0].project_id, req.user.id);

  const [result] = await db.query(
    "INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)",
    [id, req.user.id, comment]
  );
  const task = rows[0];
  if (task.assignee_id && task.assignee_id !== req.user.id) {
    await createNotification({
      userId: task.assignee_id, type: "comment", title: "New comment on your task",
      message: `${req.user.name} commented on "${task.title}"`, actionUrl: `/tasks/${id}`,
    });
  }
  const [newComment] = await db.query(
    `SELECT c.*, u.name AS user_name, u.initials, u.color, u.avatar
     FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [result.insertId]
  );
  if (task.project_id) {
    await logActivity({
      projectId: task.project_id,
      userId: req.user.id,
      eventType: "comment_added",
      description: `${req.user.name} commented on "${task.title}"`,
      meta: { task_id: Number(id) },
    });
  }
  created(res, newComment[0], "Comment added");
});


// ── PUT /api/tasks/:id/comments/:commentId ───────────────────────────────
const editComment = asyncHandler(async (req, res) => {
  const { id, commentId } = req.params;
  const { comment } = req.body;
  if (!comment?.trim()) return fail(res, "Comment body is required", 400);

  const [rows] = await db.query(
    "SELECT c.*, t.project_id FROM task_comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = ? AND c.task_id = ?",
    [commentId, id]
  );
  if (!rows.length) return fail(res, "Comment not found", 404);
  if (rows[0].user_id !== req.user.id) return fail(res, "Cannot edit another user's comment", 403);

  await db.query("UPDATE task_comments SET body = ? WHERE id = ?", [comment, commentId]);
  const [updated] = await db.query(
    `SELECT c.*, u.name AS user_name, u.initials, u.color, u.avatar
     FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [commentId]
  );
  ok(res, updated[0], "Comment updated");
});

// ── DELETE /api/tasks/:id/comments/:commentId ────────────────────────────
const deleteComment = asyncHandler(async (req, res) => {
  const { id, commentId } = req.params;
  const [rows] = await db.query(
    "SELECT user_id FROM task_comments WHERE id = ? AND task_id = ?",
    [commentId, id]
  );
  if (!rows.length) return fail(res, "Comment not found", 404);
  if (rows[0].user_id !== req.user.id) return fail(res, "Cannot delete another user's comment", 403);
  await db.query("DELETE FROM task_comments WHERE id = ?", [commentId]);
  noContent(res);
});

module.exports = {
  getTasks, getTaskById, createTask, updateTask, deleteTask,
  moveTask, assignTask, getTasksByProject, addComment, editComment, deleteComment,
};
