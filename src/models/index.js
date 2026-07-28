// Sequelize models for every CollabFlow table.
// Attribute names deliberately match the snake_case column names so that
// `instance.get({ plain: true })` produces the exact same field names the
// old raw-SQL responses had — the frontend never sees a difference.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// ── users ────────────────────────────────────────────────────────────────
const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(191), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255) },
    google_id: { type: DataTypes.STRING(255), unique: true },
    role: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "Member" },
    avatar: { type: DataTypes.STRING(500) },
    initials: { type: DataTypes.STRING(4) },
    color: { type: DataTypes.STRING(7), allowNull: false, defaultValue: "#6366f1" },
    status: {
      type: DataTypes.ENUM("Active", "Away", "Busy", "Offline"),
      allowNull: false,
      defaultValue: "Offline",
    },
    email_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verify_token: { type: DataTypes.STRING(255) },
    verify_token_expires: { type: DataTypes.DATE },
    joined_at: { type: DataTypes.DATEONLY },
    refresh_token: { type: DataTypes.STRING(500) },
    reset_token: { type: DataTypes.STRING(255) },
    reset_token_expires: { type: DataTypes.DATE },
  },
  { tableName: "users", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── projects ─────────────────────────────────────────────────────────────
const Project = sequelize.define(
  "Project",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT },
    status: {
      type: DataTypes.ENUM("Planning", "In Progress", "Review", "Completed", "On Hold"),
      allowNull: false,
      defaultValue: "Planning",
    },
    priority: {
      type: DataTypes.ENUM("High", "Medium", "Low"),
      allowNull: false,
      defaultValue: "Medium",
    },
    progress: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    deadline: { type: DataTypes.DATEONLY },
    color: { type: DataTypes.STRING(7), allowNull: false, defaultValue: "#6366f1" },
    icon: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "🚀" },
    category: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "General" },
    owner_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  },
  { tableName: "projects", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── project_members (composite PK, join table with payload) ─────────────
const ProjectMember = sequelize.define(
  "ProjectMember",
  {
    project_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    role: {
      type: DataTypes.ENUM("Owner", "Admin", "Member", "Viewer"),
      allowNull: false,
      defaultValue: "Member",
    },
  },
  { tableName: "project_members", createdAt: "joined_at", updatedAt: false },
);

// ── project_invitations ──────────────────────────────────────────────────
const ProjectInvitation = sequelize.define(
  "ProjectInvitation",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    project_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    inviter_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    invitee_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    role: {
      type: DataTypes.ENUM("Admin", "Member", "Viewer"),
      allowNull: false,
      defaultValue: "Member",
    },
    status: {
      type: DataTypes.ENUM("Pending", "Accepted", "Rejected"),
      allowNull: false,
      defaultValue: "Pending",
    },
  },
  { tableName: "project_invitations", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── project_files ────────────────────────────────────────────────────────
const ProjectFile = sequelize.define(
  "ProjectFile",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    project_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    uploader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    original_name: { type: DataTypes.STRING(500), allowNull: false },
    stored_name: { type: DataTypes.STRING(500), allowNull: false },
    mime_type: { type: DataTypes.STRING(200), allowNull: false },
    size_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
  },
  { tableName: "project_files", createdAt: "created_at", updatedAt: false },
);

// ── project_messages (chat) ──────────────────────────────────────────────
const ProjectMessage = sequelize.define(
  "ProjectMessage",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    project_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    attachment_id: { type: DataTypes.INTEGER.UNSIGNED },
    edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { tableName: "project_messages", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── tasks ────────────────────────────────────────────────────────────────
const Task = sequelize.define(
  "Task",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(300), allowNull: false },
    description: { type: DataTypes.TEXT },
    status: {
      type: DataTypes.ENUM("Todo", "In Progress", "Review", "Done"),
      allowNull: false,
      defaultValue: "Todo",
    },
    priority: {
      type: DataTypes.ENUM("High", "Medium", "Low"),
      allowNull: false,
      defaultValue: "Medium",
    },
    project_id: { type: DataTypes.INTEGER.UNSIGNED },
    assignee_id: { type: DataTypes.INTEGER.UNSIGNED },
    reporter_id: { type: DataTypes.INTEGER.UNSIGNED },
    due_date: { type: DataTypes.DATEONLY },
    estimated_hours: { type: DataTypes.DECIMAL(6, 2) },
    actual_hours: { type: DataTypes.DECIMAL(6, 2) },
    position: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  },
  { tableName: "tasks", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── subtasks ─────────────────────────────────────────────────────────────
const Subtask = sequelize.define(
  "Subtask",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    task_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(300), allowNull: false },
    description: { type: DataTypes.TEXT },
    status: {
      type: DataTypes.ENUM("Todo", "In Progress", "Done"),
      allowNull: false,
      defaultValue: "Todo",
    },
    priority: {
      type: DataTypes.ENUM("High", "Medium", "Low"),
      allowNull: false,
      defaultValue: "Medium",
    },
    due_date: { type: DataTypes.DATEONLY },
    position: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  },
  { tableName: "subtasks", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── tags + task_tags (many-to-many) ──────────────────────────────────────
const Tag = sequelize.define(
  "Tag",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    label: { type: DataTypes.STRING(60), allowNull: false, unique: true },
  },
  { tableName: "tags", timestamps: false },
);

const TaskTag = sequelize.define(
  "TaskTag",
  {
    task_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    tag_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  },
  { tableName: "task_tags", timestamps: false },
);

// ── task_comments ────────────────────────────────────────────────────────
const TaskComment = sequelize.define(
  "TaskComment",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    task_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
  },
  { tableName: "task_comments", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── task_assignment_requests ─────────────────────────────────────────────
const TaskAssignmentRequest = sequelize.define(
  "TaskAssignmentRequest",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    task_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    requester_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    assignee_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.ENUM("Pending", "Accepted", "Rejected"),
      allowNull: false,
      defaultValue: "Pending",
    },
  },
  { tableName: "task_assignment_requests", createdAt: "created_at", updatedAt: "updated_at" },
);

// ── notifications ────────────────────────────────────────────────────────
const Notification = sequelize.define(
  "Notification",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.STRING(60), allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    action_url: { type: DataTypes.STRING(500) },
    reference_id: { type: DataTypes.INTEGER.UNSIGNED },
    reference_type: { type: DataTypes.STRING(60) },
  },
  { tableName: "notifications", createdAt: "created_at", updatedAt: false },
);

// ── activity_logs ────────────────────────────────────────────────────────
const ActivityLog = sequelize.define(
  "ActivityLog",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    project_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.INTEGER.UNSIGNED },
    event_type: { type: DataTypes.STRING(60), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    meta: { type: DataTypes.JSON },
  },
  { tableName: "activity_logs", createdAt: "created_at", updatedAt: false },
);

// ── ai_messages (AI assistant chat history) ──────────────────────────────
const AiMessage = sequelize.define(
  "AiMessage",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    project_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    role: { type: DataTypes.ENUM("user", "assistant"), allowNull: false },
    message_type: {
      type: DataTypes.ENUM("text", "tasks", "clarification", "analysis"),
      allowNull: false,
      defaultValue: "text",
    },
    content: { type: DataTypes.TEXT("medium"), allowNull: false },
  },
  { tableName: "ai_messages", createdAt: "created_at", updatedAt: false },
);

// ── Associations ─────────────────────────────────────────────────────────
Project.belongsTo(User, { as: "owner", foreignKey: "owner_id" });

Project.hasMany(ProjectMember, { as: "memberships", foreignKey: "project_id" });
ProjectMember.belongsTo(Project, { as: "project", foreignKey: "project_id" });
ProjectMember.belongsTo(User, { as: "user", foreignKey: "user_id" });

Project.hasMany(Task, { as: "tasks", foreignKey: "project_id" });
Task.belongsTo(Project, { as: "project", foreignKey: "project_id" });
Task.belongsTo(User, { as: "assignee", foreignKey: "assignee_id" });
Task.belongsTo(User, { as: "reporter", foreignKey: "reporter_id" });

Task.hasMany(Subtask, { as: "subtasks", foreignKey: "task_id" });
Subtask.belongsTo(Task, { as: "task", foreignKey: "task_id" });

Task.belongsToMany(Tag, { through: TaskTag, as: "tagList", foreignKey: "task_id", otherKey: "tag_id" });
Tag.belongsToMany(Task, { through: TaskTag, as: "tasks", foreignKey: "tag_id", otherKey: "task_id" });
TaskTag.belongsTo(Tag, { as: "tag", foreignKey: "tag_id" });

Task.hasMany(TaskComment, { as: "comments", foreignKey: "task_id" });
TaskComment.belongsTo(Task, { as: "task", foreignKey: "task_id" });
TaskComment.belongsTo(User, { as: "user", foreignKey: "user_id" });

TaskAssignmentRequest.belongsTo(Task, { as: "task", foreignKey: "task_id" });
TaskAssignmentRequest.belongsTo(User, { as: "requester", foreignKey: "requester_id" });
TaskAssignmentRequest.belongsTo(User, { as: "assignee", foreignKey: "assignee_id" });

ProjectInvitation.belongsTo(Project, { as: "project", foreignKey: "project_id" });
ProjectInvitation.belongsTo(User, { as: "inviter", foreignKey: "inviter_id" });
ProjectInvitation.belongsTo(User, { as: "invitee", foreignKey: "invitee_id" });

ProjectFile.belongsTo(User, { as: "uploader", foreignKey: "uploader_id" });

ProjectMessage.belongsTo(User, { as: "user", foreignKey: "user_id" });
ProjectMessage.belongsTo(ProjectFile, { as: "attachment", foreignKey: "attachment_id" });

ActivityLog.belongsTo(User, { as: "user", foreignKey: "user_id" });

module.exports = {
  sequelize,
  User,
  Project,
  ProjectMember,
  ProjectInvitation,
  ProjectFile,
  ProjectMessage,
  Task,
  Subtask,
  Tag,
  TaskTag,
  TaskComment,
  TaskAssignmentRequest,
  Notification,
  ActivityLog,
  AiMessage,
};
