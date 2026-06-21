const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const errorHandler = (err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Internal server error";
  if (status >= 500) console.error("[ERROR]", err);
  res.status(status).json({ success: false, message, ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}) });
};

module.exports = { asyncHandler, errorHandler };
