const db = require("../config/db");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { emitToProject } = require("../socket");
const { logActivity } = require("../utils/activity");

const messageFields = `
  pm.*, u.name AS user_name, u.initials, u.color, u.avatar,
  pf.original_name AS attachment_name, pf.stored_name AS attachment_stored_name,
  pf.mime_type AS attachment_mime, pf.size_bytes AS attachment_size
`;

const messageJoins = `
  FROM project_messages pm
  JOIN users u ON u.id = pm.user_id
  LEFT JOIN project_files pf ON pf.id = pm.attachment_id
`;

const selectMessage = `SELECT ${messageFields} ${messageJoins} WHERE pm.id = ?`;

// ── GET /api/projects/:id/messages?before=<id>&limit=50 ─────────────────
// Cursor-paginated, returns newest page by default (oldest-first within page)
const getProjectMessages = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before ? Number(req.query.before) : null;

  const params = [projectId];
  let whereClause = "WHERE pm.project_id = ?";
  if (before) {
    whereClause += " AND pm.id < ?";
    params.push(before);
  }

  const [rows] = await db.query(
    `SELECT ${messageFields}
     ${messageJoins}
     ${whereClause}
     ORDER BY pm.id DESC
     LIMIT ?`,
    [...params, limit]
  );

  // Return oldest-first for natural chat rendering
  ok(res, rows.reverse());
});

// ── POST /api/projects/:id/messages ──────────────────────────────────────
// Accepts JSON ({ body }) or multipart/form-data with an optional "file"
// field. An uploaded file is registered in project_files, so it also shows
// up on the project's Files page.
const sendMessage = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const body = (req.body?.body || "").trim();
  if (!body && !req.file) return fail(res, "Message body or attachment is required", 400);
  if (body.length > 4000) return fail(res, "Message is too long (max 4000 characters)", 400);

  let attachmentId = null;
  if (req.file) {
    const { originalname, filename, mimetype, size } = req.file;
    const [fileResult] = await db.query(
      "INSERT INTO project_files (project_id, uploader_id, original_name, stored_name, mime_type, size_bytes) VALUES (?,?,?,?,?,?)",
      [projectId, req.user.id, originalname, filename, mimetype, size]
    );
    attachmentId = fileResult.insertId;

    await logActivity({
      projectId,
      userId: req.user.id,
      eventType: "file_uploaded",
      description: `${req.user.name} shared "${originalname}" in chat`,
      meta: { file_id: attachmentId, file_name: originalname },
    });
  }

  const [result] = await db.query(
    "INSERT INTO project_messages (project_id, user_id, body, attachment_id) VALUES (?,?,?,?)",
    [projectId, req.user.id, body, attachmentId]
  );

  const [rows] = await db.query(selectMessage, [result.insertId]);
  const message = rows[0];

  // Broadcast to everyone in the project room (including sender's other tabs)
  emitToProject(projectId, "chat:message", message);

  created(res, message, "Message sent");
});

// ── PUT /api/projects/:id/messages/:messageId ────────────────────────────
const editMessage = asyncHandler(async (req, res) => {
  const { id: projectId, messageId } = req.params;
  const { body } = req.body;
  if (!body?.trim()) return fail(res, "Message body is required", 400);
  if (body.length > 4000) return fail(res, "Message is too long (max 4000 characters)", 400);

  const [rows] = await db.query(
    "SELECT * FROM project_messages WHERE id = ? AND project_id = ?",
    [messageId, projectId]
  );
  if (!rows.length) return fail(res, "Message not found", 404);
  if (rows[0].user_id !== req.user.id) return fail(res, "Cannot edit another user's message", 403);

  await db.query(
    "UPDATE project_messages SET body = ?, edited = 1 WHERE id = ?",
    [body.trim(), messageId]
  );

  const [updated] = await db.query(selectMessage, [messageId]);
  const message = updated[0];

  emitToProject(projectId, "chat:message:edited", message);

  ok(res, message, "Message updated");
});

// ── DELETE /api/projects/:id/messages/:messageId ─────────────────────────
const deleteMessage = asyncHandler(async (req, res) => {
  const { id: projectId, messageId } = req.params;

  const [rows] = await db.query(
    "SELECT user_id FROM project_messages WHERE id = ? AND project_id = ?",
    [messageId, projectId]
  );
  if (!rows.length) return fail(res, "Message not found", 404);

  const isAuthor = rows[0].user_id === req.user.id;
  const isOwnerOrAdmin = ["Owner", "Admin"].includes(req.projectRole);
  if (!isAuthor && !isOwnerOrAdmin) return fail(res, "Not authorized to delete this message", 403);

  await db.query("DELETE FROM project_messages WHERE id = ?", [messageId]);

  emitToProject(projectId, "chat:message:deleted", { id: Number(messageId) });

  noContent(res);
});

module.exports = { getProjectMessages, sendMessage, editMessage, deleteMessage };
