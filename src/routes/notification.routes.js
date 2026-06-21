const express = require("express");
const router   = express.Router();
const ctrl     = require("../controllers/notification.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

// GET  /api/notifications
router.get("/", ctrl.getNotifications);

// GET  /api/notifications/unread-count
router.get("/unread-count", ctrl.getUnreadCount);

// PATCH /api/notifications/read-all
router.patch("/read-all", ctrl.markAllAsRead);

// PATCH /api/notifications/:id/read
router.patch("/:id/read", ctrl.markAsRead);

// DELETE /api/notifications/:id
router.delete("/:id", ctrl.deleteNotification);

module.exports = router;
