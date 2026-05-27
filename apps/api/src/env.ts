import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";

const repoEnvPath = path.resolve(import.meta.dirname, "../../..", ".env");

if (existsSync(repoEnvPath)) {
  loadEnvFile(repoEnvPath);
}
