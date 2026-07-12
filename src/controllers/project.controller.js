const {
  projectRepository,
  taskRepository,
  userRepository,
  invitationRepository,
  withTransaction,
} = require("../repositories");
const { ok, created, paginated, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

const MEMBER_USER_ATTRS = ["id", "name", "email", "role", "avatar", "initials", "color", "status"];

// ── Helpers ──────────────────────────────────────────────────────────────
const attachMembers = async (projects) => {
  if (!projects.length) return projects;
  const memberships = await projectRepository.findMembershipsByProjects(
    projects.map((p) => p.id),
    MEMBER_USER_ATTRS,
  );
  const map = {};
  memberships.forEach((m) => {
    if (!map[m.project_id]) map[m.project_id] = [];
    map[m.project_id].push({ ...m.user.get({ plain: true }), member_role: m.role });
  });
  return projects.map((p) => ({
    ...p,
    members:   map[p.id] || [],
    memberIds: (map[p.id] || []).map((m) => m.id),
  }));
};

// ── GET /api/projects — only return projects the requester belongs to ────
const getProjects = asyncHandler(async (req, res) => {
  const { status, priority, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // FIXED: strict membership — only projects where user is an explicit member
  const memberships = await projectRepository.findMembershipsByUser(req.user.id);
  const roleByProject = {};
  memberships.forEach((m) => { roleByProject[m.project_id] = m.role; });

  const { rows, total } = await projectRepository.listByIds({
    ids: memberships.map((m) => m.project_id),
    status,
    priority,
    limit: Number(limit),
    offset,
  });

  const countMap = await taskRepository.taskCountsByProjects(rows.map((p) => p.id));
  const data = rows.map((p) => ({
    ...p,
    task_count: countMap[p.id]?.task_count || 0,
    completed_task_count: countMap[p.id]?.completed_task_count || 0,
    my_role: roleByProject[p.id],
  }));
  const withMembers = await attachMembers(data);
  paginated(res, { data: withMembers, total, page, limit });
});

// ── GET /api/projects/:id — membership checked by requireProjectMember ───
const getProjectById = asyncHandler(async (req, res) => {
  const row = await projectRepository.findById(req.params.id, { raw: true });
  if (!row) return fail(res, "Project not found", 404);

  const countMap = await taskRepository.taskCountsByProjects([row.id]);
  const [project] = await attachMembers([{
    ...row,
    task_count: countMap[row.id]?.task_count || 0,
    completed_task_count: countMap[row.id]?.completed_task_count || 0,
  }]);
  project.myRole = req.projectRole;
  ok(res, project);
});

// ── POST /api/projects — creator auto-becomes Owner member ──────────────
const createProject = asyncHandler(async (req, res) => {
  const {
    name, description, status = "Planning", priority = "Medium",
    deadline, color = "#6366f1", icon = "🚀", category = "General",
    memberIds = [],   // NEW: array of user IDs to add as Members at creation
  } = req.body;

  const { projectId, invitedUserIds } = await withTransaction(async (t) => {
    const project = await projectRepository.create(
      {
        name, description, status, priority,
        deadline: deadline || null,
        color, icon, category,
        owner_id: req.user.id,
      },
      t,
    );

    // Owner is always added first
    await projectRepository.addMember(project.id, req.user.id, "Owner", t);

    // Requested initial members get an INVITATION, not direct membership
    // (skip duplicates, skip owner)
    const uniqueIds = [...new Set(memberIds.map(Number))].filter((id) => id !== req.user.id);
    const invitedUserIds = [];
    for (const uid of uniqueIds) {
      const user = await userRepository.findById(uid, { transaction: t });
      if (user) {
        const invitation = await invitationRepository.create(
          { project_id: project.id, inviter_id: req.user.id, invitee_id: uid, role: "Member" },
          t,
        );
        invitedUserIds.push({ userId: uid, name: user.name, invitationId: invitation.id });
      }
    }

    return { projectId: project.id, invitedUserIds };
  });

  // Notifications + activity log happen after commit (non-transactional, best-effort)
  for (const inv of invitedUserIds) {
    await createNotification({
      userId: inv.userId,
      type: "project_invite",
      title: "Project invitation",
      message: `${req.user.name} invited you to join "${name}"`,
      actionUrl: `/requests`,
      referenceId: inv.invitationId,
      referenceType: "project_invitation",
    });
    await logActivity({
      projectId,
      userId: req.user.id,
      eventType: "member_invited",
      description: `${req.user.name} invited ${inv.name} to the project`,
      meta: { invitee_id: inv.userId, invitee_name: inv.name },
    });
  }
  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "project_created",
    description: `${req.user.name} created the project "${name}"`,
  });

  const row = await projectRepository.findById(projectId, { raw: true });
  const [project] = await attachMembers([row]);
  created(res, project, "Project created");
});

// ── PUT /api/projects/:id — only members with Owner/Admin role (route guard)
const updateProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowed = ["name","description","status","priority","deadline","color","icon","category","progress"];
  const updates = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  });
  if (!Object.keys(updates).length) return fail(res, "Nothing to update", 400);
  if (req.body.status === "Completed") updates.progress = 100;

  const project = await projectRepository.findById(id);
  if (!project) return fail(res, "Project not found", 404);
  await projectRepository.updateById(id, updates);

  const row = await projectRepository.findById(id, { raw: true });
  const [serialized] = await attachMembers([row]);
  ok(res, serialized, "Project updated");
});

// ── DELETE /api/projects/:id — Owner only ───────────────────────────────
const deleteProject = asyncHandler(async (req, res) => {
  if (req.projectRole !== "Owner") return fail(res, "Only the Owner can delete this project", 403);
  await projectRepository.deleteById(req.params.id);
  noContent(res);
});

// ── GET /api/projects/:id/members ───────────────────────────────────────
const getProjectMembers = asyncHandler(async (req, res) => {
  const memberships = await projectRepository.findMembershipsByProject(req.params.id, {
    userAttributes: MEMBER_USER_ATTRS,
  });
  const members = memberships.map((m) => ({
    ...m.user.get({ plain: true }),
    member_role: m.role,
    joined_project_at: m.joined_at,
  }));
  ok(res, members);
});

// ── POST /api/projects/:id/members — Owner/Admin only ───────────────────
const addProjectMember = asyncHandler(async (req, res) => {
  const { userId, role = "Member" } = req.body;
  const projectId = req.params.id;

  const project = await projectRepository.findById(projectId);
  if (!project) return fail(res, "Project not found", 404);

  const user = await userRepository.findById(userId);
  if (!user) return fail(res, "User not found", 404);

  const existing = await projectRepository.findMembership(projectId, userId);
  if (existing) return fail(res, "User is already a project member", 409);

  // Prevent demoting the Owner via this endpoint
  if (role === "Owner") return fail(res, "Cannot assign Owner role via this endpoint", 400);

  await projectRepository.addMember(projectId, userId, role);

  await createNotification({
    userId,
    type: "project_invite",
    title: "Added to project",
    message: `You were added to "${project.name}" by ${req.user.name}`,
    actionUrl: `/projects/${projectId}`,
  });

  ok(res, null, "Member added");
});

// ── DELETE /api/projects/:id/members/:userId — Owner/Admin only ─────────
const removeProjectMember = asyncHandler(async (req, res) => {
  const { id: projectId, userId } = req.params;

  // Cannot remove the project owner
  const project = await projectRepository.findById(projectId);
  if (!project) return fail(res, "Project not found", 404);
  if (Number(userId) === project.owner_id) return fail(res, "Cannot remove the project owner", 400);

  const removedUser = await userRepository.findById(userId);
  await projectRepository.removeMember(projectId, userId);
  if (removedUser) {
    await logActivity({
      projectId,
      userId: req.user.id,
      eventType: "member_removed",
      description: `${req.user.name} removed ${removedUser.name} from the project`,
      meta: { removed_user_id: Number(userId) },
    });
  }
  noContent(res);
});

// ── GET /api/projects/:id/stats ─────────────────────────────────────────
const getProjectStats = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const countTasks = (extra = {}) => taskRepository.countTasks({ projectId, ...extra });

  const [total, todo, inProgress, review, done, high, medium, low, members] =
    await Promise.all([
      countTasks(),
      countTasks({ status: "Todo" }),
      countTasks({ status: "In Progress" }),
      countTasks({ status: "Review" }),
      countTasks({ status: "Done" }),
      countTasks({ priority: "High" }),
      countTasks({ priority: "Medium" }),
      countTasks({ priority: "Low" }),
      projectRepository.countMembers(projectId),
    ]);

  ok(res, {
    tasks: { total, todo, in_progress: inProgress, review, done },
    priority: { high, medium, low },
    members,
    progress: total ? Math.round((done / total) * 100) : 0,
  });
});

module.exports = {
  getProjects, getProjectById, createProject, updateProject, deleteProject,
  getProjectMembers, addProjectMember, removeProjectMember, getProjectStats,
};
