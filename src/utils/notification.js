const db = require("../config/db");
const { emitToUser } = require("../socket");

const createNotification = async ({ userId, type, title, message, actionUrl = null, referenceId = null, referenceType = null }) => {
  try {
    const [result] = await db.query(
      "INSERT INTO notifications (user_id, type, title, message, action_url, reference_id, reference_type) VALUES (?,?,?,?,?,?,?)",
      [userId, type, title, message, actionUrl, referenceId || null, referenceType || null]
    );
    const [rows] = await db.query("SELECT * FROM notifications WHERE id = ?", [result.insertId]);
    emitToUser(userId, "notification:new", rows[0]);
  } catch (err) {
    console.error("[notification] Failed to create:", err.message);
  }
};

module.exports = { createNotification };
