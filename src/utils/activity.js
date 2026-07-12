const { activityRepository } = require("../repositories");
const { emitToProject } = require("../socket");

/**
 * Log a project activity event.
 * Non-fatal — errors are swallowed to avoid breaking the main flow.
 */
const logActivity = async ({ projectId, userId, eventType, description, meta = null }) => {
  try {
    const row = await activityRepository.create({
      project_id: projectId,
      user_id: userId || null,
      event_type: eventType,
      description,
      meta,
    });
    const withUser = await activityRepository.findByIdWithUser(row.id);
    const { user, ...activity } = withUser.get({ plain: true });
    emitToProject(projectId, "activity:new", {
      ...activity,
      user_name: user?.name ?? null,
      initials: user?.initials ?? null,
      color: user?.color ?? null,
      avatar: user?.avatar ?? null,
    });
  } catch (err) {
    console.error("[activity] Failed to log:", err.message);
  }
};

module.exports = { logActivity };
