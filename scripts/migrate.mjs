import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;

const migrationsDir = join(process.cwd(), "drizzle");
const databaseUrl = getMigrationDatabaseUrl();

if (!databaseUrl) {
  throw new Error("DATABASE_URL or DIRECT_DATABASE_URL is required to run migrations.");
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await ensureMigrationsTable();

  const appliedCount = await getAppliedMigrationCount();
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  const pending = migrationFiles.slice(appliedCount);

  if (pending.length === 0) {
    console.log("No pending migrations.");
    process.exit(0);
  }

  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    console.log(`Applying ${file}...`);
    await client.query("begin");
    try {
      for (const statement of statements) {
        await client.query(statement);
      }

      await client.query(
        "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
        [createHash("sha256").update(sql).digest("hex"), Date.now().toString()],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  console.log(`Applied ${pending.length} migration${pending.length === 1 ? "" : "s"}.`);
} finally {
  await client.end();
}

async function ensureMigrationsTable() {
  await client.query("create schema if not exists drizzle");
  await client.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at text
    )
  `);
}

async function getAppliedMigrationCount() {
  const result = await client.query("select count(*)::int as count from drizzle.__drizzle_migrations");
  return result.rows[0]?.count ?? 0;
}

function getMigrationDatabaseUrl() {
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (directUrl) return directUrl;

  const pooledUrl = process.env.DATABASE_URL ?? "";
  if (!pooledUrl) return "";

  const url = new URL(pooledUrl);
  url.hostname = url.hostname.replace("-pooler.", ".");
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
