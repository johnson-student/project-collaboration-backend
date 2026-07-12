// Data access for the ai_messages table.
const { AiMessage } = require("../models");

const listByProjectAndUser = (projectId, userId, limit = 200) =>
  AiMessage.findAll({
    where: { project_id: projectId, user_id: userId },
    order: [["id", "ASC"]],
    limit,
  });

// Most recent messages first (for building the model's chat history).
const listRecent = (projectId, userId, limit) =>
  AiMessage.findAll({
    attributes: ["role", "message_type", "content"],
    where: { project_id: projectId, user_id: userId },
    order: [["id", "DESC"]],
    limit,
    raw: true,
  });

const create = async (data) => {
  const row = await AiMessage.create(data);
  return row.get({ plain: true });
};

const clearByProjectAndUser = (projectId, userId) =>
  AiMessage.destroy({ where: { project_id: projectId, user_id: userId } });

module.exports = { listByProjectAndUser, listRecent, create, clearByProjectAndUser };
