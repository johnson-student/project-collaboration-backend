const express = require("express");
const router  = express.Router();
const { getMyInvitations, respondToInvitation } = require("../controllers/invitation.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

// Current user's invitations
router.get("/my", getMyInvitations);
router.patch("/:id/respond", respondToInvitation);

module.exports = router;
