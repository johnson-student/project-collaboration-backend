// Data access for the project_messages (chat) table.
const { Op } = require("sequelize");
const { ProjectMessage, ProjectFile, User } = require("../models");

const MESSAGE_INCLUDE = [
  { model: User, as: "user", attributes: ["name", "initials", "color", "avatar"] },
  {
    model: ProjectFile,
    as: "attachment",
    attributes: ["original_name", "stored_name", "mime_type", "size_bytes"],
  },
];

// Cursor-paginated page of messages, newest first.
const listByProject = (projectId, { before, limit }) => {
  const where = { project_id: projectId };
  if (before) where.id = { [Op.lt]: before };
  return ProjectMessage.findAll({
    where,
    include: MESSAGE_INCLUDE,
    order: [["id", "DESC"]],
    limit,
  });
};

const findByIdWithIncludes = (id) =>
  ProjectMessage.findByPk(id, { include: MESSAGE_INCLUDE });

const create = (data) => ProjectMessage.create(data);

const findInProject = (messageId, projectId) =>
  ProjectMessage.findOne({ where: { id: messageId, project_id: projectId } });

const updateById = (id, updates) =>
  ProjectMessage.update(updates, { where: { id } });

const deleteById = (id) => ProjectMessage.destroy({ where: { id } });

module.exports = {
  listByProject,
  findByIdWithIncludes,
  create,
  findInProject,
  updateById,
  deleteById,
};
