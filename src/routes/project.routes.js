const express = require("express");
const router  = express.Router();
const {
  getProjects, getProjectById, createProject, updateProject, deleteProject,
  getProjectMembers, addProjectMember, removeProjectMember, getProjectStats,
} = require("../controllers/project.controller");
const { createInvitation, getProjectInvitations, cancelInvitation } = require("../controllers/invitation.controller");
const { uploadFile, getProjectFiles, downloadFile, deleteFile } = require("../controllers/file.controller");
const { getProjectActivity } = require("../controllers/activity.controller");
const { getProjectMessages, sendMessage, editMessage, deleteMessage } = require("../controllers/chat.controller");
const { protect, requireProjectMember, requireProjectOwnerOrAdmin } = require("../middleware/auth.middleware");
const { projectFileUpload } = require("../middleware/fileUpload.middleware");

// All project routes require a valid JWT
router.use(protect);

// ── Collection ──────────────────────────────────────────────────────────
router.get("/",   getProjects);
router.post("/",  createProject);

// ── Single project ──────────────────────────────────────────────────────
router.get   ("/:id",        requireProjectMember, getProjectById);
router.put   ("/:id",        requireProjectMember, requireProjectOwnerOrAdmin, updateProject);
router.delete("/:id",        requireProjectMember, deleteProject);
router.get   ("/:id/stats",  requireProjectMember, getProjectStats);

// ── Member management ───────────────────────────────────────────────────
router.get   ("/:id/members",         requireProjectMember, getProjectMembers);
// Keep addProjectMember for backward compat (used in createProject flow)
router.post  ("/:id/members",         requireProjectMember, requireProjectOwnerOrAdmin, addProjectMember);
router.delete("/:id/members/:userId", requireProjectMember, requireProjectOwnerOrAdmin, removeProjectMember);

// ── Invitations ─────────────────────────────────────────────────────────
router.get   ("/:id/invitations",                  requireProjectMember, requireProjectOwnerOrAdmin, getProjectInvitations);
router.post  ("/:id/invitations",                  requireProjectMember, requireProjectOwnerOrAdmin, createInvitation);
router.delete("/:id/invitations/:invitationId",    requireProjectMember, requireProjectOwnerOrAdmin, cancelInvitation);

// ── Files ────────────────────────────────────────────────────────────────
router.get   ("/:id/files",                  requireProjectMember, getProjectFiles);
router.post  ("/:id/files",                  requireProjectMember, (req, res, next) => {
  projectFileUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, uploadFile);
router.get   ("/:id/files/:fileId/download", requireProjectMember, downloadFile);
router.delete("/:id/files/:fileId",          requireProjectMember, deleteFile);

// ── Activity ─────────────────────────────────────────────────────────────
router.get("/:id/activity", requireProjectMember, getProjectActivity);

// ── Chat ─────────────────────────────────────────────────────────────────
router.get   ("/:id/messages",                requireProjectMember, getProjectMessages);
router.post  ("/:id/messages",                requireProjectMember, sendMessage);
router.put   ("/:id/messages/:messageId",     requireProjectMember, editMessage);
router.delete("/:id/messages/:messageId",     requireProjectMember, deleteMessage);

module.exports = router;
