const db     = require("../config/db");
const { ok, created, paginated, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// ── Helpers ──────────────────────────────────────────────────────────────
const attachMembers = async (projects) => {
  if (!projects.length) return projects;
  const ids = projects.map((p) => p.id);
  const [members] = await db.query(
    `SELECT pm.project_id, pm.role AS member_role,
            u.id, u.name, u.email, u.role, u.avatar, u.initials, u.color, u.status
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id IN (?)`,
    [ids]
  );
  const map = {};
  members.forEach((m) => {
    if (!map[m.project_id]) map[m.project_id] = [];
    const { project_id, ...rest } = m;
    map[project_id].push(rest);
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

  // FIXED: strict JOIN — only projects where user is an explicit member
  let where = "WHERE pm.user_id = ?";
  const params = [req.user.id];
  if (status)   { where += " AND p.status = ?";   params.push(status); }
  if (priority) { where += " AND p.priority = ?"; params.push(priority); }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(DISTINCT p.id) AS total
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     ${where}`,
    params
  );

  const [rows] = await db.query(
    `SELECT DISTINCT p.*,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status='Done') AS completed_task_count,
            pm.role AS my_role
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  const withMembers = await attachMembers(rows);
  paginated(res, { data: withMembers, total, page, limit });
});

// ── GET /api/projects/:id — membership checked by requireProjectMember ───
const getProjectById = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status='Done') AS completed_task_count
     FROM projects p WHERE p.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return fail(res, "Project not found", 404);
  const [project] = await attachMembers(rows);
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

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO projects (name, description, status, priority, deadline, color, icon, category, owner_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, description, status, priority, deadline || null, color, icon, category, req.user.id]
    );
    const projectId = result.insertId;

    // Owner is always added first
    await conn.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,'Owner')",
      [projectId, req.user.id]
    );

    // Requested initial members get an INVITATION, not direct membership
    // (skip duplicates, skip owner)
    const uniqueIds = [...new Set(memberIds.map(Number))].filter((id) => id !== req.user.id);
    const invitedUserIds = [];
    for (const uid of uniqueIds) {
      const [userCheck] = await conn.query("SELECT id, name FROM users WHERE id = ?", [uid]);
      if (userCheck.length) {
        const [invResult] = await conn.query(
          "INSERT INTO project_invitations (project_id, inviter_id, invitee_id, role) VALUES (?,?,?,'Member')",
          [projectId, req.user.id, uid]
        );
        invitedUserIds.push({ userId: uid, name: userCheck[0].name, invitationId: invResult.insertId });
      }
    }

    await conn.commit();

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
    const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [projectId]);
    const [project] = await attachMembers(rows);
    created(res, project, "Project created");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── PUT /api/projects/:id — only members with Owner/Admin role (route guard)
const updateProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowed = ["name","description","status","priority","deadline","color","icon","category","progress"];
  const fields = [], vals = [];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(req.body[k]); }
  });
  if (!fields.length) return fail(res, "Nothing to update", 400);
  if (req.body.status === "Completed") fields.push("progress = 100");
  vals.push(id);
  await db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, vals);
  const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [id]);
  if (!rows.length) return fail(res, "Project not found", 404);
  const [project] = await attachMembers(rows);
  ok(res, project, "Project updated");
});

// ── DELETE /api/projects/:id — Owner only ───────────────────────────────
const deleteProject = asyncHandler(async (req, res) => {
  if (req.projectRole !== "Owner") return fail(res, "Only the Owner can delete this project", 403);
  await db.query("DELETE FROM projects WHERE id = ?", [req.params.id]);
  noContent(res);
});

// ── GET /api/projects/:id/members ───────────────────────────────────────
const getProjectMembers = asyncHandler(async (req, res) => {
  const [members] = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.avatar, u.initials, u.color, u.status,
            pm.role AS member_role, pm.joined_at AS joined_project_at
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?`,
    [req.params.id]
  );
  ok(res, members);
});

// ── POST /api/projects/:id/members — Owner/Admin only ───────────────────
const addProjectMember = asyncHandler(async (req, res) => {
  const { userId, role = "Member" } = req.body;
  const projectId = req.params.id;

  const [proj] = await db.query("SELECT name FROM projects WHERE id = ?", [projectId]);
  if (!proj.length) return fail(res, "Project not found", 404);

  const [user] = await db.query("SELECT id, name FROM users WHERE id = ?", [userId]);
  if (!user.length) return fail(res, "User not found", 404);

  const [existing] = await db.query(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (existing.length) return fail(res, "User is already a project member", 409);

  // Prevent demoting the Owner via this endpoint
  if (role === "Owner") return fail(res, "Cannot assign Owner role via this endpoint", 400);

  await db.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)",
    [projectId, userId, role]
  );

  await createNotification({
    userId,
    type: "project_invite",
    title: "Added to project",
    message: `You were added to "${proj[0].name}" by ${req.user.name}`,
    actionUrl: `/projects/${projectId}`,
  });

  ok(res, null, "Member added");
});

// ── DELETE /api/projects/:id/members/:userId — Owner/Admin only ─────────
const removeProjectMember = asyncHandler(async (req, res) => {
  const { id: projectId, userId } = req.params;

  // Cannot remove the project owner
  const [proj] = await db.query("SELECT owner_id FROM projects WHERE id = ?", [projectId]);
  if (!proj.length) return fail(res, "Project not found", 404);
  if (Number(userId) === proj[0].owner_id) return fail(res, "Cannot remove the project owner", 400);

  const [removedUser] = await db.query("SELECT name FROM users WHERE id = ?", [userId]);
  await db.query(
    "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (removedUser.length) {
    await logActivity({
      projectId,
      userId: req.user.id,
      eventType: "member_removed",
      description: `${req.user.name} removed ${removedUser[0].name} from the project`,
      meta: { removed_user_id: Number(userId) },
    });
  }
  noContent(res);
});

// ── GET /api/projects/:id/stats ─────────────────────────────────────────
const getProjectStats = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const [[tasks]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(status='Todo') AS todo, SUM(status='In Progress') AS in_progress,
            SUM(status='Review') AS review, SUM(status='Done') AS done,
            SUM(priority='High') AS high, SUM(priority='Medium') AS medium, SUM(priority='Low') AS low
     FROM tasks WHERE project_id = ?`,
    [projectId]
  );
  const [[members]] = await db.query(
    "SELECT COUNT(*) AS total FROM project_members WHERE project_id = ?",
    [projectId]
  );
  ok(res, {
    tasks: {
      total: Number(tasks.total), todo: Number(tasks.todo),
      in_progress: Number(tasks.in_progress), review: Number(tasks.review), done: Number(tasks.done),
    },
    priority: { high: Number(tasks.high), medium: Number(tasks.medium), low: Number(tasks.low) },
    members: Number(members.total),
    progress: tasks.total ? Math.round((Number(tasks.done) / Number(tasks.total)) * 100) : 0,
  });
});

module.exports = {
  getProjects, getProjectById, createProject, updateProject, deleteProject,
  getProjectMembers, addProjectMember, removeProjectMember, getProjectStats,
};
