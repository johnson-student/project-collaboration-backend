const { aiRepository, projectRepository, taskRepository } = require("../repositories");
const { ok, noContent, fail } = require("../utils/response");
const { asyncHandler } = require("../middleware/error.middleware");
const { callGemini } = require("../utils/gemini");
const { logActivity } = require("../utils/activity");
const { createNotification } = require("../utils/notification");

const GENERATE_COMMAND = "/generate-task";
const HISTORY_LIMIT = 20;
const MAX_GENERATED_TASKS = 15;
const MAX_MESSAGE_LENGTH = 4000;

// Structured output contract for /generate-task: the model must either
// return concrete tasks OR ask clarifying questions — never free text.
const taskGenerationSchema = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["tasks", "clarification"] },
    message: {
      type: "STRING",
      description: "Short conversational reply shown in the chat above the tasks or questions",
    },
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          priority: { type: "STRING", enum: ["High", "Medium", "Low"] },
          estimatedHours: { type: "NUMBER" },
        },
        required: ["title", "description", "priority"],
      },
    },
    questions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["type", "message"],
};

// ── Chat tools (Gemini function calling) ─────────────────────────────────
const PROJECT_STATUSES = ["Planning", "In Progress", "Review", "Completed", "On Hold"];
const PRIORITIES = ["High", "Medium", "Low"];
const MAX_SUBTASKS_PER_CALL = 20;

const chatTools = [
  {
    functionDeclarations: [
      {
        name: "update_project",
        description:
          "Update this project's details. Only include the fields the user asked to change. Requires the user to be the project Owner or an Admin.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "New project name" },
            description: { type: "STRING", description: "New project description" },
            deadline: {
              type: "STRING",
              description: "New deadline as YYYY-MM-DD, or an empty string to remove the deadline",
            },
            status: { type: "STRING", enum: PROJECT_STATUSES },
            priority: { type: "STRING", enum: PRIORITIES },
          },
        },
      },
      {
        name: "create_subtasks",
        description:
          "Add subtasks (checklist items) to one existing task in this project. taskId is the numeric id from the EXISTING TASKS list. When the user asks to generate subtasks, devise them yourself from context and pass them here.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: { type: "NUMBER" },
            subtasks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  description: { type: "STRING" },
                  priority: { type: "STRING", enum: PRIORITIES },
                },
                required: ["title"],
              },
            },
          },
          required: ["taskId", "subtasks"],
        },
      },
      {
        name: "assign_task",
        description:
          "Assign an existing task in this project to a team member (or unassign it). taskId is the numeric id from the EXISTING TASKS list; assigneeId is the numeric user id from the TEAM list, or 0 to unassign the task.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: { type: "NUMBER" },
            assigneeId: {
              type: "NUMBER",
              description: "User id from the TEAM list, or 0 to remove the current assignee",
            },
          },
          required: ["taskId", "assigneeId"],
        },
      },
    ],
  },
];

const runUpdateProject = async (args, { projectId, user, projectRole }) => {
  if (!["Owner", "Admin"].includes(projectRole)) {
    return {
      success: false,
      error: `Permission denied — only the project Owner or an Admin can update project details (the user's role is ${projectRole}).`,
    };
  }
  const fields = {};
  if (typeof args.name === "string" && args.name.trim()) fields.name = args.name.trim().slice(0, 200);
  if (typeof args.description === "string") fields.description = args.description.trim();
  if (typeof args.deadline === "string") {
    if (args.deadline.trim() === "") fields.deadline = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(args.deadline.trim())) fields.deadline = args.deadline.trim();
    else return { success: false, error: "deadline must be in YYYY-MM-DD format" };
  }
  if (args.status !== undefined) {
    if (!PROJECT_STATUSES.includes(args.status)) return { success: false, error: `status must be one of: ${PROJECT_STATUSES.join(", ")}` };
    fields.status = args.status;
  }
  if (args.priority !== undefined) {
    if (!PRIORITIES.includes(args.priority)) return { success: false, error: `priority must be one of: ${PRIORITIES.join(", ")}` };
    fields.priority = args.priority;
  }
  const keys = Object.keys(fields);
  if (!keys.length) return { success: false, error: "No valid fields to update were provided" };

  await projectRepository.updateById(projectId, fields);
  logActivity({
    projectId,
    userId: user.id,
    eventType: "project_updated",
    description: `${user.name} updated project ${keys.join(", ")} via AI assistant`,
  });
  return { success: true, updated: fields };
};

const runCreateSubtasks = async (args, { projectId }) => {
  const taskId = Number(args.taskId);
  if (!Number.isInteger(taskId)) return { success: false, error: "taskId must be a task id number from the EXISTING TASKS list" };
  const task = await taskRepository.findInProject(taskId, projectId);
  if (!task) return { success: false, error: `Task #${taskId} was not found in this project` };

  const subtasks = (Array.isArray(args.subtasks) ? args.subtasks : [])
    .filter((s) => typeof s?.title === "string" && s.title.trim())
    .slice(0, MAX_SUBTASKS_PER_CALL)
    .map((s) => ({
      title: s.title.trim().slice(0, 300),
      description: typeof s.description === "string" && s.description.trim() ? s.description.trim() : null,
      priority: PRIORITIES.includes(s.priority) ? s.priority : "Medium",
    }));
  if (!subtasks.length) return { success: false, error: "No valid subtasks were provided" };

  let position = (await taskRepository.maxSubtaskPosition(taskId)) || 0;
  for (const s of subtasks) {
    position += 1;
    await taskRepository.createSubtask({
      task_id: taskId,
      title: s.title,
      description: s.description,
      priority: s.priority,
      position,
    });
  }
  return {
    success: true,
    taskId,
    taskTitle: task.title,
    created: subtasks.map((s) => s.title),
  };
};

const runAssignTask = async (args, { projectId, user }) => {
  const taskId = Number(args.taskId);
  const assigneeId = Number(args.assigneeId);
  if (!Number.isInteger(taskId)) return { success: false, error: "taskId must be a task id number from the EXISTING TASKS list" };
  if (!Number.isInteger(assigneeId) || assigneeId < 0)
    return { success: false, error: "assigneeId must be a user id from the TEAM list, or 0 to unassign" };

  const task = await taskRepository.findInProject(taskId, projectId);
  if (!task) return { success: false, error: `Task #${taskId} was not found in this project` };

  if (assigneeId === 0) {
    if (task.assignee_id === null) return { success: false, error: `Task "${task.title}" is already unassigned` };
    await taskRepository.updateById(taskId, { assignee_id: null });
    logActivity({
      projectId,
      userId: user.id,
      eventType: "task_assigned",
      description: `${user.name} unassigned "${task.title}" via AI assistant`,
      meta: { task_id: taskId },
    });
    return { success: true, taskId, taskTitle: task.title, assignee: null };
  }

  const membership = await projectRepository.findMembershipWithUser(projectId, assigneeId, ["id", "name"]);
  const assignee = membership?.user;
  if (!assignee)
    return { success: false, error: `User id ${assigneeId} is not a member of this project — use a user id from the TEAM list` };
  if (task.assignee_id === assignee.id)
    return { success: false, error: `Task "${task.title}" is already assigned to ${assignee.name}` };

  await taskRepository.updateById(taskId, { assignee_id: assigneeId });

  if (assigneeId !== user.id) {
    await createNotification({
      userId: assigneeId,
      type: "task_assigned",
      title: "Task assigned to you",
      message: `${user.name} assigned "${task.title}" to you`,
      actionUrl: `/tasks/${taskId}`,
    });
  }
  logActivity({
    projectId,
    userId: user.id,
    eventType: "task_assigned",
    description: `${user.name} assigned "${task.title}" to ${assignee.name} via AI assistant`,
    meta: { task_id: taskId, assignee_id: assigneeId },
  });
  return { success: true, taskId, taskTitle: task.title, assignee: assignee.name };
};

const TOOL_RUNNERS = {
  update_project: runUpdateProject,
  create_subtasks: runCreateSubtasks,
  assign_task: runAssignTask,
};

// ── Context gathering ────────────────────────────────────────────────────
const buildProjectContext = async (projectId) => {
  const project = await projectRepository.findById(projectId, {
    attributes: ["name", "description", "status", "priority", "category", "deadline", "progress"],
    raw: true,
  });
  const memberships = await projectRepository.findMembershipsByProject(projectId, {
    userAttributes: ["id", "name"],
  });
  const members = memberships.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role }));

  const taskRows = await taskRepository.listByProject(projectId, {
    order: [["created_at", "DESC"]],
    limit: 100,
  });
  const subtaskCounts = await taskRepository.subtaskCountsByTasks(taskRows.map((t) => t.id));
  const tasks = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee_name: t.assignee?.name ?? null,
    subtask_count: subtaskCounts[t.id]?.total || 0,
  }));
  return { project, members, tasks };
};

const contextBlock = ({ project, members, tasks }) => `PROJECT CONTEXT
- Name: ${project.name}
- Description: ${project.description?.trim() || "(none provided)"}
- Category: ${project.category}
- Status: ${project.status} · Priority: ${project.priority} · Progress: ${project.progress}%
- Deadline: ${project.deadline ? new Date(project.deadline).toISOString().slice(0, 10) : "(none)"}

TEAM (${members.length})
${members.map((m) => `- ${m.name} (${m.role}, user id ${m.id})`).join("\n") || "- (no members)"}

EXISTING TASKS (${tasks.length})
${tasks.map((t) => `- #${t.id} [${t.status}] ${t.title} (${t.priority}, ${t.assignee_name ? `assigned to ${t.assignee_name}` : "unassigned"}, ${Number(t.subtask_count) ? `${t.subtask_count} subtasks` : "no subtasks"})`).join("\n") || "- (no tasks yet)"}`;

const chatSystemPrompt = (ctx) => `You are CollabFlow AI, a project management assistant embedded in the CollabFlow app. You are chatting with a member of the project described below. Help them understand, plan, and organize the project: answer questions, suggest priorities, break down work, spot risks.

You have tools and you MUST use them when the user asks for these actions:
- update_project: change the project's name, description, deadline, status, or priority. Only works if the user is the project Owner or an Admin — if the tool reports a permission error, relay it.
- create_subtasks: add subtasks (checklist items) to an existing task. Use the numeric id shown in EXISTING TASKS (e.g. #12) — never ask the user for an id; match the task they name (or described) to the list yourself, and only ask if two tasks genuinely match equally well. When the user asks you to generate or suggest subtasks, invent 3–8 specific subtasks yourself from the task title and project context and call the tool with them immediately — do NOT ask the user to provide the list. If the user targets several tasks (e.g. "all tasks", "the remaining tasks"), resolve the set yourself from EXISTING TASKS — "remaining" means tasks with no subtasks and not Done — and call create_subtasks once per task until every one of them is covered.
- assign_task: assign a task to a team member, or unassign it (assigneeId 0). Match the member the user names to the TEAM list yourself and pass their user id — never ask for an id. Match tasks the same way as create_subtasks. If the user asks to distribute or balance several tasks across the team, decide a sensible split yourself from EXISTING TASKS (current assignees are shown there) and call assign_task once per task. Only ask when a name genuinely matches more than one member.

Tool rules:
- Never claim something was changed or created unless the tool call returned success. If it failed, tell the user exactly why.
- After a successful call, briefly confirm what changed.
- To create top-level project tasks, do NOT use tools — tell the user to type ${GENERATE_COMMAND}.

Be concise and practical. Write plain conversational text only (short paragraphs or "-" bullet lists; no markdown headers, no tables, and NEVER raw JSON).

${contextBlock(ctx)}`;

const generateSystemPrompt = (ctx) => `You are CollabFlow AI, a project management assistant. The user typed ${GENERATE_COMMAND} to auto-generate tasks for the project described below. The conversation so far may contain extra requirements — use it.

Decide between two responses:
1. type "tasks" — when the project context plus conversation gives enough detail to produce 3–10 specific, actionable tasks. Rules:
   - Never invent generic filler like "Set up project" or "Do testing" — every task must be clearly grounded in this project's goal.
   - Never duplicate or rephrase an EXISTING TASK.
   - Titles are imperative and specific; descriptions are 1–3 sentences of what and why; estimatedHours is a realistic effort estimate.
2. type "clarification" — when the description is empty or too vague to meet the rules above. Ask 2–4 short, concrete questions (e.g. about goals, tech stack, target users, deadline scope). Prefer this over guessing.

"message" is always a short friendly sentence introducing the tasks or the questions.

${contextBlock(ctx)}`;

// ── Output validation ────────────────────────────────────────────────────
// Never trust model output: parse, clamp, and coerce before storing.
const normalizeGenerated = (raw) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }

  if (parsed?.type === "tasks" && Array.isArray(parsed.tasks)) {
    const tasks = parsed.tasks
      .filter((t) => typeof t?.title === "string" && t.title.trim())
      .slice(0, MAX_GENERATED_TASKS)
      .map((t) => ({
        title: t.title.trim().slice(0, 300),
        description: String(t.description || "").trim(),
        priority: ["High", "Medium", "Low"].includes(t.priority) ? t.priority : "Medium",
        estimatedHours:
          Number.isFinite(Number(t.estimatedHours)) && Number(t.estimatedHours) > 0
            ? Math.round(Number(t.estimatedHours) * 100) / 100
            : null,
      }));
    if (tasks.length) {
      return {
        type: "tasks",
        message: String(parsed.message || "Here are the tasks I'd suggest:").trim(),
        tasks,
      };
    }
  }

  if (parsed?.type === "clarification" && Array.isArray(parsed.questions) && parsed.questions.length) {
    return {
      type: "clarification",
      message: String(parsed.message || "I need a bit more detail before generating tasks:").trim(),
      questions: parsed.questions.slice(0, 5).map((q) => String(q).trim()).filter(Boolean),
    };
  }

  return null;
};

// Structured messages are stored as JSON; feed the model a readable summary
// instead so it doesn't learn to reply with raw JSON in normal chat.
const historyText = (m) => {
  if (m.message_type === "text") return m.content;
  try {
    const p = JSON.parse(m.content);
    if (p.type === "tasks")
      return `${p.message}\n(Suggested ${p.tasks.length} draft tasks: ${p.tasks.map((t) => t.title).join("; ")})`;
    if (p.type === "clarification")
      return `${p.message}\n${p.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
  } catch { /* fall through to raw content */ }
  return m.content;
};

// ── Persistence helpers ──────────────────────────────────────────────────
const saveMessage = (projectId, userId, role, messageType, content) =>
  aiRepository.create({
    project_id: projectId,
    user_id: userId,
    role,
    message_type: messageType,
    content,
  });

// ── GET /api/projects/:id/ai/messages ────────────────────────────────────
const getAiMessages = asyncHandler(async (req, res) => {
  const rows = await aiRepository.listByProjectAndUser(req.params.id, req.user.id, 200);
  ok(res, rows);
});

// ── POST /api/projects/:id/ai/chat ───────────────────────────────────────
const sendAiMessage = asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return fail(res, "Message is required");
  if (message.length > MAX_MESSAGE_LENGTH)
    return fail(res, `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);

  const isGenerate = message.toLowerCase().startsWith(GENERATE_COMMAND);

  // History is read before inserting the new message so it isn't doubled.
  const historyDesc = await aiRepository.listRecent(projectId, req.user.id, HISTORY_LIMIT);
  const contents = historyDesc
    .reverse()
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: historyText(m) }] }));
  contents.push({ role: "user", parts: [{ text: message }] });

  const userRow = await saveMessage(projectId, req.user.id, "user", "text", message);

  const ctx = await buildProjectContext(projectId);
  const actions = []; // successful tool calls, so the client can refresh caches
  let aiRow;
  try {
    if (isGenerate) {
      const raw = await callGemini({
        systemPrompt: generateSystemPrompt(ctx),
        contents,
        responseSchema: taskGenerationSchema,
      });
      const payload = normalizeGenerated(raw);
      aiRow = payload
        ? await saveMessage(projectId, req.user.id, "assistant", payload.type, JSON.stringify(payload))
        : await saveMessage(projectId, req.user.id, "assistant", "text",
            "Sorry — I couldn't produce a valid task list this time. Please try again, or add more detail about what you want.");
    } else {
      const text = await callGemini({
        systemPrompt: chatSystemPrompt(ctx),
        contents,
        tools: chatTools,
        executeTool: async (name, args) => {
          const runner = TOOL_RUNNERS[name];
          if (!runner) return { success: false, error: `Unknown tool: ${name}` };
          const result = await runner(args, {
            projectId,
            user: req.user,
            projectRole: req.projectRole,
          });
          if (result.success) actions.push({ tool: name, taskId: result.taskId });
          return result;
        },
      });
      aiRow = await saveMessage(projectId, req.user.id, "assistant", "text", text);
    }
  } catch (err) {
    // Surface AI failures as a chat message so the conversation (and the
    // already-saved user message) stays consistent on the client.
    aiRow = await saveMessage(projectId, req.user.id, "assistant", "text",
      `⚠️ ${err.message || "The AI service is unavailable right now — please try again."}`);
  }

  ok(res, { messages: [userRow, aiRow], actions });
});

// ── DELETE /api/projects/:id/ai/messages ─────────────────────────────────
const clearAiMessages = asyncHandler(async (req, res) => {
  await aiRepository.clearByProjectAndUser(req.params.id, req.user.id);
  noContent(res);
});

module.exports = { getAiMessages, sendAiMessage, clearAiMessages };
