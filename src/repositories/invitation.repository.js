// Data access for the project_invitations table.
const { ProjectInvitation, Project, User } = require("../models");

const INVITEE_INCLUDE = {
  model: User,
  as: "invitee",
  attributes: ["name", "email", "initials", "color", "avatar"],
};
const INVITER_INCLUDE = {
  model: User,
  as: "inviter",
  attributes: ["name", "initials", "color"],
};

const create = (data, transaction) => ProjectInvitation.create(data, { transaction });

const updateById = (id, updates) =>
  ProjectInvitation.update(updates, { where: { id } });

const deleteById = (id) => ProjectInvitation.destroy({ where: { id } });

const findByIdWithUsers = (id) =>
  ProjectInvitation.findByPk(id, { include: [INVITEE_INCLUDE, INVITER_INCLUDE] });

const findByProjectAndInvitee = (projectId, inviteeId) =>
  ProjectInvitation.findOne({
    where: { project_id: projectId, invitee_id: inviteeId },
  });

const findInProject = (invitationId, projectId) =>
  ProjectInvitation.findOne({
    where: { id: invitationId, project_id: projectId },
  });

const listByProject = (projectId) =>
  ProjectInvitation.findAll({
    where: { project_id: projectId },
    include: [INVITEE_INCLUDE, INVITER_INCLUDE],
    order: [["created_at", "DESC"]],
  });

const listByInvitee = (userId) =>
  ProjectInvitation.findAll({
    where: { invitee_id: userId },
    include: [
      { model: Project, as: "project", attributes: ["name", "color", "icon"] },
      INVITER_INCLUDE,
    ],
    order: [["created_at", "DESC"]],
  });

const findForInvitee = (id, userId) =>
  ProjectInvitation.findOne({
    where: { id, invitee_id: userId },
    include: [
      { model: Project, as: "project", attributes: ["name"] },
      { model: User, as: "inviter", attributes: ["name"] },
    ],
  });

module.exports = {
  create,
  updateById,
  deleteById,
  findByIdWithUsers,
  findByProjectAndInvitee,
  findInProject,
  listByProject,
  listByInvitee,
  findForInvitee,
};
