const { chatRepository, fileRepository } = require("../repositories");
const { ok, created, fail, noContent } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { emitToProject } = require("../socket");
const { logActivity } = require("../utils/activity");

// Flatten the included user/attachment into the flat snake_case shape the
// frontend expects (same as the old JOINed SQL rows).
const serializeMessage = (row) => {
  const { user, attachment, ...pm } = row.get({ plain: true });
  return {
    ...pm,
    user_name: user.name,
    initials: user.initials,
    color: user.color,
    avatar: user.avatar,
    attachment_name: attachment?.original_name ?? null,
    attachment_stored_name: attachment?.stored_name ?? null,
    attachment_mime: attachment?.mime_type ?? null,
    attachment_size: attachment?.size_bytes ?? null,
  };
};

// ── GET /api/projects/:id/messages?before=<id>&limit=50 ─────────────────
// Cursor-paginated, returns newest page by default (oldest-first within page)
const getProjectMessages = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before ? Number(req.query.before) : null;

  const rows = await chatRepository.listByProject(projectId, { before, limit });

  // Return oldest-first for natural chat rendering
  ok(res, rows.reverse().map(serializeMessage));
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
    const file = await fileRepository.create({
      project_id: projectId,
      uploader_id: req.user.id,
      original_name: originalname,
      stored_name: filename,
      mime_type: mimetype,
      size_bytes: size,
    });
    attachmentId = file.id;

    await logActivity({
      projectId,
      userId: req.user.id,
      eventType: "file_uploaded",
      description: `${req.user.name} shared "${originalname}" in chat`,
      meta: { file_id: attachmentId, file_name: originalname },
    });
  }

  const newMessage = await chatRepository.create({
    project_id: projectId,
    user_id: req.user.id,
    body,
    attachment_id: attachmentId,
  });

  const row = await chatRepository.findByIdWithIncludes(newMessage.id);
  const message = serializeMessage(row);

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

  const existing = await chatRepository.findInProject(messageId, projectId);
  if (!existing) return fail(res, "Message not found", 404);
  if (existing.user_id !== req.user.id) return fail(res, "Cannot edit another user's message", 403);

  await chatRepository.updateById(existing.id, { body: body.trim(), edited: true });

  const row = await chatRepository.findByIdWithIncludes(messageId);
  const message = serializeMessage(row);

  emitToProject(projectId, "chat:message:edited", message);

  ok(res, message, "Message updated");
});

// ── DELETE /api/projects/:id/messages/:messageId ─────────────────────────
const deleteMessage = asyncHandler(async (req, res) => {
  const { id: projectId, messageId } = req.params;

  const existing = await chatRepository.findInProject(messageId, projectId);
  if (!existing) return fail(res, "Message not found", 404);

  const isAuthor = existing.user_id === req.user.id;
  const isOwnerOrAdmin = ["Owner", "Admin"].includes(req.projectRole);
  if (!isAuthor && !isOwnerOrAdmin) return fail(res, "Not authorized to delete this message", 403);

  await chatRepository.deleteById(existing.id);

  emitToProject(projectId, "chat:message:deleted", { id: Number(messageId) });

  noContent(res);
});

module.exports = { getProjectMessages, sendMessage, editMessage, deleteMessage };
