const { activityRepository } = require("../repositories");
const { ok } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

// ── GET /api/projects/:id/activity ──────────────────────────────────────
const getProjectActivity = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const rows = await activityRepository.listByProject(req.params.id, {
    limit: Number(limit),
    offset,
  });

  const data = rows.map((row) => {
    const { user, ...activity } = row.get({ plain: true });
    return {
      ...activity,
      user_name: user?.name ?? null,
      initials: user?.initials ?? null,
      color: user?.color ?? null,
      avatar: user?.avatar ?? null,
    };
  });
  ok(res, data);
});

module.exports = { getProjectActivity };
