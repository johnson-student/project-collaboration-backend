const express = require('express');
const router = express.Router({ mergeParams: true });
const {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  assignTask,
  getTasksByProject,
  addComment,
  editComment,
  deleteComment,
  getSubtasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  patchSubtaskStatus,
  reorderSubtasks,
} = require('../controllers/task.controller');
const {
  createAssignmentRequest,
  getTaskAssignmentRequests,
} = require('../controllers/assignment.controller');
const {
  protect,
  requireProjectMember,
} = require('../middleware/auth.middleware');

router.use(protect);

router.get('/by-project', requireProjectMember, getTasksByProject);

router.get('/', getTasks);
router.post('/', createTask);
router.get('/:id', getTaskById);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);
router.patch('/:id/status', moveTask);
router.patch('/:id/assign', assignTask);

// Comments
router.post('/:id/comments', addComment);
router.put('/:id/comments/:commentId', editComment);
router.delete('/:id/comments/:commentId', deleteComment);

// Subtasks — specific paths before param paths to avoid Express ambiguity
router.get('/:id/subtasks', getSubtasks);
router.post('/:id/subtasks', createSubtask);
router.patch('/:id/subtasks/reorder', reorderSubtasks);
router.patch('/:id/subtasks/:subtaskId/status', patchSubtaskStatus);
router.put('/:id/subtasks/:subtaskId', updateSubtask);
router.delete('/:id/subtasks/:subtaskId', deleteSubtask);

// Assignment requests
router.post('/:id/assignment-request', createAssignmentRequest);
router.get('/:id/assignment-requests', getTaskAssignmentRequests);

module.exports = router;
