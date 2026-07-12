// Data access for the activity_logs table.
const { ActivityLog, User } = require("../models");

const USER_INCLUDE = {
  model: User,
  as: "user",
  attributes: ["name", "initials", "color", "avatar"],
};

const create = (data) => ActivityLog.create(data);

const findByIdWithUser = (id) =>
  ActivityLog.findByPk(id, { include: [USER_INCLUDE] });

const listByProject = (projectId, { limit, offset }) =>
  ActivityLog.findAll({
    where: { project_id: projectId },
    include: [USER_INCLUDE],
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });

module.exports = { create, findByIdWithUser, listByProject };
