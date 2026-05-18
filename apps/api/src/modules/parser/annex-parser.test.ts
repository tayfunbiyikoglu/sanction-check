import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractAnnexSanctionsDeltaRecords } from "./annex-parser.js";

const fixturePath = path.resolve(import.meta.dirname, "fixtures/annex-delta-records.xml");

describe("extractAnnexSanctionsDeltaRecords", () => {
  it("extracts source-ordered Annex sanctions delta records from XML fixture content", async () => {
    const content = await readFile(fixturePath, "utf8");

    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-delta-001",
      content,
      contentType: "application/xml"
    });

    expect(result).toMatchObject({
      parserVersion: "deterministic-annex-parser-v1",
      isComplete: true,
      validationIssues: []
    });
    expect(result.records).toHaveLength(6);
    expect(result.records.map((record) => [record.sourceOrder, record.affectedAnnex, record.actionType, record.recordType])).toEqual([
      [1, "Annex I", "ADD", "PERSON"],
      [2, "Annex I", "ADD", "ENTITY"],
      [3, "Annex I", "AMEND", "PERSON"],
      [4, "Annex I", "REMOVE", "PERSON"],
      [5, "Annex I", "REPLACE", "ENTITY"],
      [6, "Annex II", "ADD", "PERSON"]
    ]);
    expect(result.records[0]).toMatchObject({
      primaryName: "Jane Example",
      sourceLocation: "Annex I; section 1; row 1",
      evidenceText: "Jane Example; date of birth: 1 January 1980; listed for supporting prohibited activities.",
      listedEntry: {
        name: "Jane Example",
        dateofbirth: "1 January 1980"
      }
    });
  });

  it("represents replacement entries as full snapshots", async () => {
    const content = await readFile(fixturePath, "utf8");
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-delta-001",
      content,
      contentType: "application/xml"
    });

    expect(result.records.find((record) => record.actionType === "REPLACE")).toMatchObject({
      primaryName: "Full Snapshot Bank",
      listedEntry: {
        name: "Full Snapshot Bank",
        registrationnumber: "BANK-777",
        address: "1 Replacement Avenue",
        grounds: "Full replacement snapshot grounds."
      }
    });
  });

  it("allows sparse removal entries", async () => {
    const content = await readFile(fixturePath, "utf8");
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-delta-001",
      content,
      contentType: "application/xml"
    });

    expect(result.records.find((record) => record.actionType === "REMOVE")).toMatchObject({
      primaryName: "Sam Sparse",
      listedEntry: {
        name: "Sam Sparse"
      }
    });
  });

  it("preserves amendments in the shape published by the legal act", async () => {
    const content = await readFile(fixturePath, "utf8");
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-delta-001",
      content,
      contentType: "application/xml"
    });

    expect(result.records.find((record) => record.actionType === "AMEND")).toMatchObject({
      primaryName: "Alex Changed",
      listedEntry: {
        name: "Alex Changed",
        amendmenttext: "Address replaced with 10 Sample Street."
      }
    });
  });

  it("preserves duplicate-looking names when source locations differ", async () => {
    const content = await readFile(fixturePath, "utf8");
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-delta-001",
      content,
      contentType: "application/xml"
    });

    const janeRecords = result.records.filter((record) => record.primaryName === "Jane Example");
    expect(janeRecords).toHaveLength(2);
    expect(janeRecords.map((record) => record.sourceLocation)).toEqual([
      "Annex I; section 1; row 1",
      "Annex II; section 1; row 1"
    ]);
  });

  it("blocks completion when countable Annex rows do not match expected counts", () => {
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-mismatch-001",
      content: `<legalAct><annex id="I" expected-record-count="2"><section action="ADD" record-type="PERSON"><row id="1"><cell name="name">One Person</cell></row></section></annex></legalAct>`,
      contentType: "application/xml"
    });

    expect(result.isComplete).toBe(false);
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({
        code: "COUNT_MISMATCH",
        sourceLocation: "Annex I"
      })
    );
  });

  it("ignores duplicate source rows and blocks completion", () => {
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-duplicate-source-row-001",
      content: `<legalAct><annex id="I" expected-record-count="1"><section action="ADD" record-type="PERSON"><row id="1"><cell name="name">Duplicate Row</cell></row><row id="1"><cell name="name">Duplicate Row</cell></row></section></annex></legalAct>`,
      contentType: "application/xml"
    });

    expect(result.records).toHaveLength(1);
    expect(result.isComplete).toBe(false);
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_SOURCE_LOCATION",
        sourceLocation: "Annex I; section 1; row 1"
      })
    );
  });

  it("extracts EUR-Lex HTML Annex tables with persons and entities", () => {
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-html-001",
      content: `
        <html><body>
          <p class="oj-doc-ti">ANNEX</p>
          <p>The following persons and entities are added to the list of natural and legal persons, entities and bodies set out in Annex I to Regulation (EU) No 269/2014:</p>
          <p class="oj-ti-grseq-1"><span class="oj-sp-normal">Persons</span></p>
          <table>
            <tr><td></td><td>Name</td><td>Identifying information</td><td>Reasons</td><td>Date of listing</td></tr>
            <tr>
              <td><p>‘2032.</p></td>
              <td><p>Lilya Valerievna SHVETSOVA</p><p>Russian: sample</p></td>
              <td><p>D.O.B: 11.7.1984</p></td>
              <td><p>Listed reason.</p></td>
              <td><p>11.5.2026</p></td>
            </tr>
          </table>
          <p class="oj-ti-grseq-1"><span class="oj-sp-normal">Entities</span></p>
          <table>
            <tr><td></td><td>Name</td><td>Identifying information</td><td>Reasons</td><td>Date of listing</td></tr>
            <tr>
              <td><p>688.</p></td>
              <td><p>All Russian Children’s Centre “Smena”</p><p>a.k.a Change</p></td>
              <td><p>Type of entity: Federal State Budget Educational Institution</p></td>
              <td><p>Entity reason.</p></td>
              <td><p>11.5.2026</p></td>
            </tr>
          </table>
        </body></html>
      `,
      contentType: "text/html"
    });

    expect(result).toMatchObject({
      isComplete: true,
      validationIssues: []
    });
    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => [record.sourceOrder, record.recordType, record.actionType, record.primaryName])).toEqual([
      [1, "PERSON", "ADD", "Lilya Valerievna SHVETSOVA"],
      [2, "ENTITY", "ADD", "All Russian Children’s Centre “Smena”"]
    ]);
    expect(result.records[0]).toMatchObject({
      affectedAnnex: "Annex I",
      sourceLocation: "Annex I; Persons; row 2032",
      listedEntry: {
        name: "Lilya Valerievna SHVETSOVA\nRussian: sample",
        identifyinginformation: "D.O.B: 11.7.1984"
      }
    });
  });

  it("blocks unsupported non-XML and non-HTML structures", () => {
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-text-001",
      content: "Annex I Jane Example",
      contentType: "text/plain"
    });

    expect(result).toMatchObject({
      isComplete: false,
      records: [],
      validationIssues: [{ code: "UNSUPPORTED_STRUCTURE" }]
    });
  });

  it("blocks sections missing supported action or record type", () => {
    const result = extractAnnexSanctionsDeltaRecords({
      candidateId: "candidate-unsupported-section-001",
      content: `<legalAct><annex id="I"><section action="UPSERT" record-type="VESSEL"><row id="1"><cell name="name">Unsupported</cell></row></section></annex></legalAct>`,
      contentType: "application/xml"
    });

    expect(result.records).toHaveLength(0);
    expect(result.isComplete).toBe(false);
    expect(result.validationIssues.map((issue) => issue.code)).toEqual(["MISSING_ACTION_TYPE", "MISSING_RECORD_TYPE"]);
  });
});
