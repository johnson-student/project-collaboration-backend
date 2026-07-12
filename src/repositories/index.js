// Central export point for the data-access layer (repository pattern).
// Controllers, middleware, utils and the socket layer go through these
// repositories — they never touch the Sequelize models directly.
const { sequelize } = require("../models");

module.exports = {
  // Runs several repository calls inside one atomic DB transaction.
  withTransaction: (fn) => sequelize.transaction(fn),
  userRepository: require("./user.repository"),
  projectRepository: require("./project.repository"),
  taskRepository: require("./task.repository"),
  invitationRepository: require("./invitation.repository"),
  assignmentRepository: require("./assignment.repository"),
  fileRepository: require("./file.repository"),
  chatRepository: require("./chat.repository"),
  notificationRepository: require("./notification.repository"),
  activityRepository: require("./activity.repository"),
  aiRepository: require("./ai.repository"),
};
