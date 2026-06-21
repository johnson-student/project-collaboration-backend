const db = require("../config/db");
const { emitToProject } = require("../socket");

/**
 * Log a project activity event.
 * Non-fatal — errors are swallowed to avoid breaking the main flow.
 */
const logActivity = async ({ projectId, userId, eventType, description, meta = null }) => {
  try {
    const [result] = await db.query(
      "INSERT INTO activity_logs (project_id, user_id, event_type, description, meta) VALUES (?,?,?,?,?)",
      [projectId, userId || null, eventType, description, meta ? JSON.stringify(meta) : null]
    );
    const [rows] = await db.query(
      `SELECT al.*, u.name AS user_name, u.initials, u.color, u.avatar
       FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id WHERE al.id = ?`,
      [result.insertId]
    );
    emitToProject(projectId, "activity:new", rows[0]);
  } catch (err) {
    console.error("[activity] Failed to log:", err.message);
  }
};

module.exports = { logActivity };
