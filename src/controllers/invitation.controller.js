const { invitationRepository, projectRepository, userRepository } = require("../repositories");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { createNotification } = require("../utils/notification");
const { logActivity } = require("../utils/activity");

// Flatten includes into the flat snake_case shape the frontend expects
const serializeInvitation = (row) => {
  const { invitee, inviter, ...inv } = row.get({ plain: true });
  return {
    ...inv,
    invitee_name: invitee.name,
    invitee_email: invitee.email,
    initials: invitee.initials,
    color: invitee.color,
    avatar: invitee.avatar,
    inviter_name: inviter.name,
  };
};

// ── POST /api/projects/:id/invitations ──────────────────────────────────
// Owner/Admin invites a user (creates invitation instead of direct add)
const createInvitation = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const { userId, role = "Member" } = req.body;

  if (role === "Owner") return fail(res, "Cannot invite as Owner", 400);

  const project = await projectRepository.findById(projectId);
  if (!project) return fail(res, "Project not found", 404);

  const user = await userRepository.findById(userId);
  if (!user) return fail(res, "User not found", 404);

  // Check already a member
  const isMember = await projectRepository.findMembership(projectId, userId);
  if (isMember) return fail(res, "User is already a project member", 409);

  // Check for pending invitation
  const existing = await invitationRepository.findByProjectAndInvitee(projectId, userId);
  if (existing && existing.status === "Pending") {
    return fail(res, "A pending invitation already exists for this user", 409);
  }

  // Upsert invitation (re-invite if previously rejected)
  let invitationId;
  if (existing) {
    await invitationRepository.updateById(existing.id, {
      status: "Pending",
      role,
      inviter_id: req.user.id,
    });
    invitationId = existing.id;
  } else {
    const invitation = await invitationRepository.create({
      project_id: projectId,
      inviter_id: req.user.id,
      invitee_id: userId,
      role,
    });
    invitationId = invitation.id;
  }

  // Notify the invitee
  await createNotification({
    userId,
    type: "project_invite",
    title: "Project invitation",
    message: `${req.user.name} invited you to join "${project.name}"`,
    actionUrl: `/requests`,
    referenceId: invitationId,
    referenceType: "project_invitation",
  });

  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "member_invited",
    description: `${req.user.name} invited ${user.name} to the project`,
    meta: { invitee_id: userId, invitee_name: user.name },
  });

  const inv = await invitationRepository.findByIdWithUsers(invitationId);
  created(res, serializeInvitation(inv), "Invitation sent");
});

// ── GET /api/projects/:id/invitations ───────────────────────────────────
const getProjectInvitations = asyncHandler(async (req, res) => {
  const rows = await invitationRepository.listByProject(req.params.id);
  ok(res, rows.map(serializeInvitation));
});

// ── GET /api/invitations/my ─────────────────────────────────────────────
// Current user's pending invitations
const getMyInvitations = asyncHandler(async (req, res) => {
  const rows = await invitationRepository.listByInvitee(req.user.id);
  const data = rows.map((row) => {
    const { project, inviter, ...inv } = row.get({ plain: true });
    return {
      ...inv,
      project_name: project.name,
      project_color: project.color,
      project_icon: project.icon,
      inviter_name: inviter.name,
      inviter_initials: inviter.initials,
      inviter_color: inviter.color,
    };
  });
  ok(res, data);
});

// ── PATCH /api/invitations/:id/respond ──────────────────────────────────
const respondToInvitation = asyncHandler(async (req, res) => {
  const { action } = req.body; // "accept" | "reject"
  if (!["accept", "reject"].includes(action)) return fail(res, "action must be accept or reject", 400);

  const inv = await invitationRepository.findForInvitee(req.params.id, req.user.id);
  if (!inv) return fail(res, "Invitation not found", 404);
  if (inv.status !== "Pending") return fail(res, "Invitation is no longer pending", 409);

  const newStatus = action === "accept" ? "Accepted" : "Rejected";
  await invitationRepository.updateById(inv.id, { status: newStatus });

  if (action === "accept") {
    // Add to project_members (skip if somehow already a member)
    await projectRepository.findOrCreateMember(inv.project_id, req.user.id, inv.role);

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
      message: `${req.user.name} accepted your invitation to "${inv.project.name}"`,
      actionUrl: `/projects/${inv.project_id}`,
    });
  } else {
    await createNotification({
      userId: inv.inviter_id,
      type: "project_invite",
      title: "Invitation declined",
      message: `${req.user.name} declined your invitation to "${inv.project.name}"`,
      actionUrl: `/projects/${inv.project_id}`,
    });
  }

  ok(res, null, `Invitation ${newStatus.toLowerCase()}`);
});

// ── DELETE /api/projects/:id/invitations/:invitationId ──────────────────
const cancelInvitation = asyncHandler(async (req, res) => {
  const inv = await invitationRepository.findInProject(req.params.invitationId, req.params.id);
  if (!inv) return fail(res, "Invitation not found", 404);
  await invitationRepository.deleteById(inv.id);
  noContent(res);
});

module.exports = { createInvitation, getProjectInvitations, getMyInvitations, respondToInvitation, cancelInvitation };
