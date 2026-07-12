const path = require("path");
const fs   = require("fs");
const { fileRepository } = require("../repositories");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { logActivity } = require("../utils/activity");

const serializeFile = (row) => {
  const { uploader, ...file } = row.get({ plain: true });
  return {
    ...file,
    uploader_name: uploader.name,
    uploader_initials: uploader.initials,
    uploader_color: uploader.color,
  };
};

// ── POST /api/projects/:id/files ─────────────────────────────────────────
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, "No file uploaded", 400);

  const projectId = req.params.id;
  const { originalname, filename, mimetype, size } = req.file;

  const file = await fileRepository.create({
    project_id: projectId,
    uploader_id: req.user.id,
    original_name: originalname,
    stored_name: filename,
    mime_type: mimetype,
    size_bytes: size,
  });

  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "file_uploaded",
    description: `${req.user.name} uploaded "${originalname}"`,
    meta: { file_id: file.id, file_name: originalname },
  });

  const row = await fileRepository.findByIdWithUploader(file.id);
  created(res, serializeFile(row), "File uploaded");
});

// ── GET /api/projects/:id/files ──────────────────────────────────────────
const getProjectFiles = asyncHandler(async (req, res) => {
  const rows = await fileRepository.listByProject(req.params.id);
  ok(res, rows.map(serializeFile));
});

// ── GET /api/projects/:id/files/:fileId/download ─────────────────────────
const downloadFile = asyncHandler(async (req, res) => {
  const file = await fileRepository.findInProject(req.params.fileId, req.params.id);
  if (!file) return fail(res, "File not found", 404);

  const filePath = path.join(__dirname, "../../uploads/project-files", file.stored_name);
  if (!fs.existsSync(filePath)) return fail(res, "File not found on disk", 404);

  res.download(filePath, file.original_name);
});

// ── DELETE /api/projects/:id/files/:fileId ───────────────────────────────
const deleteFile = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const file = await fileRepository.findInProject(req.params.fileId, projectId);
  if (!file) return fail(res, "File not found", 404);

  // Only uploader, Owner, or Admin can delete
  const isUploader = file.uploader_id === req.user.id;
  const isOwnerOrAdmin = ["Owner", "Admin"].includes(req.projectRole);
  if (!isUploader && !isOwnerOrAdmin) return fail(res, "Not authorized to delete this file", 403);

  // Remove from disk
  const filePath = path.join(__dirname, "../../uploads/project-files", file.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await fileRepository.deleteById(file.id);

  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "file_deleted",
    description: `${req.user.name} deleted "${file.original_name}"`,
    meta: { file_name: file.original_name },
  });

  noContent(res);
});

module.exports = { uploadFile, getProjectFiles, downloadFile, deleteFile };
