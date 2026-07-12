const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME || "collabflow",
  process.env.DB_USER || "root",
  process.env.DB_PASSWORD || "",
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    dialect: "mysql",
    timezone: "+00:00",
    logging: false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    define: {
      underscored: true,
      freezeTableName: true,
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    },
  },
);

// Test connection on startup
sequelize
  .authenticate()
  .then(() => console.log("✅  MySQL connected (Sequelize)"))
  .catch((err) => {
    console.error("❌  MySQL connection failed:", err.message);
    process.exit(1);
  });

module.exports = sequelize;
