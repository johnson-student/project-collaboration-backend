// Data access for the project_files table.
const { ProjectFile, User } = require("../models");

const UPLOADER_INCLUDE = {
  model: User,
  as: "uploader",
  attributes: ["name", "initials", "color"],
};

const create = (data) => ProjectFile.create(data);

const findByIdWithUploader = (id) =>
  ProjectFile.findByPk(id, { include: [UPLOADER_INCLUDE] });

const listByProject = (projectId) =>
  ProjectFile.findAll({
    where: { project_id: projectId },
    include: [UPLOADER_INCLUDE],
    order: [["created_at", "DESC"]],
  });

const findInProject = (fileId, projectId) =>
  ProjectFile.findOne({ where: { id: fileId, project_id: projectId } });

const deleteById = (id) => ProjectFile.destroy({ where: { id } });

module.exports = {
  create,
  findByIdWithUploader,
  listByProject,
  findInProject,
  deleteById,
};
