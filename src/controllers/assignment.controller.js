const db = require("../config/db");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// ── POST /api/tasks/:id/assignment-request ──────────────────────────────
const createAssignmentRequest = asyncHandler(async (req, res) => {
  const taskId = req.params.id;
  const { assigneeId } = req.body;
  if (!assigneeId) return fail(res, "assigneeId is required", 400);

  const [taskRows] = await db.query(
    "SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?",
    [taskId]
  );
  if (!taskRows.length) return fail(res, "Task not found", 404);
  const task = taskRows[0];

  // Requester must be a member
  if (task.project_id) {
    const [mem] = await db.query(
      "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
      [task.project_id, req.user.id]
    );
    if (!mem.length) return fail(res, "Access denied — not a project member", 403);
  }

  // Assignee must be a project member
  if (task.project_id) {
    const [assMem] = await db.query(
      "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
      [task.project_id, assigneeId]
    );
    if (!assMem.length) return fail(res, "Assignee is not a member of this project", 400);
  }

  const [assigneeRow] = await db.query("SELECT id, name FROM users WHERE id = ?", [assigneeId]);
  if (!assigneeRow.length) return fail(res, "Assignee user not found", 404);

  // Cancel any other pending request for this task
  await db.query(
    "UPDATE task_assignment_requests SET status='Rejected' WHERE task_id = ? AND status='Pending'",
    [taskId]
  );

  const [result] = await db.query(
    "INSERT INTO task_assignment_requests (task_id, requester_id, assignee_id) VALUES (?,?,?)",
    [taskId, req.user.id, assigneeId]
  );
  const requestId = result.insertId;

  // Notify assignee
  await createNotification({
    userId: assigneeId,
    type: "task_assigned",
    title: "Task assignment request",
    message: `${req.user.name} wants to assign "${task.title}" to you`,
    actionUrl: `/requests`,
    referenceId: requestId,
    referenceType: "task_assignment_request",
  });

  if (task.project_id) {
    await logActivity({
      projectId: task.project_id,
      userId: req.user.id,
      eventType: "task_assigned",
      description: `${req.user.name} requested to assign "${task.title}" to ${assigneeRow[0].name}`,
      meta: { task_id: taskId, assignee_id: assigneeId },
    });
  }

  const [req2] = await db.query(
    `SELECT tar.*, u.name AS assignee_name, r.name AS requester_name
     FROM task_assignment_requests tar
     JOIN users u ON u.id = tar.assignee_id
     JOIN users r ON r.id = tar.requester_id
     WHERE tar.id = ?`,
    [requestId]
  );
  created(res, req2[0], "Assignment request sent");
});

// ── GET /api/requests/my — current user's pending assignment requests ────
const getMyAssignmentRequests = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT tar.*, t.title AS task_title, t.priority, t.status AS task_status,
            p.name AS project_name, p.color AS project_color, p.icon AS project_icon,
            r.name AS requester_name, r.initials AS requester_initials, r.color AS requester_color
     FROM task_assignment_requests tar
     JOIN tasks    t ON t.id   = tar.task_id
     LEFT JOIN projects p ON p.id = t.project_id
     JOIN users    r ON r.id   = tar.requester_id
     WHERE tar.assignee_id = ?
     ORDER BY tar.created_at DESC`,
    [req.user.id]
  );
  ok(res, rows);
});

// ── PATCH /api/requests/assignments/:id/respond ─────────────────────────
const respondToAssignment = asyncHandler(async (req, res) => {
  const { action } = req.body;
  if (!["accept", "reject"].includes(action)) return fail(res, "action must be accept or reject", 400);

  const [rows] = await db.query(
    `SELECT tar.*, t.title AS task_title, t.project_id
     FROM task_assignment_requests tar
     JOIN tasks t ON t.id = tar.task_id
     WHERE tar.id = ? AND tar.assignee_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) return fail(res, "Request not found", 404);
  const request = rows[0];
  if (request.status !== "Pending") return fail(res, "Request is no longer pending", 409);

  const newStatus = action === "accept" ? "Accepted" : "Rejected";
  await db.query("UPDATE task_assignment_requests SET status=? WHERE id=?", [newStatus, request.id]);

  if (action === "accept") {
    await db.query("UPDATE tasks SET assignee_id = ? WHERE id = ?", [req.user.id, request.task_id]);

    if (request.project_id) {
      await logActivity({
        projectId: request.project_id,
        userId: req.user.id,
        eventType: "task_assigned",
        description: `${req.user.name} accepted task assignment for "${request.task_title}"`,
        meta: { task_id: request.task_id },
      });
    }

    await createNotification({
      userId: request.requester_id,
      type: "task_assigned",
      title: "Assignment accepted",
      message: `${req.user.name} accepted the assignment for "${request.task_title}"`,
      actionUrl: `/tasks/${request.task_id}`,
    });
  } else {
    await createNotification({
      userId: request.requester_id,
      type: "task_assigned",
      title: "Assignment declined",
      message: `${req.user.name} declined the assignment for "${request.task_title}"`,
      actionUrl: `/tasks/${request.task_id}`,
    });
  }

  ok(res, null, `Assignment request ${newStatus.toLowerCase()}`);
});

// ── GET /api/tasks/:id/assignment-requests ───────────────────────────────
const getTaskAssignmentRequests = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT tar.*, u.name AS assignee_name, u.initials, u.color,
            r.name AS requester_name
     FROM task_assignment_requests tar
     JOIN users u ON u.id = tar.assignee_id
     JOIN users r ON r.id = tar.requester_id
     WHERE tar.task_id = ?
     ORDER BY tar.created_at DESC`,
    [req.params.id]
  );
  ok(res, rows);
});

module.exports = { createAssignmentRequest, getMyAssignmentRequests, respondToAssignment, getTaskAssignmentRequests };
