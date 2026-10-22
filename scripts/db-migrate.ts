import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationDirectory = fileURLToPath(
  new URL("../database/migrations/", import.meta.url),
);
const migrationLock = 2_481_507;

async function migrate() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run db:migrate\nApplies checksummed SQL migrations using DATABASE_URL.\nReads .env.local, then .env, without overriding existing environment variables.",
    );
    return;
  }
  if (args.length > 0) {
    throw new Error(`Unknown argument: ${args[0]}. Use --help for usage.`);
  }

  for (const filename of [".env.local", ".env"]) {
    if (existsSync(filename)) {
      process.loadEnvFile(filename);
    }
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required for migrations. The dashboard itself can run without a database.",
    );
  }

  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
    .sort();
  if (filenames.length === 0) {
    throw new Error("No SQL migrations were found.");
  }

  const migrations = await Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(`${migrationDirectory}/${filename}`, "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  const client = new pg.Client({
    connectionString,
    application_name: "atlas-signal-migrate",
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();
  let locked = false;
  try {
    // Serialize migrators, including first-run creation of the ledger.
    await client.query("SELECT pg_advisory_lock($1)", [migrationLock]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS atlas_schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const previous = await client.query<{ checksum: string }>(
        "SELECT checksum FROM atlas_schema_migrations WHERE filename = $1",
        [migration.filename],
      );
      if (previous.rows.length > 0) {
        if (previous.rows[0].checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.filename} has changed since it was applied. Restore the original and create a new migration.`,
          );
        }
        console.log(`[database] Already applied: ${migration.filename}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO atlas_schema_migrations (filename, checksum) VALUES ($1, $2)",
          [migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
        console.log(`[database] Applied: ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log("[database] Schema is up to date.");
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [migrationLock])
        .catch(() => undefined);
    }
    await client.end();
  }
}

void migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  const sanitized = process.env.DATABASE_URL
    ? message.replaceAll(process.env.DATABASE_URL, "[redacted database URL]")
    : message;
  console.error(`[database] ${sanitized}`);
  process.exitCode = 1;
});
