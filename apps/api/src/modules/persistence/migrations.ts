import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const migrationsDirectory = path.resolve(process.cwd(), "db/migrations");

export async function runMigrations(pool: Pool, directory = migrationsDirectory): Promise<string[]> {
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const applied: string[] = [];

  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const existing = await pool.query("select 1 from schema_migrations where version = $1", [version]);

    if (existing.rowCount !== 0) {
      continue;
    }

    const sql = await fs.readFile(path.join(directory, file), "utf8");
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
      applied.push(version);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}
