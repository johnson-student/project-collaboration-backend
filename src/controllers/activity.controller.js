const db = require("../config/db");
const { ok } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

// ── GET /api/projects/:id/activity ──────────────────────────────────────
const getProjectActivity = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const [rows] = await db.query(
    `SELECT al.*, u.name AS user_name, u.initials, u.color, u.avatar
     FROM activity_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.project_id = ?
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.params.id, Number(limit), offset]
  );
  ok(res, rows);
});

module.exports = { getProjectActivity };
