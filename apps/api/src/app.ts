import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAuditRoutes } from "./modules/audit/routes.js";
import { registerCandidateRoutes } from "./modules/candidates/routes.js";
import { registerClassificationRoutes } from "./modules/classification/routes.js";
import { registerConfigurationRoutes } from "./modules/configuration/routes.js";
import { registerCorrectionRoutes } from "./modules/correction/routes.js";
import { registerExportRoutes } from "./modules/export/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerMonitoringRoutes } from "./modules/monitoring/routes.js";
import { buildAppPersistence, decoratePersistence, type AppPersistence } from "./modules/persistence/runtime.js";
import { registerRetrievalRoutes } from "./modules/retrieval/routes.js";

export interface BuildServerOptions {
  persistence?: AppPersistence;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: true,
    routerOptions: {
      maxParamLength: 512
    }
  });
  const persistence = options.persistence ?? buildAppPersistence();

  decoratePersistence(server, persistence);

  void server.register(cors, {
    origin: true
  });

  void server.register(registerAuditRoutes, { prefix: "/audit" });
  void server.register(registerHealthRoutes, { prefix: "/health" });
  void server.register(registerCandidateRoutes, { prefix: "/candidates" });
  void server.register(registerClassificationRoutes, { prefix: "/classification" });
  void server.register(registerConfigurationRoutes, { prefix: "/configuration" });
  void server.register(registerCorrectionRoutes, { prefix: "/correction" });
  void server.register(registerExportRoutes, { prefix: "/export" });
  void server.register(registerMonitoringRoutes, { prefix: "/monitoring" });
  void server.register(registerRetrievalRoutes, { prefix: "/retrieval" });

  return server;
}
