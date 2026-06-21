const ok = (res, data, message = "Success") =>
  res.status(200).json({ success: true, message, data });

const created = (res, data, message = "Created") =>
  res.status(201).json({ success: true, message, data });

const paginated = (res, { data, total, page, limit }) =>
  res.status(200).json({
    success: true, data,
    pagination: {
      total: Number(total),
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(Number(total) / Number(limit)),
    },
  });

const noContent = (res) => res.status(204).send();

const fail = (res, message = "Error", statusCode = 400) =>
  res.status(statusCode).json({ success: false, message });

module.exports = { ok, created, paginated, noContent, fail };
