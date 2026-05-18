import { resolveRuntimePersistenceConfig } from "../modules/persistence/config.js";
import { runMigrations } from "../modules/persistence/migrations.js";
import { createPostgresPool } from "../modules/persistence/postgres.js";

const config = resolveRuntimePersistenceConfig({ ...process.env, PERSISTENCE_MODE: "postgres" });
if (config.mode !== "postgres") {
  throw new Error("db:migrate requires PostgreSQL persistence");
}
const pool = createPostgresPool(config.databaseUrl!);

try {
  const applied = await runMigrations(pool);
  console.log(applied.length === 0 ? "No migrations to apply." : `Applied migrations: ${applied.join(", ")}`);
} finally {
  await pool.end();
}
