const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const path     = require("path");
const {
  getUsers, searchUsers, getUserById, updateUser, updateAvatar, deleteUser,
} = require("../controllers/user.controller");
const { protect } = require("../middleware/auth.middleware");

const storage = multer.diskStorage({
  destination: "uploads/avatars/",
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".jpg",".jpeg",".png",".webp"];
    allowed.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error("Only image files are allowed"));
  },
});

router.use(protect);

router.get   ("/",           getUsers);
router.get   ("/search",     searchUsers);
router.get   ("/:id",        getUserById);
router.put   ("/:id",        updateUser);
router.post  ("/:id/avatar", upload.single("avatar"), updateAvatar);
router.delete("/:id",        deleteUser);

module.exports = router;
