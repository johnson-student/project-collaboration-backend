// Data access for the notifications table.
const { Notification } = require("../models");

const create = (data) => Notification.create(data);

const listByUser = (userId, limit = 50) =>
  Notification.findAll({
    where: { user_id: userId },
    order: [["created_at", "DESC"]],
    limit,
    raw: true,
  });

const countUnread = (userId) =>
  Notification.count({ where: { user_id: userId, is_read: false } });

const findForUser = (id, userId) =>
  Notification.findOne({ where: { id, user_id: userId } });

const markRead = (id) =>
  Notification.update({ is_read: true }, { where: { id } });

const markAllRead = (userId) =>
  Notification.update({ is_read: true }, { where: { user_id: userId } });

const deleteForUser = (id, userId) =>
  Notification.destroy({ where: { id, user_id: userId } });

module.exports = {
  create,
  listByUser,
  countUnread,
  findForUser,
  markRead,
  markAllRead,
  deleteForUser,
};
