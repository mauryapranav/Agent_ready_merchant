import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

const __dirname = join(fileURLToPath(import.meta.url), "..");

const connectionString = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/settle";
const isNeon = connectionString.includes("neon.tech");

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  ...(isNeon && { ssl: { rejectUnauthorized: false } }),
});

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = join(__dirname, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await query<{ name: string }>("SELECT name FROM migrations WHERE name = $1", [file]);
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await query(sql);
    await query("INSERT INTO migrations (name) VALUES ($1)", [file]);
    console.log(`Applied migration: ${file}`);
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}