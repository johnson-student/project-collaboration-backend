const express = require("express");
const router  = express.Router();
const { getMyAssignmentRequests, respondToAssignment } = require("../controllers/assignment.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/assignments/my", getMyAssignmentRequests);
router.patch("/assignments/:id/respond", respondToAssignment);

module.exports = router;
