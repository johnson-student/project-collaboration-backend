const db = require("../config/db");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// ── POST /api/projects/:id/invitations ──────────────────────────────────
// Owner/Admin invites a user (creates invitation instead of direct add)
const createInvitation = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const { userId, role = "Member" } = req.body;

  if (role === "Owner") return fail(res, "Cannot invite as Owner", 400);

  const [proj] = await db.query("SELECT id, name FROM projects WHERE id = ?", [projectId]);
  if (!proj.length) return fail(res, "Project not found", 404);

  const [user] = await db.query("SELECT id, name, email FROM users WHERE id = ?", [userId]);
  if (!user.length) return fail(res, "User not found", 404);

  // Check already a member
  const [isMember] = await db.query(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (isMember.length) return fail(res, "User is already a project member", 409);

  // Check for pending invitation
  const [existing] = await db.query(
    "SELECT id, status FROM project_invitations WHERE project_id = ? AND invitee_id = ?",
    [projectId, userId]
  );
  if (existing.length && existing[0].status === "Pending") {
    return fail(res, "A pending invitation already exists for this user", 409);
  }

  // Upsert invitation (re-invite if previously rejected)
  let invitationId;
  if (existing.length) {
    await db.query(
      "UPDATE project_invitations SET status='Pending', role=?, inviter_id=?, updated_at=NOW() WHERE id=?",
      [role, req.user.id, existing[0].id]
    );
    invitationId = existing[0].id;
  } else {
    const [result] = await db.query(
      "INSERT INTO project_invitations (project_id, inviter_id, invitee_id, role) VALUES (?,?,?,?)",
      [projectId, req.user.id, userId, role]
    );
    invitationId = result.insertId;
  }

  // Notify the invitee
  await createNotification({
    userId,
    type: "project_invite",
    title: "Project invitation",
    message: `${req.user.name} invited you to join "${proj[0].name}"`,
    actionUrl: `/requests`,
    referenceId: invitationId,
    referenceType: "project_invitation",
  });

  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "member_invited",
    description: `${req.user.name} invited ${user[0].name} to the project`,
    meta: { invitee_id: userId, invitee_name: user[0].name },
  });

  const [inv] = await db.query(
    `SELECT pi.*, u.name AS invitee_name, u.email AS invitee_email,
            u.initials, u.color, u.avatar,
            inv.name AS inviter_name
     FROM project_invitations pi
     JOIN users u   ON u.id   = pi.invitee_id
     JOIN users inv ON inv.id = pi.inviter_id
     WHERE pi.id = ?`,
    [invitationId]
  );
  created(res, inv[0], "Invitation sent");
});

// ── GET /api/projects/:id/invitations ───────────────────────────────────
const getProjectInvitations = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT pi.*, u.name AS invitee_name, u.email AS invitee_email,
            u.initials, u.color, u.avatar,
            inv.name AS inviter_name
     FROM project_invitations pi
     JOIN users u   ON u.id   = pi.invitee_id
     JOIN users inv ON inv.id = pi.inviter_id
     WHERE pi.project_id = ?
     ORDER BY pi.created_at DESC`,
    [req.params.id]
  );
  ok(res, rows);
});

// ── GET /api/invitations/my ─────────────────────────────────────────────
// Current user's pending invitations
const getMyInvitations = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT pi.*, p.name AS project_name, p.color AS project_color, p.icon AS project_icon,
            inv.name AS inviter_name, inv.initials AS inviter_initials, inv.color AS inviter_color
     FROM project_invitations pi
     JOIN projects p   ON p.id   = pi.project_id
     JOIN users    inv ON inv.id = pi.inviter_id
     WHERE pi.invitee_id = ?
     ORDER BY pi.created_at DESC`,
    [req.user.id]
  );
  ok(res, rows);
});

// ── PATCH /api/invitations/:id/respond ──────────────────────────────────
const respondToInvitation = asyncHandler(async (req, res) => {
  const { action } = req.body; // "accept" | "reject"
  if (!["accept", "reject"].includes(action)) return fail(res, "action must be accept or reject", 400);

  const [rows] = await db.query(
    `SELECT pi.*, p.name AS project_name, u.name AS inviter_name
     FROM project_invitations pi
     JOIN projects p ON p.id   = pi.project_id
     JOIN users    u ON u.id   = pi.inviter_id
     WHERE pi.id = ? AND pi.invitee_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) return fail(res, "Invitation not found", 404);
  const inv = rows[0];
  if (inv.status !== "Pending") return fail(res, "Invitation is no longer pending", 409);

  const newStatus = action === "accept" ? "Accepted" : "Rejected";
  await db.query(
    "UPDATE project_invitations SET status=? WHERE id=?",
    [newStatus, inv.id]
  );

  if (action === "accept") {
    // Add to project_members
    await db.query(
      "INSERT IGNORE INTO project_members (project_id, user_id, role) VALUES (?,?,?)",
      [inv.project_id, req.user.id, inv.role]
    );

    await logActivity({
      projectId: inv.project_id,
      userId: req.user.id,
      eventType: "member_joined",
      description: `${req.user.name} joined the project`,
    });

    // Notify inviter
    await createNotification({
      userId: inv.inviter_id,
      type: "project_invite",
      title: "Invitation accepted",
      message: `${req.user.name} accepted your invitation to "${inv.project_name}"`,
      actionUrl: `/projects/${inv.project_id}`,
    });
  } else {
    await createNotification({
      userId: inv.inviter_id,
      type: "project_invite",
      title: "Invitation declined",
      message: `${req.user.name} declined your invitation to "${inv.project_name}"`,
      actionUrl: `/projects/${inv.project_id}`,
    });
  }

  ok(res, null, `Invitation ${newStatus.toLowerCase()}`);
});

// ── DELETE /api/projects/:id/invitations/:invitationId ──────────────────
const cancelInvitation = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT id FROM project_invitations WHERE id = ? AND project_id = ?",
    [req.params.invitationId, req.params.id]
  );
  if (!rows.length) return fail(res, "Invitation not found", 404);
  await db.query("DELETE FROM project_invitations WHERE id = ?", [req.params.invitationId]);
  noContent(res);
});

module.exports = { createInvitation, getProjectInvitations, getMyInvitations, respondToInvitation, cancelInvitation };
