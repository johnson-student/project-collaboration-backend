/**
 * CollabFlow database restore — replay a mysqldump file.
 *
 * Usage:   npm run db:restore -- backups/collabflow_2026-07-12_02-00-00.sql
 *          npm run db:restore -- <file> --into collabflow_restore_test   (restore drill)
 *
 * Restoring into a scratch database first is the recommended way to verify
 * a backup without touching production data.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MYSQL =
  process.env.MYSQL_PATH ||
  "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";

const argv = process.argv.slice(2);
const file = argv[0];
const intoIdx = argv.indexOf("--into");
const targetDb = intoIdx !== -1 ? argv[intoIdx + 1] : process.env.DB_NAME || "collabflow";

if (!file || !fs.existsSync(file)) {
  console.error("Usage: npm run db:restore -- <backup.sql> [--into <database>]");
  process.exit(1);
}

const user = process.env.BACKUP_DB_USER || process.env.DB_USER;
const password = process.env.BACKUP_DB_PASSWORD || process.env.DB_PASSWORD;
const env = { ...process.env, MYSQL_PWD: password };
const base = [`--user=${user}`, `--host=${process.env.DB_HOST || "localhost"}`, `--port=${process.env.DB_PORT || 3306}`];

// ensure target database exists
let res = spawnSync(MYSQL, [...base, "-e", `CREATE DATABASE IF NOT EXISTS \`${targetDb}\``], { env, stdio: "inherit" });
if (res.status !== 0) process.exit(1);

// replay the dump
res = spawnSync(MYSQL, [...base, targetDb, "-e", `source ${file.replace(/\\/g, "/")}`], { env, stdio: "inherit" });
if (res.status !== 0) {
  console.error("Restore FAILED");
  process.exit(1);
}
console.log(`Restore OK -> database \`${targetDb}\` from ${file}`);
