// Data access for the users table.
const { Op } = require("sequelize");
const { User } = require("../models");

const findById = (id, { attributes, transaction } = {}) =>
  User.findByPk(id, { attributes, transaction });

const findByEmail = (email) => User.findOne({ where: { email } });

const findByGoogleId = (googleId) => User.findOne({ where: { google_id: googleId } });

const findByValidResetToken = (token) =>
  User.findOne({
    where: { reset_token: token, reset_token_expires: { [Op.gt]: new Date() } },
  });

const findByValidVerifyToken = (token) =>
  User.findOne({
    where: { verify_token: token, verify_token_expires: { [Op.gt]: new Date() } },
  });

const create = (data) => User.create(data);

const updateById = (id, updates) => User.update(updates, { where: { id } });

const deleteById = (id) => User.destroy({ where: { id } });

// Paginated directory listing, restricted to the given user ids.
const listUsers = async ({ ids, q, status, attributes, limit, offset }) => {
  const where = { id: { [Op.in]: ids } };
  if (q) {
    const like = `%${q}%`;
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { email: { [Op.like]: like } },
      { role: { [Op.like]: like } },
    ];
  }
  if (status) where.status = status;

  const total = await User.count({ where });
  const rows = await User.findAll({
    attributes,
    where,
    order: [["name", "ASC"]],
    limit,
    offset,
    raw: true,
  });
  return { rows, total };
};

// Name/email autocomplete; optionally restricted to (or excluding) a set of ids.
const searchByNameOrEmail = ({ q, includeIds, excludeIds, attributes, limit = 20 }) => {
  const like = `%${q}%`;
  const where = {
    [Op.or]: [{ name: { [Op.like]: like } }, { email: { [Op.like]: like } }],
  };
  if (includeIds) where.id = { [Op.in]: includeIds };
  if (excludeIds) where.id = { [Op.notIn]: excludeIds };
  return User.findAll({ attributes, where, order: [["name", "ASC"]], limit, raw: true });
};

module.exports = {
  findById,
  findByEmail,
  findByGoogleId,
  findByValidResetToken,
  findByValidVerifyToken,
  create,
  updateById,
  deleteById,
  listUsers,
  searchByNameOrEmail,
};
