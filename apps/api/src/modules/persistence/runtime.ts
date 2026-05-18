import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { configuredBaseActs, watchQueries } from "../seed-data.js";
import {
  InMemoryConfigurationRepository,
  PostgresConfigurationRepository,
  type ConfigurationRepository
} from "../configuration/repository.js";
import { PostgresExportRepository, type ExportRepository } from "../export/repository.js";
import { PostgresMonitoringRepository, type MonitoringRepository } from "../monitoring/repository.js";
import { resolveRuntimePersistenceConfig, type RuntimePersistenceConfig } from "./config.js";
import { assertPostgresReachable, createPostgresPool } from "./postgres.js";

export interface AppPersistence {
  mode: RuntimePersistenceConfig["mode"];
  configuration: ConfigurationRepository;
  monitoring?: MonitoringRepository;
  exports?: ExportRepository;
  pool?: Pool;
}

export function buildAppPersistence(config = resolveRuntimePersistenceConfig()): AppPersistence {
  if (config.mode === "memory") {
    return {
      mode: "memory",
      configuration: new InMemoryConfigurationRepository(configuredBaseActs, watchQueries)
    };
  }

  const pool = createPostgresPool(config.databaseUrl);

  return {
    mode: "postgres",
    pool,
    configuration: new PostgresConfigurationRepository(pool),
    monitoring: new PostgresMonitoringRepository(pool),
    exports: new PostgresExportRepository(pool)
  };
}

export function decoratePersistence(server: FastifyInstance, persistence: AppPersistence): void {
  server.decorate("persistence", persistence);

  server.addHook("onReady", async () => {
    if (persistence.pool) {
      await assertPostgresReachable(persistence.pool);
    }

    await persistence.configuration.assertBaselinePresent();
  });

  server.addHook("onClose", async () => {
    await persistence.pool?.end();
  });
}

declare module "fastify" {
  interface FastifyInstance {
    persistence: AppPersistence;
  }
}
