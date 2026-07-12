const {
  taskRepository,
  projectRepository,
  withTransaction,
} = require("../repositories");
const {
  ok,
  created,
  paginated,
  fail,
  noContent,
} = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// Flatten an included assignee/reporter/project into the flat snake_case
// fields the frontend expects (same shape as the old JOINed SQL rows).
const serializeTask = (row) => {
  const { assignee, reporter, project, ...task } = row.get({ plain: true });
  const flat = { ...task };
  if (assignee !== undefined) {
    flat.assignee_name = assignee?.name ?? null;
    flat.assignee_initials = assignee?.initials ?? null;
    flat.assignee_color = assignee?.color ?? null;
    flat.assignee_avatar = assignee?.avatar ?? null;
  }
  if (reporter !== undefined) flat.reporter_name = reporter?.name ?? null;
  if (project !== undefined) {
    flat.project_name = project?.name ?? null;
    flat.project_color = project?.color ?? null;
    flat.project_icon = project?.icon ?? null;
  }
  return flat;
};

const serializeComment = (row) => {
  const { user, ...comment } = row.get({ plain: true });
  return {
    ...comment,
    user_name: user?.name ?? null,
    initials: user?.initials ?? null,
    color: user?.color ?? null,
    avatar: user?.avatar ?? null,
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────
const attachTags = async (tasks) => {
  if (!tasks.length) return tasks;
  const map = await taskRepository.tagsByTasks(tasks.map((t) => t.id));
  return tasks.map((t) => ({ ...t, tags: map[t.id] || [] }));
};

const attachSubtaskCounts = async (tasks) => {
  if (!tasks.length) return tasks;
  const map = await taskRepository.subtaskCountsByTasks(tasks.map((t) => t.id));
  return tasks.map((t) => ({
    ...t,
    subtask_total: map[t.id]?.total || 0,
    subtask_done: map[t.id]?.done || 0,
  }));
};

const recalcProgress = async (projectId) => {
  if (!projectId) return;
  const total = await taskRepository.countTasks({ projectId });
  const done = await taskRepository.countTasks({ projectId, status: 'Done' });
  const progress = total ? Math.round((done / total) * 100) : 0;
  await projectRepository.updateById(projectId, { progress });
};

// Keeps a parent task's status in sync with its subtasks (Rules 1 & 2):
// all subtasks done -> parent Done; a Done parent gains an incomplete
// subtask -> parent reverts to In Progress. No-op when there are no subtasks.
const syncParentStatusFromSubtasks = async (taskId) => {
  const subtasks = await taskRepository.subtasksByTask(taskId);
  if (!subtasks.length) return;
  const task = await taskRepository.findById(taskId);
  if (!task) return;
  const allDone = subtasks.every((s) => s.status === 'Done');
  if (allDone && task.status !== 'Done') {
    await taskRepository.updateById(taskId, { status: 'Done' });
    if (task.project_id) await recalcProgress(task.project_id);
  } else if (!allDone && task.status === 'Done') {
    await taskRepository.updateById(taskId, { status: 'In Progress' });
    if (task.project_id) await recalcProgress(task.project_id);
  }
};

// FIXED: verify assignee is a member of the given project
const assertAssigneeIsMember = async (projectId, assigneeId) => {
  if (!projectId || !assigneeId) return; // unassigned or no-project tasks are fine
  const membership = await projectRepository.findMembership(projectId, assigneeId);
  if (!membership)
    throw Object.assign(new Error('Assignee is not a member of this project'), {
      status: 400,
    });
};

// FIXED: verify caller is a member of the task's project
// For tasks inside a project: caller must be a project member.
// For personal tasks (no project): caller must be the task's reporter.
// Pass reporterId whenever an existing task is being accessed; omit it
// only when there is no task yet (e.g. creating a new personal task).
const assertCallerIsMember = async (projectId, userId, reporterId) => {
  if (!projectId) {
    if (reporterId !== undefined && Number(reporterId) !== Number(userId))
      throw Object.assign(new Error('Access denied — not your task'), {
        status: 403,
      });
    return;
  }
  const membership = await projectRepository.findMembership(projectId, userId);
  if (!membership)
    throw Object.assign(new Error('Access denied — not a project member'), {
      status: 403,
    });
};

// ── GET /api/tasks — scoped to projects the user belongs to ──────────────
const getTasks = asyncHandler(async (req, res) => {
  const {
    projectId,
    status,
    priority,
    assigneeId,
    page = 1,
    limit = 50,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // Restrict to projects the requesting user is a member of; personal
  // tasks (no project) are only visible to the user who created them.
  const memberships = await projectRepository.findMembershipsByUser(req.user.id);

  const { rows, total } = await taskRepository.listAccessible({
    userId: req.user.id,
    memberProjectIds: memberships.map((m) => m.project_id),
    projectId,
    status,
    priority,
    assigneeId,
    limit: Number(limit),
    offset,
  });

  const withTags = await attachTags(rows.map(serializeTask));
  const withSubtaskCounts = await attachSubtaskCounts(withTags);
  paginated(res, { data: withSubtaskCounts, total, page, limit });
});

// ── GET /api/tasks/:id — verify caller has access via project membership ─
const getTaskById = asyncHandler(async (req, res) => {
  const row = await taskRepository.findByIdDetailed(req.params.id);
  if (!row) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(row.project_id, req.user.id, row.reporter_id);

  const [task] = await attachTags([serializeTask(row)]);
  const comments = await taskRepository.commentsByTask(req.params.id);
  task.comments = comments.map(serializeComment);
  ok(res, task);
});

// ── POST /api/tasks ──────────────────────────────────────────────────────
const createTask = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    status = 'Todo',
    priority = 'Medium',
    projectId,
    assigneeId,
    dueDate,
    estimatedHours,
    tags = [],
  } = req.body;

  // Validate: creator must be a project member
  await assertCallerIsMember(projectId, req.user.id);
  // Validate: assignee must also be a project member
  await assertAssigneeIsMember(projectId, assigneeId);

  const taskId = await withTransaction(async (t) => {
    const maxPos = await taskRepository.maxPosition({
      status,
      projectId,
      transaction: t,
    });
    const task = await taskRepository.create(
      {
        title,
        description,
        status,
        priority,
        project_id: projectId || null,
        assignee_id: assigneeId || null,
        reporter_id: req.user.id,
        due_date: dueDate || null,
        estimated_hours: estimatedHours || null,
        position: (maxPos || 0) + 1,
      },
      t,
    );
    await taskRepository.syncTags(task.id, tags, t);
    return task.id;
  });

  if (assigneeId && Number(assigneeId) !== req.user.id) {
    await createNotification({
      userId: assigneeId,
      type: 'task_assigned',
      title: 'Task assigned to you',
      message: `${req.user.name} assigned "${title}" to you`,
      actionUrl: `/tasks/${taskId}`,
    });
  }
  if (projectId) {
    await recalcProgress(projectId);
    await logActivity({
      projectId: Number(projectId),
      userId: req.user.id,
      eventType: 'task_created',
      description: `${req.user.name} created task "${title}"`,
      meta: { task_id: taskId },
    });
  }

  const row = await taskRepository.findById(taskId);
  const [task] = await attachTags([row.get({ plain: true })]);
  created(res, task, 'Task created');
});

// ── PUT /api/tasks/:id ───────────────────────────────────────────────────
const updateTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);

  // Verify caller membership in the task's project
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  // If assignee is being changed, validate new assignee is a project member
  const newAssigneeId = body.assigneeId ?? body.assignee_id;
  if (newAssigneeId !== undefined) {
    await assertAssigneeIsMember(task.project_id, newAssigneeId || null);
  }

  // Completing a task with unfinished subtasks needs explicit confirmation
  // (Rule 3) unless the caller already confirmed via completeSubtasks.
  const completing = body.status === 'Done' && task.status !== 'Done';
  if (completing) {
    const subtasks = await taskRepository.subtasksByTask(id);
    const incomplete = subtasks.filter((s) => s.status !== 'Done');
    if (incomplete.length && !body.completeSubtasks) {
      return res.status(409).json({
        success: false,
        message: 'This task still has unfinished subtasks.',
        requiresConfirmation: true,
        incompleteCount: incomplete.length,
      });
    }
  }

  await withTransaction(async (t) => {
    if (completing && body.completeSubtasks) {
      await taskRepository.markIncompleteSubtasksDone(id, t);
    }

    const allowed = [
      'title',
      'description',
      'status',
      'priority',
      'due_date',
      'estimated_hours',
      'actual_hours',
      'position',
      'assignee_id',
    ];
    const updates = {};
    allowed.forEach((k) => {
      const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
      const val = body[camel] ?? body[k];
      if (val !== undefined) updates[k] = val;
    });
    if (Object.keys(updates).length) {
      await taskRepository.updateById(id, updates, t);
    }
    if (body.tags !== undefined) await taskRepository.syncTags(id, body.tags, t);
  });

  if (task.project_id) await recalcProgress(task.project_id);

  const row = await taskRepository.findById(id);
  const [updated] = await attachTags([row.get({ plain: true })]);
  ok(res, updated, 'Task updated');
});

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────
const deleteTask = asyncHandler(async (req, res) => {
  const task = await taskRepository.findById(req.params.id);
  if (!task) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);
  await taskRepository.deleteById(task.id);
  if (task.project_id) {
    await recalcProgress(task.project_id);
    await logActivity({
      projectId: task.project_id,
      userId: req.user.id,
      eventType: 'task_deleted',
      description: `${req.user.name} deleted task "${task.title}"`,
      meta: { task_id: Number(req.params.id) },
    });
  }
  noContent(res);
});

// ── PATCH /api/tasks/:id/status — Kanban move ───────────────────────────
const moveTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, completeSubtasks } = req.body;
  const valid = ['Todo', 'In Progress', 'Review', 'Done'];
  if (!valid.includes(status))
    return fail(res, `status must be one of: ${valid.join(', ')}`, 400);

  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  // Completing a task with unfinished subtasks needs explicit confirmation
  // (Rule 3) unless the caller already confirmed via completeSubtasks.
  if (status === 'Done' && task.status !== 'Done') {
    const subtasks = await taskRepository.subtasksByTask(id);
    const incomplete = subtasks.filter((s) => s.status !== 'Done');
    if (incomplete.length && !completeSubtasks) {
      return res.status(409).json({
        success: false,
        message: 'This task still has unfinished subtasks.',
        requiresConfirmation: true,
        incompleteCount: incomplete.length,
      });
    }
    if (incomplete.length && completeSubtasks) {
      await taskRepository.markIncompleteSubtasksDone(id);
    }
  }

  await taskRepository.updateById(id, { status });
  if (task.project_id) {
    await recalcProgress(task.project_id);
    if (status === 'Done') {
      await logActivity({
        projectId: task.project_id,
        userId: req.user.id,
        eventType: 'task_completed',
        description: `${req.user.name} completed task "${task.title}"`,
        meta: { task_id: Number(id) },
      });
    }
  }
  const row = await taskRepository.findById(id);
  const [updated] = await attachTags([row.get({ plain: true })]);
  ok(res, updated, 'Task moved');
});

// ── PATCH /api/tasks/:id/assign ──────────────────────────────────────────
const assignTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);

  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);
  await assertAssigneeIsMember(task.project_id, userId || null);

  await taskRepository.updateById(id, { assignee_id: userId || null });

  if (userId && Number(userId) !== req.user.id) {
    await createNotification({
      userId,
      type: 'task_assigned',
      title: 'Task assigned to you',
      message: `${req.user.name} assigned "${task.title}" to you`,
      actionUrl: `/tasks/${id}`,
    });
  }
  ok(res, null, 'Task assigned');
});

// ── GET /api/projects/:projectId/tasks ───────────────────────────────────
// Note: requireProjectMember runs on this route in routes file
const getTasksByProject = asyncHandler(async (req, res) => {
  const rows = await taskRepository.listByProject(req.params.projectId);
  const withTags = await attachTags(rows.map(serializeTask));
  const withSubtaskCounts = await attachSubtaskCounts(withTags);
  ok(res, withSubtaskCounts);
});

// ── POST /api/tasks/:id/comments ─────────────────────────────────────────
const addComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  const newComment = await taskRepository.createComment({
    task_id: id,
    user_id: req.user.id,
    body: comment,
  });
  if (task.assignee_id && task.assignee_id !== req.user.id) {
    await createNotification({
      userId: task.assignee_id,
      type: 'comment',
      title: 'New comment on your task',
      message: `${req.user.name} commented on "${task.title}"`,
      actionUrl: `/tasks/${id}`,
    });
  }
  const withUser = await taskRepository.findCommentWithUser(newComment.id);
  if (task.project_id) {
    await logActivity({
      projectId: task.project_id,
      userId: req.user.id,
      eventType: 'comment_added',
      description: `${req.user.name} commented on "${task.title}"`,
      meta: { task_id: Number(id) },
    });
  }
  created(res, serializeComment(withUser), 'Comment added');
});

// ── PUT /api/tasks/:id/comments/:commentId ───────────────────────────────
const editComment = asyncHandler(async (req, res) => {
  const { id, commentId } = req.params;
  const { comment } = req.body;
  if (!comment?.trim()) return fail(res, 'Comment body is required', 400);

  const existing = await taskRepository.findComment(commentId, id);
  if (!existing) return fail(res, 'Comment not found', 404);
  if (existing.user_id !== req.user.id)
    return fail(res, "Cannot edit another user's comment", 403);

  await taskRepository.updateCommentById(commentId, { body: comment });
  const updated = await taskRepository.findCommentWithUser(commentId);
  ok(res, serializeComment(updated), 'Comment updated');
});

// ── DELETE /api/tasks/:id/comments/:commentId ────────────────────────────
const deleteComment = asyncHandler(async (req, res) => {
  const { id, commentId } = req.params;
  const existing = await taskRepository.findComment(commentId, id);
  if (!existing) return fail(res, 'Comment not found', 404);
  if (existing.user_id !== req.user.id)
    return fail(res, "Cannot delete another user's comment", 403);
  await taskRepository.deleteCommentById(commentId);
  noContent(res);
});

// ── GET /api/tasks/:id/subtasks ──────────────────────────────────────────
const getSubtasks = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  const subtasks = await taskRepository.subtasksByTask(id, { ordered: true });
  ok(res, subtasks);
});

// ── POST /api/tasks/:id/subtasks ─────────────────────────────────────────
const createSubtask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    status = 'Todo',
    priority = 'Medium',
    dueDate,
  } = req.body;

  if (!title?.trim()) return fail(res, 'Title is required', 400);

  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);

  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  const maxPos = await taskRepository.maxSubtaskPosition(id);

  const subtask = await taskRepository.createSubtask({
    task_id: id,
    title,
    description: description || null,
    status,
    priority,
    due_date: dueDate || null,
    position: (maxPos || 0) + 1,
  });

  await syncParentStatusFromSubtasks(id);

  const newSubtask = await taskRepository.findSubtaskById(subtask.id);
  created(res, newSubtask, 'Subtask created');
});

// ── PUT /api/tasks/:id/subtasks/:subtaskId ──────────────────────────────
const updateSubtask = asyncHandler(async (req, res) => {
  const { id, subtaskId } = req.params;
  const { title, description, status, priority, dueDate } = req.body;

  const sub = await taskRepository.findSubtask(subtaskId, id, { withTask: true });
  if (!sub) return fail(res, 'Subtask not found', 404);

  await assertCallerIsMember(sub.task.project_id, req.user.id, sub.task.reporter_id);

  const updates = {};
  if (title !== undefined)       updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined)      updates.status = status;
  if (priority !== undefined)    updates.priority = priority;
  if (dueDate !== undefined)     updates.due_date = dueDate || null;

  if (Object.keys(updates).length) {
    await taskRepository.updateSubtaskById(subtaskId, updates);
  }
  if (status !== undefined) await syncParentStatusFromSubtasks(id);

  const updated = await taskRepository.findSubtaskById(subtaskId);
  ok(res, updated, 'Subtask updated');
});

// ── DELETE /api/tasks/:id/subtasks/:subtaskId ──────────────────────────
const deleteSubtask = asyncHandler(async (req, res) => {
  const { id, subtaskId } = req.params;
  const sub = await taskRepository.findSubtask(subtaskId, id, { withTask: true });
  if (!sub) return fail(res, 'Subtask not found', 404);
  await assertCallerIsMember(sub.task.project_id, req.user.id, sub.task.reporter_id);
  await taskRepository.deleteSubtaskById(subtaskId);
  await syncParentStatusFromSubtasks(id);
  noContent(res);
});

// ── PATCH /api/tasks/:id/subtasks/:subtaskId/status ─────────────────────
const patchSubtaskStatus = asyncHandler(async (req, res) => {
  const { id, subtaskId } = req.params;
  const { status } = req.body;
  const valid = ['Todo', 'In Progress', 'Done'];
  if (!valid.includes(status))
    return fail(res, `status must be one of: ${valid.join(', ')}`, 400);

  const sub = await taskRepository.findSubtask(subtaskId, id, { withTask: true });
  if (!sub) return fail(res, 'Subtask not found', 404);
  await assertCallerIsMember(sub.task.project_id, req.user.id, sub.task.reporter_id);

  await taskRepository.updateSubtaskById(subtaskId, { status });
  await syncParentStatusFromSubtasks(id);

  const updated = await taskRepository.findSubtaskById(subtaskId);
  ok(res, updated, 'Subtask status updated');
});

// ── PATCH /api/tasks/:id/subtasks/reorder ───────────────────────────────
const reorderSubtasks = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { order } = req.body; // [{ id, position }, ...]
  if (!Array.isArray(order)) return fail(res, 'order must be an array', 400);

  const task = await taskRepository.findById(id);
  if (!task) return fail(res, 'Task not found', 404);
  await assertCallerIsMember(task.project_id, req.user.id, task.reporter_id);

  await taskRepository.reorderSubtasks(id, order);
  ok(res, null, 'Subtasks reordered');
});

module.exports = {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  assignTask,
  getTasksByProject,
  addComment,
  editComment,
  deleteComment,
  getSubtasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  patchSubtaskStatus,
  reorderSubtasks,
};
