/**
 * CollabFlow database backup — full logical dump via mysqldump.
 *
 * Usage:   npm run db:backup
 * Output:  backups/collabflow_YYYY-MM-DD_HH-mm-ss.sql
 *
 * Requires admin credentials (BACKUP_DB_USER / BACKUP_DB_PASSWORD in .env,
 * falling back to DB_USER / DB_PASSWORD). Schedule nightly with Windows
 * Task Scheduler or cron:  0 2 * * *  npm run db:backup
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MYSQLDUMP =
  process.env.MYSQLDUMP_PATH ||
  "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe";

const dbName = process.env.DB_NAME || "collabflow";
const user = process.env.BACKUP_DB_USER || process.env.DB_USER;
const password = process.env.BACKUP_DB_PASSWORD || process.env.DB_PASSWORD;

const outDir = path.join(__dirname, "..", "backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").slice(0, 19);
const outFile = path.join(outDir, `${dbName}_${stamp}.sql`);

const args = [
  `--user=${user}`,
  `--host=${process.env.DB_HOST || "localhost"}`,
  `--port=${process.env.DB_PORT || 3306}`,
  "--single-transaction", // consistent InnoDB snapshot, no table locks
  "--routines",
  "--triggers",
  `--result-file=${outFile}`,
  dbName,
];

const res = spawnSync(MYSQLDUMP, args, {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ["ignore", "inherit", "inherit"],
});

if (res.status !== 0) {
  console.error(`Backup FAILED (exit ${res.status})`);
  process.exit(1);
}
const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`Backup OK -> ${outFile} (${sizeKb} KB)`);

// retention: keep the 14 most recent backups
const old = fs
  .readdirSync(outDir)
  .filter((f) => f.startsWith(dbName + "_") && f.endsWith(".sql"))
  .sort()
  .reverse()
  .slice(14);
for (const f of old) {
  fs.unlinkSync(path.join(outDir, f));
  console.log(`Pruned old backup: ${f}`);
}
