// Data access for the task_assignment_requests table.
const { TaskAssignmentRequest, Task, Project, User } = require("../models");

const create = (data) => TaskAssignmentRequest.create(data);

const updateById = (id, updates) =>
  TaskAssignmentRequest.update(updates, { where: { id } });

const rejectPendingForTask = (taskId) =>
  TaskAssignmentRequest.update(
    { status: "Rejected" },
    { where: { task_id: taskId, status: "Pending" } },
  );

const findByIdWithUsers = (id) =>
  TaskAssignmentRequest.findByPk(id, {
    include: [
      { model: User, as: "assignee", attributes: ["name"] },
      { model: User, as: "requester", attributes: ["name"] },
    ],
  });

const listByAssignee = (userId) =>
  TaskAssignmentRequest.findAll({
    where: { assignee_id: userId },
    include: [
      {
        model: Task,
        as: "task",
        attributes: ["title", "priority", "status"],
        include: [{ model: Project, as: "project", attributes: ["name", "color", "icon"] }],
      },
      { model: User, as: "requester", attributes: ["name", "initials", "color"] },
    ],
    order: [["created_at", "DESC"]],
  });

const findForAssignee = (id, userId) =>
  TaskAssignmentRequest.findOne({
    where: { id, assignee_id: userId },
    include: [{ model: Task, as: "task", attributes: ["title", "project_id"] }],
  });

const listByTask = (taskId) =>
  TaskAssignmentRequest.findAll({
    where: { task_id: taskId },
    include: [
      { model: User, as: "assignee", attributes: ["name", "initials", "color"] },
      { model: User, as: "requester", attributes: ["name"] },
    ],
    order: [["created_at", "DESC"]],
  });

module.exports = {
  create,
  updateById,
  rejectPendingForTask,
  findByIdWithUsers,
  listByAssignee,
  findForAssignee,
  listByTask,
};
