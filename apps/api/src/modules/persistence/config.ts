export type PersistenceMode = "postgres" | "memory";

export type RuntimePersistenceConfig =
  | {
      mode: "memory";
    }
  | {
      mode: "postgres";
      databaseUrl: string;
    };

export interface TestPersistenceConfig {
  databaseUrl: string;
}

export class PersistenceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConfigurationError";
  }
}

export function resolveRuntimePersistenceConfig(env: NodeJS.ProcessEnv = process.env): RuntimePersistenceConfig {
  const explicitMode = parsePersistenceMode(env.PERSISTENCE_MODE);

  if (explicitMode === "memory") {
    return { mode: "memory" };
  }

  if (env.NODE_ENV === "test" && explicitMode !== "postgres") {
    return { mode: "memory" };
  }

  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new PersistenceConfigurationError(
      "DATABASE_URL is required when PostgreSQL persistence is enabled. Run migrations and seed explicitly before starting the API."
    );
  }

  return {
    mode: "postgres",
    databaseUrl
  };
}

export function resolveTestPersistenceConfig(env: NodeJS.ProcessEnv = process.env): TestPersistenceConfig {
  if (!env.TEST_DATABASE_URL) {
    throw new PersistenceConfigurationError(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests. Refusing to use DATABASE_URL for tests."
    );
  }

  if (env.TEST_DATABASE_URL === env.DATABASE_URL) {
    throw new PersistenceConfigurationError(
      "TEST_DATABASE_URL must not equal DATABASE_URL. Use a dedicated PostgreSQL test database."
    );
  }

  return { databaseUrl: env.TEST_DATABASE_URL };
}

function parsePersistenceMode(value: string | undefined): PersistenceMode | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (value === "postgres" || value === "memory") {
    return value;
  }

  throw new PersistenceConfigurationError(`Unsupported PERSISTENCE_MODE: ${value}`);
}
