const multer = require("multer");
const path   = require("path");
const { v4: uuidv4 } = require("uuid");

const ALLOWED_TYPES = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".csv", ".json", ".xml",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".zip", ".rar", ".tar", ".gz",
  ".mp4", ".mp3", ".mov",
];

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../uploads/project-files"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `pf-${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_TYPES.includes(ext)) return cb(null, true);
  cb(new Error(`File type ${ext} is not allowed`), false);
};

const projectFileUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
}).single("file");

module.exports = { projectFileUpload };
