import "./env.js";
import { buildServer } from "./app.js";
import { startHourlyRssAutomation } from "./modules/background/rss-automation.js";

const server = buildServer();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

if (process.env.RSS_AUTOMATION_ENABLED !== "false") {
  const publicationYear = parsePublicationYear(process.env.EURLEX_RSS_PUBLICATION_YEAR);

  startHourlyRssAutomation(server, {
    ...(publicationYear ? { publicationYear } : {})
  });
}

await server.listen({ port, host });

function parsePublicationYear(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : undefined;
}
