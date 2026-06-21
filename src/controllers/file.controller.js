const db   = require("../config/db");
const path = require("path");
const fs   = require("fs");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { logActivity } = require("../utils/activity");

// ── POST /api/projects/:id/files ─────────────────────────────────────────
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, "No file uploaded", 400);

  const projectId = req.params.id;
  const { originalname, filename, mimetype, size } = req.file;

  const [result] = await db.query(
    "INSERT INTO project_files (project_id, uploader_id, original_name, stored_name, mime_type, size_bytes) VALUES (?,?,?,?,?,?)",
    [projectId, req.user.id, originalname, filename, mimetype, size]
  );

  await logActivity({
    projectId,
    userId: req.user.id,
    eventType: "file_uploaded",
    description: `${req.user.name} uploaded "${originalname}"`,
    meta: { file_id: result.insertId, file_name: originalname },
  });

  const [rows] = await db.query(
    `SELECT pf.*, u.name AS uploader_name, u.initials AS uploader_initials, u.color AS uploader_color
     FROM project_files pf JOIN users u ON u.id = pf.uploader_id WHERE pf.id = ?`,
    [result.insertId]
  );
  created(res, rows[0], "File uploaded");
});

// ── GET /api/projects/:id/files ──────────────────────────────────────────
const getProjectFiles = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT pf.*, u.name AS uploader_name, u.initials AS uploader_initials, u.color AS uploader_color
     FROM project_files pf JOIN users u ON u.id = pf.uploader_id
     WHERE pf.project_id = ?
     ORDER BY pf.created_at DESC`,
    [req.params.id]
  );
  ok(res, rows);
});

// ── GET /api/projects/:id/files/:fileId/download ─────────────────────────
const downloadFile = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM project_files WHERE id = ? AND project_id = ?",
    [req.params.fileId, req.params.id]
  );
  if (!rows.length) return fail(res, "File not found", 404);

  const file = rows[0];
  const filePath = path.join(__dirname, "../../uploads/project-files", file.stored_name);
  if (!fs.existsSync(filePath)) return fail(res, "File not found on disk", 404);

  res.download(filePath, file.original_name);
});

// ── DELETE /api/projects/:id/files/:fileId ───────────────────────────────
const deleteFile = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const [rows] = await db.query(
    "SELECT * FROM project_files WHERE id = ? AND project_id = ?",
    [req.params.fileId, projectId]
  );
  if (!rows.length) return fail(res, "File not found", 404);
  const file = rows[0];

  // Only uploader, Owner, or Admin can delete
  const isUploader = file.uploader_id === req.user.id;
  const isOwnerOrAdmin = ["Owner", "Admin"].includes(req.projectRole);
  if (!isUploader && !isOwnerOrAdmin) return fail(res, "Not authorized to delete this file", 403);

  // Remove from disk
  const filePath = path.join(__dirname, "../../uploads/project-files", file.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await db.query("DELETE FROM project_files WHERE id = ?", [file.id]);

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
