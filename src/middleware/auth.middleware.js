const jwt = require("jsonwebtoken");
const { userRepository, projectRepository } = require("../repositories");

const signAccess  = (p) => jwt.sign(p, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN         || "15m" });
const signRefresh = (p) => jwt.sign(p, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d"  });

const protect = async (req, res, next) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return res.status(401).json({ success:false, message:"No token provided" });
    const token = h.split(" ")[1];
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
    catch(err) { return res.status(401).json({ success:false, message: err.name==="TokenExpiredError"?"Token expired":"Invalid token" }); }
    const user = await userRepository.findById(decoded.id, {
      attributes: ["id", "name", "email", "role", "avatar", "initials", "color", "status"],
    });
    if (!user) return res.status(401).json({ success:false, message:"User not found" });
    req.user = user.get({ plain: true });
    next();
  } catch(err) { next(err); }
};

// Enforce project membership. Reads :id or :projectId from params.
// Attaches req.projectRole = Owner|Admin|Member|Viewer
const requireProjectMember = async (req, res, next) => {
  try {
    const projectId = req.params.id || req.params.projectId;
    const membership = await projectRepository.findMembership(projectId, req.user.id);
    if (!membership) return res.status(403).json({ success:false, message:"Access denied — not a project member" });
    req.projectRole = membership.role;
    next();
  } catch(err) { next(err); }
};

const requireProjectOwnerOrAdmin = (req, res, next) => {
  if (!["Owner","Admin"].includes(req.projectRole))
    return res.status(403).json({ success:false, message:"Owner or Admin role required" });
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "Admin") return res.status(403).json({ success:false, message:"Admin access required" });
  next();
};

module.exports = { protect, requireProjectMember, requireProjectOwnerOrAdmin, requireAdmin, signAccess, signRefresh };
