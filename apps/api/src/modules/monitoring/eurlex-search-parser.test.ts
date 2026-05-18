import { describe, expect, it } from "vitest";
import { parseEurLexSearchResponse } from "./eurlex-search-parser.js";

describe("EUR-Lex search response parser", () => {
  it("parses Discovery Triggers and rejects title-only results", () => {
    const parsed = parseEurLexSearchResponse(`
      <search-results>
        <result>
          <CELEX>32026R4001</CELEX>
          <CELLAR>cellar-4001</CELLAR>
          <URI>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R4001</URI>
          <TITLE>Search result with CELEX</TITLE>
          <DATE_PUBLICATION>2026-05-19</DATE_PUBLICATION>
        </result>
        <result>
          <CELLAR>cellar-4002</CELLAR>
          <TITLE>CELLAR-only result</TITLE>
        </result>
        <result>
          <TITLE>Title-only malformed result</TITLE>
        </result>
      </search-results>
    `);

    expect(parsed.triggers).toEqual([
      {
        celexId: "32026R4001",
        cellarId: "cellar-4001",
        officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R4001",
        title: "Search result with CELEX",
        publicationDate: "2026-05-19",
        sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R4001"
      },
      {
        cellarId: "cellar-4002",
        title: "CELLAR-only result"
      }
    ]);
    expect(parsed.errors).toEqual(["Search result 3 has no Legal Act Identity"]);
  });

  it("parses official EUR-Lex SOAP result metadata into Discovery Triggers", () => {
    const parsed = parseEurLexSearchResponse(`
      <S:Envelope xmlns:S="http://www.w3.org/2003/05/soap-envelope">
        <S:Body>
          <searchResults xmlns="http://eur-lex.europa.eu/search">
            <result>
              <reference>eng_cellar:93836665-712f-4444-a1e6-dadad5607e80_en</reference>
              <NOTICE>
                <WORK>
                  <ID_CELEX>
                    <VALUE>32026R4004</VALUE>
                  </ID_CELEX>
                </WORK>
                <EXPRESSION>
                  <EXPRESSION_TITLE>
                    <VALUE TYPE="EXPRESSION_TITLE">Council Implementing Regulation live search result</VALUE>
                  </EXPRESSION_TITLE>
                </EXPRESSION>
              </NOTICE>
            </result>
          </searchResults>
        </S:Body>
      </S:Envelope>
    `);

    expect(parsed).toEqual({
      errors: [],
      triggers: [
        {
          celexId: "32026R4004",
          cellarId: "93836665-712f-4444-a1e6-dadad5607e80",
          title: "Council Implementing Regulation live search result",
          sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R4004"
        }
      ]
    });
  });
});
