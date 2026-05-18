import { buildServer } from "./app.js";

const server = buildServer();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

await server.listen({ port, host });
