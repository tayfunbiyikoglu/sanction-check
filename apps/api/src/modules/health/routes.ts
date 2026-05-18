import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(server: FastifyInstance) {
  server.get("/", async () => ({
    ok: true,
    service: "sanctions-delta-api"
  }));
}
