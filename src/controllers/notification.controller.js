const db     = require("../config/db");
const { ok, noContent, fail } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

// GET /api/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [req.user.id]
  );
  // Rename is_read → read for frontend compatibility
  ok(res, rows.map((n) => ({ ...n, read: !!n.is_read })));
});

// GET /api/notifications/unread-count
const getUnreadCount = asyncHandler(async (req, res) => {
  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
    [req.user.id]
  );
  ok(res, { count: Number(count) });
});

// PATCH /api/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );
  if (!rows.length) return fail(res, "Notification not found", 404);

  await db.query("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id]);
  ok(res, null, "Marked as read");
});

// PATCH /api/notifications/read-all
const markAllAsRead = asyncHandler(async (req, res) => {
  await db.query(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
    [req.user.id]
  );
  ok(res, null, "All marked as read");
});

// DELETE /api/notifications/:id
const deleteNotification = asyncHandler(async (req, res) => {
  await db.query(
    "DELETE FROM notifications WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );
  noContent(res);
});

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
