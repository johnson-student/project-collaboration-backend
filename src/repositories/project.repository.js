// Data access for the projects and project_members tables.
const { Op } = require("sequelize");
const { sequelize, Project, ProjectMember, User } = require("../models");

// ── Projects ─────────────────────────────────────────────────────────────
const findById = (id, { attributes, raw, transaction } = {}) =>
  Project.findByPk(id, { attributes, raw, transaction });

const create = (data, transaction) => Project.create(data, { transaction });

const updateById = (id, updates) => Project.update(updates, { where: { id } });

const deleteById = (id) => Project.destroy({ where: { id } });

// Paginated list of the given projects with optional status/priority filters.
const listByIds = async ({ ids, status, priority, limit, offset }) => {
  const where = { id: { [Op.in]: ids } };
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const total = await Project.count({ where });
  const rows = await Project.findAll({
    where,
    order: [["created_at", "DESC"]],
    limit,
    offset,
    raw: true,
  });
  return { rows, total };
};

// ── Memberships ──────────────────────────────────────────────────────────
const findMembership = (projectId, userId) =>
  ProjectMember.findOne({ where: { project_id: projectId, user_id: userId } });

const findMembershipWithUser = (projectId, userId, userAttributes) =>
  ProjectMember.findOne({
    where: { project_id: projectId, user_id: userId },
    include: [{ model: User, as: "user", attributes: userAttributes }],
  });

const findMembershipsByUser = (userId) =>
  ProjectMember.findAll({ where: { user_id: userId }, raw: true });

// One project's memberships; pass userAttributes to also join each user row.
const findMembershipsByProject = (projectId, { userAttributes } = {}) =>
  ProjectMember.findAll({
    where: { project_id: projectId },
    ...(userAttributes
      ? { include: [{ model: User, as: "user", attributes: userAttributes }] }
      : { raw: true }),
  });

const findMembershipsByProjects = (projectIds, userAttributes) =>
  ProjectMember.findAll({
    where: { project_id: { [Op.in]: projectIds } },
    include: [{ model: User, as: "user", attributes: userAttributes }],
  });

const addMember = (projectId, userId, role, transaction) =>
  ProjectMember.create(
    { project_id: projectId, user_id: userId, role },
    { transaction },
  );

const findOrCreateMember = (projectId, userId, role) =>
  ProjectMember.findOrCreate({
    where: { project_id: projectId, user_id: userId },
    defaults: { role },
  });

const removeMember = (projectId, userId) =>
  ProjectMember.destroy({ where: { project_id: projectId, user_id: userId } });

const countMembers = (projectId) =>
  ProjectMember.count({ where: { project_id: projectId } });

// Distinct ids of every user sharing at least one of the given projects.
const distinctMemberUserIds = async (projectIds) => {
  const rows = await ProjectMember.findAll({
    attributes: ["user_id"],
    where: { project_id: { [Op.in]: projectIds } },
    group: ["user_id"],
    raw: true,
  });
  return rows.map((r) => r.user_id);
};

// Map of user_id -> number of active projects they belong to.
const countActiveProjectsByUsers = async (userIds) => {
  const rows = await ProjectMember.findAll({
    attributes: [
      "user_id",
      [sequelize.fn("COUNT", sequelize.col("ProjectMember.project_id")), "cnt"],
    ],
    where: { user_id: { [Op.in]: userIds } },
    include: [
      {
        model: Project,
        as: "project",
        attributes: [],
        where: { status: { [Op.in]: ["In Progress", "Review", "Planning"] } },
      },
    ],
    group: ["ProjectMember.user_id"],
    raw: true,
  });
  const map = {};
  rows.forEach((r) => {
    map[r.user_id] = Number(r.cnt);
  });
  return map;
};

module.exports = {
  findById,
  create,
  updateById,
  deleteById,
  listByIds,
  findMembership,
  findMembershipWithUser,
  findMembershipsByUser,
  findMembershipsByProject,
  findMembershipsByProjects,
  addMember,
  findOrCreateMember,
  removeMember,
  countMembers,
  distinctMemberUserIds,
  countActiveProjectsByUsers,
};
