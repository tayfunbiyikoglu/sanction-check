import { describe, expect, it } from "vitest";
import {
  PersistenceConfigurationError,
  resolveRuntimePersistenceConfig,
  resolveTestPersistenceConfig
} from "./config.js";

describe("persistence configuration", () => {
  it("uses PostgreSQL by default outside tests", () => {
    expect(
      resolveRuntimePersistenceConfig({
        DATABASE_URL: "postgres://localhost/sanctions_delta"
      })
    ).toEqual({
      mode: "postgres",
      databaseUrl: "postgres://localhost/sanctions_delta"
    });
  });

  it("keeps memory persistence available for focused tests", () => {
    expect(resolveRuntimePersistenceConfig({ NODE_ENV: "test" })).toEqual({ mode: "memory" });
  });

  it("rejects memory persistence outside tests", () => {
    expect(() => resolveRuntimePersistenceConfig({ PERSISTENCE_MODE: "memory" })).toThrow(
      "PERSISTENCE_MODE=memory is only supported for tests"
    );
  });

  it("fails clearly when PostgreSQL is enabled without DATABASE_URL", () => {
    expect(() => resolveRuntimePersistenceConfig({ PERSISTENCE_MODE: "postgres" })).toThrow(
      PersistenceConfigurationError
    );
  });

  it("requires TEST_DATABASE_URL to be separate from DATABASE_URL", () => {
    expect(() =>
      resolveTestPersistenceConfig({
        DATABASE_URL: "postgres://localhost/sanctions_delta",
        TEST_DATABASE_URL: "postgres://localhost/sanctions_delta"
      })
    ).toThrow(PersistenceConfigurationError);
  });
});
