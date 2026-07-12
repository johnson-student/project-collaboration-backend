const { notificationRepository } = require("../repositories");
const { emitToUser } = require("../socket");

const createNotification = async ({ userId, type, title, message, actionUrl = null, referenceId = null, referenceType = null }) => {
  try {
    const row = await notificationRepository.create({
      user_id: userId,
      type,
      title,
      message,
      action_url: actionUrl,
      reference_id: referenceId || null,
      reference_type: referenceType || null,
    });
    emitToUser(userId, "notification:new", row.get({ plain: true }));
  } catch (err) {
    console.error("[notification] Failed to create:", err.message);
  }
};

module.exports = { createNotification };
