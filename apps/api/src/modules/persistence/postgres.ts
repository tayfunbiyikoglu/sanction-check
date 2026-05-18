import { Pool, type PoolClient, type PoolConfig } from "pg";

export type DatabaseExecutor = Pick<Pool | PoolClient, "query">;

export function createPostgresPool(connectionString: string, options: Omit<PoolConfig, "connectionString"> = {}) {
  return new Pool({
    connectionString,
    max: 5,
    ...options
  });
}

export async function assertPostgresReachable(pool: Pool): Promise<void> {
  try {
    await pool.query("select 1");
  } catch (cause) {
    throw new Error(
      `PostgreSQL is unreachable. Check DATABASE_URL and database availability. ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
}
