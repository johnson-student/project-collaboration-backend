const {
  assignmentRepository,
  taskRepository,
  projectRepository,
  userRepository,
} = require("../repositories");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// ── POST /api/tasks/:id/assignment-request ──────────────────────────────
const createAssignmentRequest = asyncHandler(async (req, res) => {
  const taskId = req.params.id;
  const { assigneeId } = req.body;
  if (!assigneeId) return fail(res, "assigneeId is required", 400);

  const task = await taskRepository.findByIdWithProject(taskId, ["name"]);
  if (!task) return fail(res, "Task not found", 404);

  // Requester must be a member
  if (task.project_id) {
    const membership = await projectRepository.findMembership(task.project_id, req.user.id);
    if (!membership) return fail(res, "Access denied — not a project member", 403);
  }

  // Assignee must be a project member
  if (task.project_id) {
    const assigneeMembership = await projectRepository.findMembership(task.project_id, assigneeId);
    if (!assigneeMembership) return fail(res, "Assignee is not a member of this project", 400);
  }

  const assignee = await userRepository.findById(assigneeId);
  if (!assignee) return fail(res, "Assignee user not found", 404);

  // Cancel any other pending request for this task
  await assignmentRepository.rejectPendingForTask(taskId);

  const request = await assignmentRepository.create({
    task_id: taskId,
    requester_id: req.user.id,
    assignee_id: assigneeId,
  });

  // Notify assignee
  await createNotification({
    userId: assigneeId,
    type: "task_assigned",
    title: "Task assignment request",
    message: `${req.user.name} wants to assign "${task.title}" to you`,
    actionUrl: `/requests`,
    referenceId: request.id,
    referenceType: "task_assignment_request",
  });

  if (task.project_id) {
    await logActivity({
      projectId: task.project_id,
      userId: req.user.id,
      eventType: "task_assigned",
      description: `${req.user.name} requested to assign "${task.title}" to ${assignee.name}`,
      meta: { task_id: taskId, assignee_id: assigneeId },
    });
  }

  const withUsers = await assignmentRepository.findByIdWithUsers(request.id);
  const { assignee: a, requester: r, ...tar } = withUsers.get({ plain: true });
  created(res, { ...tar, assignee_name: a.name, requester_name: r.name }, "Assignment request sent");
});

// ── GET /api/requests/my — current user's pending assignment requests ────
const getMyAssignmentRequests = asyncHandler(async (req, res) => {
  const rows = await assignmentRepository.listByAssignee(req.user.id);
  const data = rows.map((row) => {
    const { task, requester, ...tar } = row.get({ plain: true });
    return {
      ...tar,
      task_title: task.title,
      priority: task.priority,
      task_status: task.status,
      project_name: task.project?.name ?? null,
      project_color: task.project?.color ?? null,
      project_icon: task.project?.icon ?? null,
      requester_name: requester.name,
      requester_initials: requester.initials,
      requester_color: requester.color,
    };
  });
  ok(res, data);
});

// ── PATCH /api/requests/assignments/:id/respond ─────────────────────────
const respondToAssignment = asyncHandler(async (req, res) => {
  const { action } = req.body;
  if (!["accept", "reject"].includes(action)) return fail(res, "action must be accept or reject", 400);

  const request = await assignmentRepository.findForAssignee(req.params.id, req.user.id);
  if (!request) return fail(res, "Request not found", 404);
  if (request.status !== "Pending") return fail(res, "Request is no longer pending", 409);

  const newStatus = action === "accept" ? "Accepted" : "Rejected";
  await assignmentRepository.updateById(request.id, { status: newStatus });

  if (action === "accept") {
    await taskRepository.updateById(request.task_id, { assignee_id: req.user.id });

    if (request.task.project_id) {
      await logActivity({
        projectId: request.task.project_id,
        userId: req.user.id,
        eventType: "task_assigned",
        description: `${req.user.name} accepted task assignment for "${request.task.title}"`,
        meta: { task_id: request.task_id },
      });
    }

    await createNotification({
      userId: request.requester_id,
      type: "task_assigned",
      title: "Assignment accepted",
      message: `${req.user.name} accepted the assignment for "${request.task.title}"`,
      actionUrl: `/tasks/${request.task_id}`,
    });
  } else {
    await createNotification({
      userId: request.requester_id,
      type: "task_assigned",
      title: "Assignment declined",
      message: `${req.user.name} declined the assignment for "${request.task.title}"`,
      actionUrl: `/tasks/${request.task_id}`,
    });
  }

  ok(res, null, `Assignment request ${newStatus.toLowerCase()}`);
});

// ── GET /api/tasks/:id/assignment-requests ───────────────────────────────
const getTaskAssignmentRequests = asyncHandler(async (req, res) => {
  const rows = await assignmentRepository.listByTask(req.params.id);
  const data = rows.map((row) => {
    const { assignee, requester, ...tar } = row.get({ plain: true });
    return {
      ...tar,
      assignee_name: assignee.name,
      initials: assignee.initials,
      color: assignee.color,
      requester_name: requester.name,
    };
  });
  ok(res, data);
});

module.exports = { createAssignmentRequest, getMyAssignmentRequests, respondToAssignment, getTaskAssignmentRequests };
