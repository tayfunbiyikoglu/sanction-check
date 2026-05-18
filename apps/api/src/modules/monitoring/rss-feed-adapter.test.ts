import { describe, expect, it } from "vitest";
import { parseRssFeed } from "./rss-feed-adapter.js";

describe("RSS feed adapter", () => {
  it("parses EUR-Lex RSS items into Discovery Triggers", () => {
    const parsed = parseRssFeed(
      `
      <rss version="2.0">
        <channel>
          <item>
            <title>Council Implementing Regulation sample</title>
            <link>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7001</link>
            <guid>CELEX:32026R7001</guid>
            <pubDate>Sun, 17 May 2026 10:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Malformed item without identity</title>
            <link>https://example.test/item</link>
          </item>
        </channel>
      </rss>
      `,
      "Regulation 269/2014 RSS overlap monitor"
    );

    expect(parsed).toEqual({
      triggers: [
        {
          celexId: "32026R7001",
          officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7001",
          title: "Council Implementing Regulation sample",
          publicationDate: "2026-05-17",
          sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7001",
          rssFeedName: "Regulation 269/2014 RSS overlap monitor"
        }
      ],
      errors: ["RSS item 2 has no Legal Act Identity"]
    });
  });

  it("parses Atom entries and CELLAR identifiers", () => {
    const parsed = parseRssFeed(
      `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Publications Office CELLAR item</title>
          <link href="https://publications.europa.eu/resource/cellar/4295095e-ae10-11e3-86f9-01aa75ed71a1" />
          <updated>2026-05-18T08:15:00Z</updated>
        </entry>
      </feed>
      `,
      "CELLAR feed"
    );

    expect(parsed.triggers).toEqual([
      {
        cellarId: "4295095e-ae10-11e3-86f9-01aa75ed71a1",
        officialUri: "https://publications.europa.eu/resource/cellar/4295095e-ae10-11e3-86f9-01aa75ed71a1",
        title: "Publications Office CELLAR item",
        publicationDate: "2026-05-18",
        sourceUrl: "https://publications.europa.eu/resource/cellar/4295095e-ae10-11e3-86f9-01aa75ed71a1",
        rssFeedName: "CELLAR feed"
      }
    ]);
  });
});
