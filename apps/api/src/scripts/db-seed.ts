import { PostgresConfigurationRepository } from "../modules/configuration/repository.js";
import { configuredBaseActs, watchQueries } from "../modules/seed-data.js";
import { resolveRuntimePersistenceConfig } from "../modules/persistence/config.js";
import { createPostgresPool } from "../modules/persistence/postgres.js";

const config = resolveRuntimePersistenceConfig({ ...process.env, PERSISTENCE_MODE: "postgres" });
if (config.mode !== "postgres") {
  throw new Error("db:seed requires PostgreSQL persistence");
}
const pool = createPostgresPool(config.databaseUrl!);
const repository = new PostgresConfigurationRepository(pool);

try {
  await repository.seedBaseline({ configuredBaseActs, watchQueries });
  console.log(
    `Seeded baseline configuration: ${configuredBaseActs.length} Configured Base Act(s), ${watchQueries.length} Watch Query(ies).`
  );
} finally {
  await pool.end();
}
