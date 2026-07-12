const bcrypt = require("bcryptjs");
const { userRepository, projectRepository, taskRepository } = require("../repositories");
const { ok, paginated, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

const PUBLIC_ATTRS = ["id", "name", "email", "role", "avatar", "initials", "color", "status"];
const LIST_ATTRS = [...PUBLIC_ATTRS, "joined_at", "created_at"];

const safeUser = (u) => {
  const { password_hash, refresh_token, reset_token, reset_token_expires, ...rest } = u;
  return rest;
};

// GET /api/users — returns only users who share at least one project with requester
const getUsers = asyncHandler(async (req, res) => {
  const { q = "", status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // Users who share at least one project with the requester
  const myMemberships = await projectRepository.findMembershipsByUser(req.user.id);
  const sharedUserIds = await projectRepository.distinctMemberUserIds(
    myMemberships.map((m) => m.project_id),
  );

  const { rows, total } = await userRepository.listUsers({
    ids: sharedUserIds,
    q,
    status,
    attributes: LIST_ATTRS,
    limit: Number(limit),
    offset,
  });

  const userIds = rows.map((u) => u.id);
  let tasksMap = {}, projectsMap = {};
  if (userIds.length) {
    tasksMap = await taskRepository.countDoneByAssignees(userIds);
    projectsMap = await projectRepository.countActiveProjectsByUsers(userIds);
  }

  const data = rows.map((u) => ({ ...u, tasksCompleted: tasksMap[u.id] || 0, projectsActive: projectsMap[u.id] || 0 }));
  paginated(res, { data, total, page, limit });
});

// GET /api/users/search?q= — used for assignee/member picker and project invites
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", projectId, scope } = req.query;
  const resolvedScope = scope || (projectId ? "project-members" : "all");

  let rows;
  if (projectId) {
    const check = await projectRepository.findMembership(projectId, req.user.id);
    if (!check) return fail(res, "Access denied", 403);

    const memberships = await projectRepository.findMembershipsByProject(projectId);
    const memberIds = memberships.map((m) => m.user_id);

    if (resolvedScope === "exclude-project-members") {
      rows = await userRepository.searchByNameOrEmail({
        q,
        excludeIds: memberIds,
        attributes: PUBLIC_ATTRS,
      });
    } else {
      const roleByUser = {};
      memberships.forEach((m) => { roleByUser[m.user_id] = m.role; });
      const users = await userRepository.searchByNameOrEmail({
        q,
        includeIds: memberIds,
        attributes: PUBLIC_ATTRS,
      });
      rows = users.map((u) => ({ ...u, member_role: roleByUser[u.id] }));
    }
  } else {
    rows = await userRepository.searchByNameOrEmail({ q, attributes: PUBLIC_ATTRS });
  }

  ok(res, rows);
});

// GET /api/users/:id
const getUserById = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.params.id, { attributes: LIST_ATTRS });
  if (!user) return fail(res, "User not found", 404);
  ok(res, user);
});

// PUT /api/users/:id — own profile only; supports password change
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden — cannot edit another user", 403);

  const { name, role, color, status, currentPassword, newPassword } = req.body;
  const updates = {};

  if (name)   updates.name = name.trim();
  if (role)   updates.role = role;
  if (color)  updates.color = color;
  if (status) updates.status = status;

  const user = await userRepository.findById(id);
  if (!user) return fail(res, "User not found", 404);

  // Password change — validate current password before allowing update
  if (newPassword) {
    if (!currentPassword) return fail(res, "Current password is required to set a new password", 400);
    if (newPassword.length < 8) return fail(res, "New password must be at least 8 characters", 400);

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return fail(res, "Current password is incorrect", 401);

    updates.password_hash = await bcrypt.hash(newPassword, 12);
  }

  if (!Object.keys(updates).length) return fail(res, "Nothing to update", 400);
  await userRepository.updateById(id, updates);

  const updated = await userRepository.findById(id);
  ok(res, safeUser(updated.get({ plain: true })), "Profile updated");
});

// POST /api/users/:id/avatar
const updateAvatar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden", 403);
  if (!req.file) return fail(res, "No file uploaded", 400);
  const url = `/uploads/avatars/${req.file.filename}`;
  await userRepository.updateById(id, { avatar: url });
  ok(res, { avatar: url }, "Avatar updated");
});

// DELETE /api/users/:id — own account only
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden", 403);
  await userRepository.deleteById(id);
  noContent(res);
});

module.exports = { getUsers, searchUsers, getUserById, updateUser, updateAvatar, deleteUser };
