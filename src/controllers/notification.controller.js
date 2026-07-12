const { notificationRepository } = require("../repositories");
const { ok, noContent, fail } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");

// GET /api/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const rows = await notificationRepository.listByUser(req.user.id, 50);
  // Rename is_read → read for frontend compatibility
  ok(res, rows.map((n) => ({ ...n, read: !!n.is_read })));
});

// GET /api/notifications/unread-count
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await notificationRepository.countUnread(req.user.id);
  ok(res, { count });
});

// PATCH /api/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationRepository.findForUser(req.params.id, req.user.id);
  if (!notification) return fail(res, "Notification not found", 404);

  await notificationRepository.markRead(notification.id);
  ok(res, null, "Marked as read");
});

// PATCH /api/notifications/read-all
const markAllAsRead = asyncHandler(async (req, res) => {
  await notificationRepository.markAllRead(req.user.id);
  ok(res, null, "All marked as read");
});

// DELETE /api/notifications/:id
const deleteNotification = asyncHandler(async (req, res) => {
  await notificationRepository.deleteForUser(req.params.id, req.user.id);
  noContent(res);
});

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
