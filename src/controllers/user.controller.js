const bcrypt = require("bcryptjs");
const db     = require("../config/db");
const { ok, paginated, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

const safeUser = (u) => {
  const { password_hash, refresh_token, reset_token, reset_token_expires, ...rest } = u;
  return rest;
};

// GET /api/users — returns only users who share at least one project with requester
const getUsers = asyncHandler(async (req, res) => {
  const { q = "", status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = `WHERE u.id IN (
    SELECT DISTINCT pm2.user_id
    FROM project_members pm1
    JOIN project_members pm2 ON pm2.project_id = pm1.project_id
    WHERE pm1.user_id = ?
  )`;
  const params = [req.user.id];

  if (q) {
    where += " AND (u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) { where += " AND u.status = ?"; params.push(status); }

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  const [rows] = await db.query(
    `SELECT id,name,email,role,avatar,initials,color,status,joined_at,created_at
     FROM users u ${where} ORDER BY u.name LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );

  const userIds = rows.map((u) => u.id);
  let tasksMap = {}, projectsMap = {};
  if (userIds.length) {
    const [tRows] = await db.query(
      `SELECT assignee_id AS uid, COUNT(*) AS cnt FROM tasks WHERE assignee_id IN (?) AND status='Done' GROUP BY assignee_id`,
      [userIds]
    );
    const [pRows] = await db.query(
      `SELECT pm.user_id AS uid, COUNT(*) AS cnt
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id IN (?) AND p.status IN ('In Progress','Review','Planning')
       GROUP BY pm.user_id`,
      [userIds]
    );
    tRows.forEach((r) => (tasksMap[r.uid] = Number(r.cnt)));
    pRows.forEach((r) => (projectsMap[r.uid] = Number(r.cnt)));
  }

  const data = rows.map((u) => ({ ...u, tasksCompleted: tasksMap[u.id] || 0, projectsActive: projectsMap[u.id] || 0 }));
  paginated(res, { data, total, page, limit });
});

// GET /api/users/search?q= — used for assignee/member picker and project invites
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", projectId, scope } = req.query;
  const search = `%${q}%`;
  const resolvedScope = scope || (projectId ? "project-members" : "all");

  let sql, params;
  if (projectId) {
    const [check] = await db.query(
      "SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
      [projectId, req.user.id]
    );
    if (!check.length) return fail(res, "Access denied", 403);

        if (resolvedScope === "exclude-project-members") {
          sql = `SELECT u.id,u.name,u.email,u.role,u.avatar,u.initials,u.color,u.status
            FROM users u
            WHERE NOT EXISTS (
         SELECT 1 FROM project_members pm
         WHERE pm.project_id = ? AND pm.user_id = u.id
            )
            AND (u.name LIKE ? OR u.email LIKE ?)
            ORDER BY u.name LIMIT 20`;
          params = [projectId, search, search];
        } else {
          sql = `SELECT u.id,u.name,u.email,u.role,u.avatar,u.initials,u.color,u.status,pm.role AS member_role
            FROM users u
            JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ?
            WHERE (u.name LIKE ? OR u.email LIKE ?)
            ORDER BY u.name LIMIT 20`;
          params = [projectId, search, search];
        }
  } else {
        sql = `SELECT u.id,u.name,u.email,u.role,u.avatar,u.initials,u.color,u.status
          FROM users u
          WHERE (u.name LIKE ? OR u.email LIKE ?)
          ORDER BY u.name LIMIT 20`;
        params = [search, search];
  }

  const [rows] = await db.query(sql, params);
  ok(res, rows);
});

// GET /api/users/:id
const getUserById = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT id,name,email,role,avatar,initials,color,status,joined_at,created_at FROM users WHERE id=?",
    [req.params.id]
  );
  if (!rows.length) return fail(res, "User not found", 404);
  ok(res, rows[0]);
});

// PUT /api/users/:id — own profile only; supports password change
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden — cannot edit another user", 403);

  const { name, role, color, status, currentPassword, newPassword } = req.body;
  const fields = [], vals = [];

  if (name)   { fields.push("name = ?");   vals.push(name.trim()); }
  if (role)   { fields.push("role = ?");   vals.push(role); }
  if (color)  { fields.push("color = ?");  vals.push(color); }
  if (status) { fields.push("status = ?"); vals.push(status); }

  // Password change — validate current password before allowing update
  if (newPassword) {
    if (!currentPassword) return fail(res, "Current password is required to set a new password", 400);
    if (newPassword.length < 8) return fail(res, "New password must be at least 8 characters", 400);

    const [rows] = await db.query("SELECT password_hash FROM users WHERE id = ?", [id]);
    if (!rows.length) return fail(res, "User not found", 404);

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return fail(res, "Current password is incorrect", 401);

    const hash = await bcrypt.hash(newPassword, 12);
    fields.push("password_hash = ?");
    vals.push(hash);
  }

  if (!fields.length) return fail(res, "Nothing to update", 400);
  vals.push(id);
  await db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, vals);
  const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  ok(res, safeUser(rows[0]), "Profile updated");
});

// POST /api/users/:id/avatar
const updateAvatar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden", 403);
  if (!req.file) return fail(res, "No file uploaded", 400);
  const url = `/uploads/avatars/${req.file.filename}`;
  await db.query("UPDATE users SET avatar = ? WHERE id = ?", [url, id]);
  ok(res, { avatar: url }, "Avatar updated");
});

// DELETE /api/users/:id — own account only
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) !== req.user.id) return fail(res, "Forbidden", 403);
  await db.query("DELETE FROM users WHERE id = ?", [id]);
  noContent(res);
});

module.exports = { getUsers, searchUsers, getUserById, updateUser, updateAvatar, deleteUser };
