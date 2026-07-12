// Data access for the tasks, subtasks, tags/task_tags and task_comments tables.
const { Op } = require("sequelize");
const {
  sequelize,
  Task,
  Subtask,
  Tag,
  TaskTag,
  TaskComment,
  User,
  Project,
} = require("../models");

const ASSIGNEE_ATTRS = ["name", "initials", "color", "avatar"];
const PROJECT_ATTRS = ["name", "color", "icon"];
const COMMENT_USER_ATTRS = ["name", "initials", "color", "avatar"];

// ── Tasks ────────────────────────────────────────────────────────────────
const findById = (id, { transaction } = {}) => Task.findByPk(id, { transaction });

const findByIdDetailed = (id) =>
  Task.findByPk(id, {
    include: [
      { model: User, as: "assignee", attributes: ASSIGNEE_ATTRS },
      { model: User, as: "reporter", attributes: ["name"] },
      { model: Project, as: "project", attributes: PROJECT_ATTRS },
    ],
  });

const findByIdWithProject = (id, projectAttributes = ["name"]) =>
  Task.findByPk(id, {
    include: [{ model: Project, as: "project", attributes: projectAttributes }],
  });

const findInProject = (taskId, projectId) =>
  Task.findOne({ where: { id: taskId, project_id: projectId } });

// Paginated list scoped to the caller's projects; personal tasks (no project)
// are only visible to their reporter.
const listAccessible = async ({
  userId,
  memberProjectIds,
  projectId,
  status,
  priority,
  assigneeId,
  limit,
  offset,
}) => {
  const conditions = [
    {
      [Op.or]: [
        { project_id: null, reporter_id: userId },
        { project_id: { [Op.in]: memberProjectIds } },
      ],
    },
  ];
  if (projectId) conditions.push({ project_id: projectId });
  if (status) conditions.push({ status });
  if (priority) conditions.push({ priority });
  if (assigneeId) conditions.push({ assignee_id: assigneeId });
  const where = { [Op.and]: conditions };

  const total = await Task.count({ where });
  const rows = await Task.findAll({
    where,
    include: [
      { model: User, as: "assignee", attributes: ASSIGNEE_ATTRS },
      { model: Project, as: "project", attributes: PROJECT_ATTRS },
    ],
    order: [["position", "ASC"], ["created_at", "DESC"]],
    limit,
    offset,
  });
  return { rows, total };
};

const listByProject = (
  projectId,
  { order = [["position", "ASC"], ["created_at", "DESC"]], limit } = {},
) =>
  Task.findAll({
    where: { project_id: projectId },
    include: [{ model: User, as: "assignee", attributes: ASSIGNEE_ATTRS }],
    order,
    limit,
  });

const maxPosition = ({ status, projectId, transaction }) =>
  Task.max("position", {
    where: { status, project_id: projectId || null },
    transaction,
  });

const create = (data, transaction) => Task.create(data, { transaction });

const updateById = (id, updates, transaction) =>
  Task.update(updates, { where: { id }, transaction });

const deleteById = (id) => Task.destroy({ where: { id } });

const countTasks = (filters = {}) => {
  const where = {};
  if (filters.projectId !== undefined) where.project_id = filters.projectId;
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  return Task.count({ where });
};

// Map of assignee_id -> number of tasks they completed.
const countDoneByAssignees = async (userIds) => {
  const rows = await Task.findAll({
    attributes: ["assignee_id", [sequelize.fn("COUNT", sequelize.col("id")), "cnt"]],
    where: { assignee_id: { [Op.in]: userIds }, status: "Done" },
    group: ["assignee_id"],
    raw: true,
  });
  const map = {};
  rows.forEach((r) => {
    map[r.assignee_id] = Number(r.cnt);
  });
  return map;
};

// Map of project_id -> { task_count, completed_task_count }.
const taskCountsByProjects = async (projectIds) => {
  if (!projectIds.length) return {};
  const rows = await Task.findAll({
    attributes: [
      "project_id",
      [sequelize.fn("COUNT", sequelize.col("id")), "task_count"],
      [sequelize.fn("SUM", sequelize.literal("status = 'Done'")), "completed_task_count"],
    ],
    where: { project_id: { [Op.in]: projectIds } },
    group: ["project_id"],
    raw: true,
  });
  const map = {};
  rows.forEach((r) => {
    map[r.project_id] = {
      task_count: Number(r.task_count),
      completed_task_count: Number(r.completed_task_count),
    };
  });
  return map;
};

// ── Tags ─────────────────────────────────────────────────────────────────
// Map of task_id -> [tag labels].
const tagsByTasks = async (taskIds) => {
  if (!taskIds.length) return {};
  const rows = await TaskTag.findAll({
    where: { task_id: { [Op.in]: taskIds } },
    include: [{ model: Tag, as: "tag", attributes: ["label"] }],
  });
  const map = {};
  rows.forEach((r) => {
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push(r.tag.label);
  });
  return map;
};

// Replace a task's tags with the given labels (creating tags as needed).
const syncTags = async (taskId, tagLabels, transaction) => {
  await TaskTag.destroy({ where: { task_id: taskId }, transaction });
  if (!tagLabels?.length) return;
  for (const label of tagLabels) {
    const [tag] = await Tag.findOrCreate({
      where: { label: label.trim().toLowerCase() },
      transaction,
    });
    await TaskTag.findOrCreate({
      where: { task_id: taskId, tag_id: tag.id },
      transaction,
    });
  }
};

// ── Comments ─────────────────────────────────────────────────────────────
const commentsByTask = (taskId) =>
  TaskComment.findAll({
    where: { task_id: taskId },
    include: [{ model: User, as: "user", attributes: COMMENT_USER_ATTRS }],
    order: [["created_at", "ASC"]],
  });

const createComment = (data) => TaskComment.create(data);

const findComment = (commentId, taskId) =>
  TaskComment.findOne({ where: { id: commentId, task_id: taskId } });

const findCommentWithUser = (id) =>
  TaskComment.findByPk(id, {
    include: [{ model: User, as: "user", attributes: COMMENT_USER_ATTRS }],
  });

const updateCommentById = (id, updates) =>
  TaskComment.update(updates, { where: { id } });

const deleteCommentById = (id) => TaskComment.destroy({ where: { id } });

// ── Subtasks ─────────────────────────────────────────────────────────────
const subtasksByTask = (taskId, { ordered } = {}) =>
  Subtask.findAll({
    where: { task_id: taskId },
    ...(ordered ? { order: [["position", "ASC"], ["created_at", "ASC"]] } : {}),
  });

const findSubtaskById = (id) => Subtask.findByPk(id);

const findSubtask = (subtaskId, taskId, { withTask } = {}) =>
  Subtask.findOne({
    where: { id: subtaskId, task_id: taskId },
    ...(withTask
      ? { include: [{ model: Task, as: "task", attributes: ["project_id", "reporter_id"] }] }
      : {}),
  });

const createSubtask = (data) => Subtask.create(data);

const updateSubtaskById = (id, updates) =>
  Subtask.update(updates, { where: { id } });

const deleteSubtaskById = (id) => Subtask.destroy({ where: { id } });

const maxSubtaskPosition = (taskId) =>
  Subtask.max("position", { where: { task_id: taskId } });

const markIncompleteSubtasksDone = (taskId, transaction) =>
  Subtask.update(
    { status: "Done" },
    { where: { task_id: taskId, status: { [Op.ne]: "Done" } }, transaction },
  );

// Map of task_id -> { total, done } subtask counts.
const subtaskCountsByTasks = async (taskIds) => {
  if (!taskIds.length) return {};
  const rows = await Subtask.findAll({
    attributes: [
      "task_id",
      [sequelize.fn("COUNT", sequelize.col("id")), "total"],
      [sequelize.fn("SUM", sequelize.literal("status = 'Done'")), "done"],
    ],
    where: { task_id: { [Op.in]: taskIds } },
    group: ["task_id"],
    raw: true,
  });
  const map = {};
  rows.forEach((r) => {
    map[r.task_id] = { total: Number(r.total), done: Number(r.done) };
  });
  return map;
};

// Persist a drag-and-drop ordering atomically.
const reorderSubtasks = (taskId, order) =>
  sequelize.transaction(async (t) => {
    for (const { id: subtaskId, position } of order) {
      await Subtask.update(
        { position },
        { where: { id: subtaskId, task_id: taskId }, transaction: t },
      );
    }
  });

module.exports = {
  findById,
  findByIdDetailed,
  findByIdWithProject,
  findInProject,
  listAccessible,
  listByProject,
  maxPosition,
  create,
  updateById,
  deleteById,
  countTasks,
  countDoneByAssignees,
  taskCountsByProjects,
  tagsByTasks,
  syncTags,
  commentsByTask,
  createComment,
  findComment,
  findCommentWithUser,
  updateCommentById,
  deleteCommentById,
  subtasksByTask,
  findSubtaskById,
  findSubtask,
  createSubtask,
  updateSubtaskById,
  deleteSubtaskById,
  maxSubtaskPosition,
  markIncompleteSubtasksDone,
  subtaskCountsByTasks,
  reorderSubtasks,
};
