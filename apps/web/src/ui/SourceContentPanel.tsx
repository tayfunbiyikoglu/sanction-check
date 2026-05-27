import type { CandidateLegalAct, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceContentResponse } from "../api/client.js";
import type { EvidenceJumpRequest, SourceView } from "./workbench-model.js";

export function SourceContentPanel({
  candidate,
  content,
  evidenceJumpRequest,
  extraction,
  hasCandidate,
  records,
  sourceContent,
  sourceView,
  sourceError
}: {
  candidate: CandidateLegalAct | null;
  content: string | undefined;
  evidenceJumpRequest: EvidenceJumpRequest | null;
  extraction: ExtractionResult | undefined;
  hasCandidate: boolean;
  records: SanctionsDeltaRecord[];
  sourceContent: SourceContentResponse | null;
  sourceView: SourceView;
  sourceError: string | null;
}) {
  const evidenceContainerRef = useRef<HTMLDivElement>(null);
  const evidenceLineRefs = useRef(new Map<string, HTMLDivElement>());
  const processedEvidenceJumpRequest = useRef<number | null>(null);
  const [highlightedEvidenceRecordId, setHighlightedEvidenceRecordId] = useState<string | null>(null);
  const [evidenceJumpMessage, setEvidenceJumpMessage] = useState<string | null>(null);
  const evidenceMatchers = useMemo(() => buildEvidenceMatchers(records), [records]);
  const sourceRows = useMemo(() => {
    if (!content) {
      return [];
    }

    return selectVisibleSourceLines(formatSourceLines(content), evidenceMatchers).map((item) => {
      if (item.kind === "omission") {
        return (
          <div className="sourceOmission" key={item.key}>
            {item.omittedCount.toLocaleString()} source lines hidden for faster navigation
          </div>
        );
      }

      return (
        <div
          className={`sourceLine ${item.evidenceMatches.length > 0 ? "highlighted" : ""} ${
            item.evidenceMatches.some((record) => record.recordId === highlightedEvidenceRecordId) ? "jumpHighlighted" : ""
          }`}
          key={`${item.index}-${item.line}`}
          ref={(element) => {
            for (const match of item.evidenceMatches) {
              if (element) {
                evidenceLineRefs.current.set(match.recordId, element);
              } else {
                evidenceLineRefs.current.delete(match.recordId);
              }
            }
          }}
        >
          <span>{item.index + 1}</span>
          <p>{item.line}</p>
          {item.evidenceMatches.length > 0 ? (
            <small>Evidence Text for {item.evidenceMatches.map((record) => record.primaryName).join(", ")}</small>
          ) : null}
        </div>
      );
    });
  }, [content, evidenceMatchers, highlightedEvidenceRecordId]);

  useEffect(() => {
    if (
      !evidenceJumpRequest ||
      sourceView !== "official" ||
      processedEvidenceJumpRequest.current === evidenceJumpRequest.requestedAt
    ) {
      return;
    }

    const element = evidenceLineRefs.current.get(evidenceJumpRequest.recordId);

    if (!element) {
      if (sourceRows.length > 0) {
        setEvidenceJumpMessage("Evidence text was not found in the current official source view.");
      }
      return;
    }

    processedEvidenceJumpRequest.current = evidenceJumpRequest.requestedAt;
    setEvidenceJumpMessage(null);
    const container = evidenceContainerRef.current;

    if (container) {
      const containerBounds = container.getBoundingClientRect();
      const elementBounds = element.getBoundingClientRect();
      const centeredTop =
        container.scrollTop + elementBounds.top - containerBounds.top - container.clientHeight / 2 + element.clientHeight / 2;

      container.scrollTo({ behavior: "smooth", top: Math.max(0, centeredTop) });
    } else {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    setHighlightedEvidenceRecordId(evidenceJumpRequest.recordId);

    const timeout = window.setTimeout(() => setHighlightedEvidenceRecordId(null), 2200);

    return () => window.clearTimeout(timeout);
  }, [evidenceJumpRequest, sourceRows.length, sourceView]);

  if (sourceView === "metadata") {
    return (
      <SourceMetadataView
        candidate={candidate}
        extraction={extraction}
        sourceContent={sourceContent}
        sourceError={sourceError}
      />
    );
  }

  if (!content) {
    return (
      <div className="sourceEmpty">
        <h3>{sourceError ? "Source Content unavailable" : hasCandidate ? "Loading Source Content" : "No Candidate Legal Act selected"}</h3>
        <p>{sourceError ?? (hasCandidate ? "Official English Source Content is being requested." : "Run RSS monitoring or select a Candidate Legal Act.")}</p>
      </div>
    );
  }

  return (
    <div className="evidence" aria-label="Evidence Text in Source Content" ref={evidenceContainerRef}>
      {evidenceJumpMessage ? <div className="sourceJumpMessage">{evidenceJumpMessage}</div> : null}
      {sourceRows}
    </div>
  );
}

function SourceMetadataView({
  candidate,
  extraction,
  sourceContent,
  sourceError
}: {
  candidate: CandidateLegalAct | null;
  extraction: ExtractionResult | undefined;
  sourceContent: SourceContentResponse | null;
  sourceError: string | null;
}) {
  return (
    <div className="metadataPanel">
      <dl className="metadataGrid">
        <div>
          <dt>Source reference</dt>
          <dd>{sourceContent?.sourceContent.reference ?? sourceError ?? "Not retrieved"}</dd>
        </div>
        <div>
          <dt>Source URI</dt>
          <dd>{sourceContent?.sourceContent.sourceUri ?? candidate?.sourceUrl ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Content type</dt>
          <dd>{sourceContent?.sourceContent.contentType ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Content length</dt>
          <dd>{sourceContent ? `${sourceContent.sourceContent.contentLength.toLocaleString()} bytes` : "Unknown"}</dd>
        </div>
        <div>
          <dt>Content hash</dt>
          <dd className="hashCell">{sourceContent?.sourceContent.contentHash ?? "Not available"}</dd>
        </div>
        <div>
          <dt>Retrieved at</dt>
          <dd>{sourceContent ? formatDateTime(sourceContent.sourceContent.retrievedAt) : "Not retrieved"}</dd>
        </div>
        <div>
          <dt>Parser version</dt>
          <dd>{extraction?.parserVersion ?? "No parser run"}</dd>
        </div>
        <div>
          <dt>Extraction result</dt>
          <dd>{extraction ? `${formatClassification(extraction.classification)} · ${Math.round(extraction.confidence * 100)}%` : "Pending"}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatSourceLines(content: string) {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/></g, ">\n<")
    .split(/\r?\n/)
    .map((line) => line.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#xa0;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

interface EvidenceMatcher {
  recordId: string;
  primaryName: string;
  normalizedPrimaryName: string;
  normalizedEvidence: string;
  evidenceParts: string[];
}

type VisibleSourceLine =
  | {
      kind: "line";
      index: number;
      line: string;
      evidenceMatches: EvidenceMatcher[];
    }
  | {
      kind: "omission";
      key: string;
      omittedCount: number;
    };

const maxRenderedSourceLines = 360;
const leadingSourceLines = 180;
const trailingSourceLines = 24;
const evidenceContextLines = 3;

function selectVisibleSourceLines(lines: string[], matchers: EvidenceMatcher[]): VisibleSourceLine[] {
  if (lines.length <= maxRenderedSourceLines) {
    return lines.map((line, index) => ({
      kind: "line",
      index,
      line,
      evidenceMatches: findEvidenceMatches(line, matchers)
    }));
  }

  const included = new Set<number>();

  for (let index = 0; index < Math.min(leadingSourceLines, lines.length); index += 1) {
    included.add(index);
  }

  for (let index = Math.max(0, lines.length - trailingSourceLines); index < lines.length; index += 1) {
    included.add(index);
  }

  const evidenceMatchesByLine = new Map<number, EvidenceMatcher[]>();

  lines.forEach((line, index) => {
    const matches = findEvidenceMatches(line, matchers);

    if (matches.length === 0) {
      return;
    }

    evidenceMatchesByLine.set(index, matches);

    for (
      let contextIndex = Math.max(0, index - evidenceContextLines);
      contextIndex <= Math.min(lines.length - 1, index + evidenceContextLines);
      contextIndex += 1
    ) {
      included.add(contextIndex);
    }
  });

  const sortedIndexes = [...included].sort((left, right) => left - right);
  const visible: VisibleSourceLine[] = [];
  let previousIndex = -1;

  for (const index of sortedIndexes) {
    if (index > previousIndex + 1) {
      visible.push({
        kind: "omission",
        key: `omitted-${previousIndex + 1}-${index - 1}`,
        omittedCount: index - previousIndex - 1
      });
    }

    visible.push({
      kind: "line",
      index,
      line: lines[index]!,
      evidenceMatches: evidenceMatchesByLine.get(index) ?? findEvidenceMatches(lines[index]!, matchers)
    });
    previousIndex = index;
  }

  return visible;
}

function buildEvidenceMatchers(records: SanctionsDeltaRecord[]): EvidenceMatcher[] {
  return records
    .map((record) => {
      const normalizedEvidence = normalizeEvidence(record.evidenceText);
      return {
        recordId: record.id,
        primaryName: record.primaryName,
        normalizedPrimaryName: normalizeEvidence(record.primaryName),
        normalizedEvidence,
        evidenceParts: record.evidenceText
          .split(/[.;\n]/)
          .map((part) => normalizeEvidence(part))
          .filter((part) => part.length > 8)
      };
    })
    .filter((matcher) => matcher.normalizedEvidence.length > 0 || matcher.normalizedPrimaryName.length > 0);
}

function findEvidenceMatches(line: string, matchers: EvidenceMatcher[]) {
  const normalizedLine = normalizeEvidence(line);

  return matchers.filter(
    (matcher) =>
      (matcher.normalizedEvidence.length > 0 && normalizedLine.includes(matcher.normalizedEvidence)) ||
      (matcher.normalizedPrimaryName.length > 0 && normalizedLine.includes(matcher.normalizedPrimaryName)) ||
      matcher.evidenceParts.some((part) => normalizedLine.includes(part))
  );
}

function normalizeEvidence(value: string) {
  return value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatClassification(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
