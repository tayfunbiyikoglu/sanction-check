import type {
  CandidateLegalAct,
  CandidateStatus,
  CompleteExtractionGateResult,
  ExportBatch,
  ExportDownloadEvent,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorOverview,
  SanctionsDeltaRecord,
  WatchQuery
} from "@sanctions/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  aiExtractSourceContent,
  createExportBatch,
  createRssWatchQuery,
  classifySourceContent,
  fetchCandidateDetail,
  fetchCandidateLegalActs,
  fetchConfiguration,
  fetchExportBatches,
  fetchAuditEvents,
  fetchMonitorOverview,
  fetchSourceContent,
  retrieveSourceContent,
  runRssMonitor
} from "../api/client.js";
import type { CandidateDetailResponse, SourceContentResponse } from "../api/client.js";
import type { AuditEvent } from "../api/client.js";

type QueueFilter = "ALL" | CandidateStatus;
type SourceView = "official" | "metadata";
type LiveActionKind = "rss" | "retrieve" | "classify" | "ai-extract" | null;
type Theme = "light" | "dark";
interface EvidenceJumpRequest {
  recordId: string;
  requestedAt: number;
}
const RSS_PUBLICATION_YEAR = 2026;

const statusOrder: CandidateStatus[] = [
  "NEEDS_EXTRACTION_CORRECTION",
  "REEXPORT_REQUIRED",
  "EXTRACTED_COMPLETE",
  "EXPORTED",
  "NO_DELTA",
  "CONTENT_RETRIEVED",
  "DETECTED",
  "LANGUAGE_PENDING",
  "FAILED_RETRIEVAL",
  "FAILED_PARSING"
];

export function App() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [candidates, setCandidates] = useState<CandidateLegalAct[]>([]);
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("ALL");
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetailResponse | null>(null);
  const [sourceContent, setSourceContent] = useState<SourceContentResponse | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [exportBatches, setExportBatches] = useState<ExportBatch[]>([]);
  const [downloadEvents, setDownloadEvents] = useState<ExportDownloadEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportActionError, setExportActionError] = useState<string | null>(null);
  const [isCreatingExportBatch, setIsCreatingExportBatch] = useState(false);
  const [liveActionKind, setLiveActionKind] = useState<LiveActionKind>(null);
  const [liveActionMessage, setLiveActionMessage] = useState<string | null>(null);
  const [watchQueries, setWatchQueries] = useState<WatchQuery[]>([]);
  const [rssDraftName, setRssDraftName] = useState("");
  const [rssDraftUrl, setRssDraftUrl] = useState("");
  const [reexportReason, setReexportReason] = useState("");
  const [sourceView, setSourceView] = useState<SourceView>("official");
  const [evidenceJumpRequest, setEvidenceJumpRequest] = useState<EvidenceJumpRequest | null>(null);
  const candidateDetailCache = useRef(new Map<string, CandidateDetailResponse>());
  const sourceContentCache = useRef(new Map<string, SourceContentResponse>());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("sanctions-delta-theme", theme);
  }, [theme]);

  async function refreshWorkbench(preferredCandidateId?: string) {
    const [candidateResponse, overviewResponse, exportResponse, configurationResponse, auditResponse] = await Promise.all([
      fetchCandidateLegalActs(),
      fetchMonitorOverview(),
      fetchExportBatches(),
      fetchConfiguration(),
      fetchAuditEvents()
    ]);
    setCandidates(candidateResponse.candidates);
    setOverview(overviewResponse.overview);
    setExportBatches(exportResponse.exportBatches);
    setDownloadEvents(exportResponse.exportDownloadEvents);
    setWatchQueries(configurationResponse.watchQueries);
    setAuditEvents(auditResponse.auditEvents);
    setSelectedCandidateId(
      preferredCandidateId && candidateResponse.candidates.some((candidate) => candidate.id === preferredCandidateId)
        ? preferredCandidateId
        : getInitialCandidateId(candidateResponse.candidates)
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadWorkbench() {
      try {
        if (!cancelled) {
          await refreshWorkbench();
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load Evidence Workbench");
        }
      }
    }

    void loadWorkbench();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSelectedCandidate(candidateId: string) {
    const [candidateResponse, overviewResponse, exportResponse, auditResponse, detail] = await Promise.all([
      fetchCandidateLegalActs(),
      fetchMonitorOverview(),
      fetchExportBatches(),
      fetchAuditEvents(),
      fetchCandidateDetail(candidateId)
    ]);

    setCandidates(candidateResponse.candidates);
    setOverview(overviewResponse.overview);
    setExportBatches(exportResponse.exportBatches);
    setDownloadEvents(exportResponse.exportDownloadEvents);
    setAuditEvents(auditResponse.auditEvents);
    setCandidateDetail(detail);
    candidateDetailCache.current.set(candidateId, detail);
    setSelectedCandidateId(candidateId);

    try {
      const content = await fetchSourceContent(candidateId);
      sourceContentCache.current.set(candidateId, content);
      setSourceContent(content);
      setSourceError(null);
    } catch (cause) {
      sourceContentCache.current.delete(candidateId);
      setSourceContent(null);
      setSourceError(cause instanceof Error ? cause.message : "Source Content is not available");
    }
  }

  const rssWatchQueries = useMemo(
    () => watchQueries.filter((query) => query.source === "RSS" && query.isActive),
    [watchQueries]
  );

  async function handleRunLiveRss(watchQuery: WatchQuery) {
    setLiveActionKind("rss");
    setLiveActionMessage(null);
    setError(null);

    try {
      const result = await runRssMonitor({
        watchQueryId: watchQuery.id,
        publicationYear: RSS_PUBLICATION_YEAR,
        ...(watchQuery.feedUrl ? { feedUrl: watchQuery.feedUrl } : {})
      });
      await refreshWorkbench(result.candidates[0]?.id);
      setLiveActionMessage(
        `${watchQuery.name} ${result.monitorRun.status}: ${result.monitorRun.itemsSeen} items, ${result.monitorRun.newCandidates} new 2026 candidates.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to run live RSS feed");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleRunAllLiveRss() {
    setLiveActionKind("rss");
    setLiveActionMessage(null);
    setError(null);

    try {
      let itemsSeen = 0;
      let newCandidates = 0;
      let preferredCandidateId: string | undefined;

      for (const watchQuery of rssWatchQueries) {
        const result = await runRssMonitor({
          watchQueryId: watchQuery.id,
          publicationYear: RSS_PUBLICATION_YEAR,
          ...(watchQuery.feedUrl ? { feedUrl: watchQuery.feedUrl } : {})
        });
        itemsSeen += result.monitorRun.itemsSeen;
        newCandidates += result.monitorRun.newCandidates;
        preferredCandidateId ??= result.candidates[0]?.id;
      }

      await refreshWorkbench(preferredCandidateId);
      setLiveActionMessage(
        `RSS queries complete: ${rssWatchQueries.length} feeds, ${itemsSeen} items, ${newCandidates} new 2026 candidates.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to run configured RSS queries");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleCreateRssWatchQuery() {
    setLiveActionKind("rss");
    setLiveActionMessage(null);
    setError(null);

    try {
      const result = await createRssWatchQuery({
        name: rssDraftName.trim() || "EUR-Lex RSS query",
        feedUrl: rssDraftUrl.trim()
      });
      setRssDraftName("");
      setRssDraftUrl("");
      await refreshWorkbench(selectedCandidateId ?? undefined);
      setLiveActionMessage(`RSS query saved: ${result.watchQuery.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save RSS query");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleRetrieveLiveSourceContent() {
    if (!selectedCandidate) {
      return;
    }

    setLiveActionKind("retrieve");
    setLiveActionMessage(null);
    setSourceError(null);

    try {
      await retrieveSourceContent(selectedCandidate.id, "live");
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("Official English Source Content retrieved from CELLAR.");
    } catch (cause) {
      setSourceError(cause instanceof Error ? cause.message : "Unable to retrieve live Source Content");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleClassifySourceContent() {
    if (!selectedCandidate) {
      return;
    }

    setLiveActionKind("classify");
    setLiveActionMessage(null);
    setExportActionError(null);

    try {
      await classifySourceContent(selectedCandidate.id);
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("Source Content classified and Annex records extracted.");
    } catch (cause) {
      setExportActionError(cause instanceof Error ? cause.message : "Unable to classify Source Content");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleAiExtractSourceContent() {
    if (!selectedCandidate) {
      return;
    }

    setLiveActionKind("ai-extract");
    setLiveActionMessage(null);
    setExportActionError(null);

    try {
      await aiExtractSourceContent(selectedCandidate.id);
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("AI extraction completed from official Source Content.");
    } catch (cause) {
      setExportActionError(cause instanceof Error ? cause.message : "Unable to run AI extraction");
    } finally {
      setLiveActionKind(null);
    }
  }

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0] ?? null,
    [candidates, selectedCandidateId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCandidate(candidateId: string) {
      const cachedDetail = candidateDetailCache.current.get(candidateId);
      const cachedSourceContent = sourceContentCache.current.get(candidateId);

      setCandidateDetail(cachedDetail ?? null);
      setSourceContent(cachedSourceContent ?? null);
      setSourceError(null);
      setExportActionError(null);
      setReexportReason("");

      if (cachedDetail && (cachedSourceContent || !cachedDetail.candidate.sourceContent)) {
        return;
      }

      const [detail, contentResult] = await Promise.all([
        cachedDetail ? Promise.resolve(cachedDetail) : fetchCandidateDetail(candidateId),
        cachedSourceContent
          ? Promise.resolve({ ok: true as const, content: cachedSourceContent })
          : selectedCandidate?.sourceContent
            ? fetchSourceContent(candidateId)
                .then((content) => ({ ok: true as const, content }))
                .catch((cause) => ({ ok: false as const, cause }))
            : Promise.resolve({ ok: true as const, content: null })
      ]);

      if (cancelled) {
        return;
      }

      candidateDetailCache.current.set(candidateId, detail);
      setCandidateDetail(detail);

      if (contentResult.ok) {
        if (contentResult.content) {
          sourceContentCache.current.set(candidateId, contentResult.content);
        }
        setSourceContent(contentResult.content);
      } else {
        setSourceContent(null);
        setSourceError(contentResult.cause instanceof Error ? contentResult.cause.message : "Source Content is not available");
      }
    }

    if (selectedCandidate?.id) {
      void loadCandidate(selectedCandidate.id).catch((cause) => {
        if (!cancelled) {
          setCandidateDetail(null);
          setSourceContent(null);
          setSourceError(cause instanceof Error ? cause.message : "Candidate detail is not available");
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedCandidate?.id]);

  const statusGroups = useMemo(() => groupCandidatesByStatus(candidates), [candidates]);
  const visibleGroups = useMemo(
    () =>
      statusGroups
        .filter((group) => queueFilter === "ALL" || group.status === queueFilter)
        .filter((group) => group.candidates.length > 0),
    [queueFilter, statusGroups]
  );

  const selectedRecords = candidateDetail?.sanctionsDeltaRecords ?? [];
  const selectedExtraction = getLatestExtractionResult(candidateDetail?.extractionResults ?? []);
  const selectedBatches = candidateDetail?.exportBatches ?? [];
  const completeExtractionGate = candidateDetail?.completeExtractionGate ?? null;
  const exportReadiness = getExportReadiness({
    candidate: candidateDetail?.candidate ?? selectedCandidate,
    completeExtractionGate,
    extractionResult: selectedExtraction,
    exportBatches: selectedBatches,
    reexportRequired: candidateDetail?.reexportState.reexportRequired ?? false
  });

  async function handleCreateExportBatch() {
    if (!selectedCandidate || !exportReadiness.canCreateExportBatch) {
      return;
    }

    setIsCreatingExportBatch(true);
    setExportActionError(null);

    try {
      await createExportBatch(
        selectedCandidate.id,
        exportReadiness.requiresReexport ? reexportReason.trim() : undefined
      );
      const [candidateResponse, overviewResponse, exportResponse, auditResponse, detail] = await Promise.all([
        fetchCandidateLegalActs(),
        fetchMonitorOverview(),
        fetchExportBatches(),
        fetchAuditEvents(),
        fetchCandidateDetail(selectedCandidate.id)
      ]);
      setCandidates(candidateResponse.candidates);
      setOverview(overviewResponse.overview);
      setExportBatches(exportResponse.exportBatches);
      setDownloadEvents(exportResponse.exportDownloadEvents);
      setAuditEvents(auditResponse.auditEvents);
      setCandidateDetail(detail);
      candidateDetailCache.current.set(selectedCandidate.id, detail);
    } catch (cause) {
      setExportActionError(cause instanceof Error ? cause.message : "Unable to create Export Batch");
    } finally {
      setIsCreatingExportBatch(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandLockup">
          <span className="brandLogoFrame">
            <img alt="" className="brandLogo" src={theme === "dark" ? "/logo-dark.png" : "/logo.png"} />
          </span>
          <div>
            <p className="eyebrow">Evidence Workbench</p>
            <h1>Candidate Legal Act operations</h1>
          </div>
        </div>
        <nav aria-label="Primary">
          <a href="#monitor">Monitor</a>
          <a className="active" href="#workbench">
            Candidate Workbench
          </a>
          <a href="#correction">Extraction Correction</a>
          <a href="#exports">Export Batches</a>
          <a href="#audit">Audit Trail</a>
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            aria-pressed={theme === "dark"}
            className="themeSwitch"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <span className="themeSwitchTrack" aria-hidden="true">
              <span className="themeSwitchThumb">
                {theme === "dark" ? (
                  <svg viewBox="0 0 24 24" role="img">
                    <path d="M20 15.5A8.4 8.4 0 0 1 8.5 4a7 7 0 1 0 11.5 11.5Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" role="img">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
                  </svg>
                )}
              </span>
            </span>
          </button>
        </nav>
      </header>

      <section className="metrics" id="monitor" aria-label="Monitoring overview">
        <Metric label="Last successful run" value={formatRunTime(overview?.lastSuccessfulRun)} />
        <Metric label="Candidate Legal Acts today" value={formatCount(overview?.candidatesToday)} />
        <Metric
          label="Extraction Correction"
          value={formatCount(overview?.candidatesNeedingExtractionCorrection)}
          tone="warning"
        />
        <Metric
          label="Complete Extraction ready"
          value={formatCount(overview?.completeExtractionsReadyForExport)}
          tone="success"
        />
        <Metric label="Export Batches today" value={formatCount(overview?.exportBatchesCreatedToday)} />
        <Metric
          label="Retrieval or parsing failures"
          value={formatCount(overview?.failedRetrievalOrParsing)}
          tone="danger"
        />
      </section>

      <section className="liveControls" aria-label="Live EUR-Lex controls">
        <div className="liveControlsHeader">
          <div>
            <span>RSS queries</span>
            <strong>
              {rssWatchQueries.length} active EUR-Lex feed{rssWatchQueries.length === 1 ? "" : "s"} · {RSS_PUBLICATION_YEAR} only
            </strong>
          </div>
          <button disabled={liveActionKind !== null || rssWatchQueries.length === 0} onClick={handleRunAllLiveRss}>
            Run all
          </button>
        </div>
        <details className="rssDetails">
          <summary>Manage feeds and add RSS query</summary>
          <div className="rssQueryList">
            {rssWatchQueries.map((watchQuery) => (
              <div className="rssQuery" key={watchQuery.id}>
                <div>
                  <strong>{watchQuery.name}</strong>
                  <code>{watchQuery.feedUrl ?? watchQuery.queryText}</code>
                </div>
                <button
                  disabled={liveActionKind !== null || !(watchQuery.feedUrl ?? watchQuery.queryText).trim()}
                  onClick={() => void handleRunLiveRss(watchQuery)}
                >
                  Run
                </button>
              </div>
            ))}
          </div>
          <div className="rssQueryForm">
            <label>
              <span>Name</span>
              <input value={rssDraftName} onChange={(event) => setRssDraftName(event.target.value)} />
            </label>
            <label>
              <span>Feed URL</span>
              <input value={rssDraftUrl} onChange={(event) => setRssDraftUrl(event.target.value)} />
            </label>
            <button disabled={liveActionKind !== null || rssDraftUrl.trim().length === 0} onClick={handleCreateRssWatchQuery}>
              Add RSS query
            </button>
          </div>
        </details>
        {liveActionMessage ? <p>{liveActionMessage}</p> : null}
      </section>

      {error ? <p className="loadState error">Unable to load API data: {error}</p> : null}

      <section className="workbench" id="workbench">
        <aside className="candidateQueue" aria-label="Candidate Legal Act queue">
          <div className="panelHeader">
            <div>
              <h2>Candidate Legal Acts</h2>
              <p>Status grouped queue</p>
            </div>
            <span className="countBadge">{candidates.length}</span>
          </div>
          <div className="filterBar" aria-label="Candidate Legal Act status filter">
            <button className={queueFilter === "ALL" ? "active" : ""} onClick={() => setQueueFilter("ALL")}>
              <span>All</span>
              <strong className="filterCount all">{candidates.length}</strong>
            </button>
            {statusGroups
              .filter((group) => group.candidates.length > 0)
              .map((group) => (
                <button
                  className={queueFilter === group.status ? "active" : ""}
                  key={group.status}
                  onClick={() => setQueueFilter(group.status)}
                >
                  <span>{formatStatus(group.status)}</span>
                  <strong className={`filterCount ${statusClass(group.status)}`}>{group.candidates.length}</strong>
                </button>
              ))}
          </div>
          <div className="queueList">
            {visibleGroups.map((group) => (
              <section className="queueGroup" key={group.status} aria-label={`${formatStatus(group.status)} group`}>
                <div className="queueGroupHeader">
                  <span>{formatStatus(group.status)}</span>
                  <strong>{group.candidates.length}</strong>
                </div>
                {group.candidates.map((candidate) => (
                  <button
                    className={`queueItem ${candidate.id === selectedCandidate?.id ? "selected" : ""}`}
                    key={candidate.id}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                  >
                    <span className={`status ${statusClass(candidate.status)}`}>{formatStatus(candidate.status)}</span>
                    <strong>{candidate.celexId ?? candidate.legalActIdentityValue ?? candidate.id}</strong>
                    <span className="queueTitle">{candidate.title}</span>
                    <small>
                      {candidate.publicationDate ?? "No date"} · {formatRetrievalState(candidate)}
                    </small>
                  </button>
                ))}
              </section>
            ))}
            {candidates.length === 0 && !error ? (
              <p className="loadState">No Candidate Legal Acts yet. Run RSS monitoring to discover 2026 candidates.</p>
            ) : null}
            {candidates.length > 0 && visibleGroups.length === 0 ? (
              <p className="loadState">No Candidate Legal Acts match this status.</p>
            ) : null}
          </div>
        </aside>

        <section className="sourceViewer" aria-label="Candidate Legal Act detail and Source Content">
          <CandidateSummary candidate={candidateDetail?.candidate ?? selectedCandidate} extraction={selectedExtraction} />
          <div className="sourceHeader">
            <div className="sourceTitle">
              <div className="sourceTabs" aria-label="Source Content views">
                <button className={sourceView === "official" ? "active" : ""} onClick={() => setSourceView("official")}>
                  Official Journal (EN)
                </button>
                <button className={sourceView === "metadata" ? "active" : ""} onClick={() => setSourceView("metadata")}>
                  Source Metadata
                </button>
              </div>
              <p>
                {sourceContent?.sourceContent.reference ??
                  sourceError ??
                  (selectedCandidate ? "Loading official English Source Content" : "Select a Candidate Legal Act")}
              </p>
            </div>
            <div className="sourceActions">
              {selectedCandidate?.sourceUrl ? (
                <a className="buttonLink" href={selectedCandidate.sourceUrl} rel="noreferrer" target="_blank">
                  Official source
                </a>
              ) : null}
              {selectedCandidate ? (
                <>
                  <button disabled={liveActionKind !== null} onClick={handleRetrieveLiveSourceContent}>
                    {liveActionKind === "retrieve" ? <span className="spinner" aria-hidden="true" /> : null}
                    Retrieve live
                  </button>
                  <button disabled={liveActionKind !== null || !selectedCandidate.sourceContent} onClick={handleClassifySourceContent}>
                    {liveActionKind === "classify" ? <span className="spinner" aria-hidden="true" /> : null}
                    Classify
                  </button>
                  <button
                    className={liveActionKind === "ai-extract" ? "busyAction" : ""}
                    disabled={liveActionKind !== null || !selectedCandidate.sourceContent}
                    onClick={handleAiExtractSourceContent}
                  >
                    {liveActionKind === "ai-extract" ? <span className="spinner" aria-hidden="true" /> : null}
                    {liveActionKind === "ai-extract" ? "Extracting..." : "AI Extract"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <SourceContentPanel
            content={sourceContent?.content}
            evidenceJumpRequest={evidenceJumpRequest}
            extraction={selectedExtraction}
            hasCandidate={selectedCandidate !== null}
            sourceContent={sourceContent}
            sourceView={sourceView}
            candidate={candidateDetail?.candidate ?? selectedCandidate}
            records={selectedRecords}
            sourceError={sourceError}
          />
        </section>

        <aside className="recordPanel" aria-label="Sanctions Delta Records and export readiness">
          <div className="panelHeader compact">
            <div>
              <h2>Sanctions Delta Records</h2>
              <p>{selectedRecords.length} extracted from this Candidate Legal Act</p>
            </div>
            <span className={`status ${completeExtractionGate?.ready ? "extracted_complete" : "needs_extraction_correction"}`}>
              {completeExtractionGate?.ready ? "Complete Extraction" : "Gate blocked"}
            </span>
          </div>
          <RecordTable
            records={selectedRecords}
            onJumpToEvidence={(recordId) => {
              setSourceView("official");
              setEvidenceJumpRequest({ recordId, requestedAt: Date.now() });
            }}
          />
          <ExtractionPanel
            extraction={selectedExtraction}
            correctionActions={candidateDetail?.correctionActions ?? []}
            gate={completeExtractionGate}
          />
          <ExportReadinessPanel
            batches={selectedBatches}
            downloadEvents={downloadEvents}
            exportActionError={exportActionError}
            exportReadiness={exportReadiness}
            isCreatingExportBatch={isCreatingExportBatch}
            onCreateExportBatch={handleCreateExportBatch}
            reexportReason={reexportReason}
            onReexportReasonChange={setReexportReason}
          />
        </aside>
      </section>

      <section className="supportGrid">
        <section className="exportSection" id="correction" aria-label="Extraction Correction visibility">
          <div className="sectionHeader">
            <div>
              <h2>Extraction Correction</h2>
              <p>Source-backed correction state for the selected Candidate Legal Act</p>
            </div>
            <span className="countBadge">{candidateDetail?.correctionActions.length ?? 0}</span>
          </div>
          <div className="supportBody">
            <ExtractionPanel
              extraction={selectedExtraction}
              correctionActions={candidateDetail?.correctionActions ?? []}
              gate={completeExtractionGate}
            />
          </div>
        </section>

        <section className="exportSection" id="audit" aria-label="Audit Trail visibility">
          <div className="sectionHeader">
            <div>
              <h2>Audit Trail</h2>
              <p>Recent immutable system events for monitoring, extraction, and export actions</p>
            </div>
            <span className="countBadge">{auditEvents.length}</span>
          </div>
          <AuditTrail events={auditEvents} />
        </section>
      </section>

      <section className="exportSection" id="exports" aria-label="Export Batch visibility">
        <div className="sectionHeader">
          <div>
            <h2>Export Batches</h2>
            <p>Immutable Audit Export history across Candidate Legal Acts</p>
          </div>
          <span className="countBadge">{exportBatches.length}</span>
        </div>
        <ExportBatchTable batches={exportBatches} downloadEvents={downloadEvents} />
      </section>
    </main>
  );
}

function CandidateSummary({
  candidate,
  extraction
}: {
  candidate: CandidateLegalAct | null;
  extraction: ExtractionResult | undefined;
}) {
  return (
    <div className="candidateSummary">
      <div>
        <p className="eyebrow">Candidate Legal Act</p>
        <h2>{candidate?.title ?? "Select a Candidate Legal Act"}</h2>
        <dl>
          <div>
            <dt>Legal Act Identity</dt>
            <dd>
              {candidate?.legalActIdentityKind ?? "Unknown"} ·{" "}
              {candidate?.legalActIdentityValue ?? candidate?.celexId ?? "No identity"}
            </dd>
          </div>
          <div>
            <dt>Working language</dt>
            <dd>{candidate?.workingLanguage.toUpperCase() ?? "EN"}</dd>
          </div>
          <div>
            <dt>Parser version</dt>
            <dd>{extraction?.parserVersion ?? "No parser run"}</dd>
          </div>
          <div>
            <dt>Delta Action state</dt>
            <dd>{extraction ? formatClassification(extraction.classification) : "Pending extraction"}</dd>
          </div>
        </dl>
      </div>
      <span className={`status ${candidate ? statusClass(candidate.status) : ""}`}>
        {candidate ? formatStatus(candidate.status) : "No selection"}
      </span>
    </div>
  );
}

function SourceContentPanel({
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
  const evidenceLineRefs = useRef(new Map<string, HTMLDivElement>());
  const processedEvidenceJumpRequest = useRef<number | null>(null);
  const [highlightedEvidenceRecordId, setHighlightedEvidenceRecordId] = useState<string | null>(null);
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
      return;
    }

    processedEvidenceJumpRequest.current = evidenceJumpRequest.requestedAt;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedEvidenceRecordId(evidenceJumpRequest.recordId);

    const timeout = window.setTimeout(() => setHighlightedEvidenceRecordId(null), 2200);

    return () => window.clearTimeout(timeout);
  }, [evidenceJumpRequest, sourceView]);

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
    <div className="evidence" aria-label="Evidence Text in Source Content">
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

function RecordTable({
  records,
  onJumpToEvidence
}: {
  records: SanctionsDeltaRecord[];
  onJumpToEvidence: (recordId: string) => void;
}) {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(records[0]?.id ?? null);
  const [expandedEvidenceRecordId, setExpandedEvidenceRecordId] = useState<string | null>(null);
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null;
  const isEvidenceExpanded = selectedRecord ? expandedEvidenceRecordId === selectedRecord.id : false;
  const shouldCollapseEvidence = Boolean(selectedRecord && selectedRecord.evidenceText.length > 180);

  useEffect(() => {
    if (!selectedRecordId || !records.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(records[0]?.id ?? null);
      setExpandedEvidenceRecordId(null);
    }
  }, [records, selectedRecordId]);

  if (records.length === 0) {
    return <p className="recordEmpty">No Sanctions Delta Records extracted for this Candidate Legal Act.</p>;
  }

  return (
    <div className="recordReview">
      <div className="recordList" aria-label="Extracted Sanctions Delta Records">
        {records.map((record) => (
          <button
            className={`recordListItem ${record.id === selectedRecord?.id ? "selected" : ""}`}
            key={record.id}
            onClick={() => setSelectedRecordId(record.id)}
          >
            <span className="recordOrder">{record.sourceOrder}</span>
            <span className="recordNameBlock">
              <strong>{record.primaryName}</strong>
              <small>
                {record.affectedAnnex ?? "Annex unknown"} · {record.recordType}
              </small>
            </span>
            <span className={`deltaAction ${record.actionType.toLowerCase()}`}>
              {formatDeltaAction(record.actionType)}
            </span>
          </button>
        ))}
      </div>

      <div className="recordDetail" aria-label="Selected Sanctions Delta Record">
        {selectedRecord ? (
          <>
            <div className="recordDetailHeader">
              <div>
                <span className="recordType">{selectedRecord.recordType}</span>
                <h3>{selectedRecord.primaryName}</h3>
              </div>
              <span className={`deltaAction ${selectedRecord.actionType.toLowerCase()}`}>
                {formatDeltaAction(selectedRecord.actionType)}
              </span>
            </div>
            <dl className="recordFacts">
              <div>
                <dt>Source order</dt>
                <dd>{selectedRecord.sourceOrder}</dd>
              </div>
              <div>
                <dt>Affected annex</dt>
                <dd>{selectedRecord.affectedAnnex ?? "Not identified"}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round(selectedRecord.confidence * 100)}%</dd>
              </div>
              <div>
                <dt>Source location</dt>
                <dd>{selectedRecord.sourceLocation ?? "Not identified"}</dd>
              </div>
            </dl>
            <div className="evidenceBlock">
              <div className="evidenceBlockHeader">
                <strong>Evidence text</strong>
                <button onClick={() => onJumpToEvidence(selectedRecord.id)}>Jump to evidence</button>
                {shouldCollapseEvidence ? (
                  <button
                    onClick={() =>
                      setExpandedEvidenceRecordId(isEvidenceExpanded ? null : selectedRecord.id)
                    }
                  >
                    {isEvidenceExpanded ? "Show less" : "Read full"}
                  </button>
                ) : null}
              </div>
              <p className={shouldCollapseEvidence && !isEvidenceExpanded ? "collapsedEvidence" : ""}>
                {selectedRecord.evidenceText}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ExtractionPanel({
  extraction,
  correctionActions,
  gate
}: {
  extraction: ExtractionResult | undefined;
  correctionActions: ExtractionCorrectionAction[];
  gate: CompleteExtractionGateResult | null;
}) {
  return (
    <div className="stackPanel">
      <div className="stackHeader">
        <h3>Complete Extraction gate</h3>
        <span>{gate?.ready ? "Ready" : "Blocked"}</span>
      </div>
      <dl className="inlineFacts">
        <div>
          <dt>Parser version</dt>
          <dd>{extraction?.parserVersion ?? "No parser run"}</dd>
        </div>
        <div>
          <dt>Classification</dt>
          <dd>{extraction ? formatClassification(extraction.classification) : "Pending"}</dd>
        </div>
        <div>
          <dt>Annex</dt>
          <dd>{extraction?.annexHeading ?? (extraction?.annexFound ? "Found" : "Not found")}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{extraction ? `${Math.round(extraction.confidence * 100)}%` : "Unknown"}</dd>
        </div>
      </dl>
      <ul className="gateList">
        {gate?.ready ? (
          <li className="done">Complete Extraction is ready for Candidate Legal Act export evaluation.</li>
        ) : gate ? (
          gate.blockers.map((blocker) => (
            <li className="blocked" key={blocker}>
              {blocker}
            </li>
          ))
        ) : (
          <li className="blocked">Candidate Legal Act detail is loading.</li>
        )}
      </ul>
      <div className="correctionStrip">
        <span>Extraction Correction</span>
        <strong>{correctionActions.length}</strong>
      </div>
    </div>
  );
}

function ExportReadinessPanel({
  batches,
  downloadEvents,
  exportActionError,
  exportReadiness,
  isCreatingExportBatch,
  onCreateExportBatch,
  onReexportReasonChange,
  reexportReason
}: {
  batches: ExportBatch[];
  downloadEvents: ExportDownloadEvent[];
  exportActionError: string | null;
  exportReadiness: ReturnType<typeof getExportReadiness>;
  isCreatingExportBatch: boolean;
  onCreateExportBatch: () => void;
  onReexportReasonChange: (value: string) => void;
  reexportReason: string;
}) {
  const actionDisabled =
    !exportReadiness.canCreateExportBatch ||
    isCreatingExportBatch ||
    (exportReadiness.requiresReexport && reexportReason.trim().length === 0);

  return (
    <div className="stackPanel">
      <div className="stackHeader">
        <h3>Export readiness</h3>
        <span>{exportReadiness.label}</span>
      </div>
      <p className="readinessText">{exportReadiness.reason}</p>
      {exportReadiness.requiresReexport ? (
        <label className="reasonField">
          <span>Re-Export reason</span>
          <input
            onChange={(event) => onReexportReasonChange(event.target.value)}
            placeholder="Parser rerun changed Complete Extraction"
            value={reexportReason}
          />
        </label>
      ) : null}
      {exportActionError ? <p className="loadState error">{exportActionError}</p> : null}
      <button
        className="primaryAction"
        disabled={actionDisabled}
        onClick={onCreateExportBatch}
      >
        {exportReadiness.requiresReexport ? "Create Re-Export" : "Create Export Batch"}
      </button>
      <ExportBatchTable batches={batches} compact downloadEvents={downloadEvents} />
    </div>
  );
}

function ExportBatchTable({
  batches,
  compact = false,
  downloadEvents
}: {
  batches: ExportBatch[];
  compact?: boolean;
  downloadEvents: ExportDownloadEvent[];
}) {
  return (
    <div className="tableScroll">
      <table className={compact ? "compactTable" : ""}>
        <thead>
          <tr>
            <th>Export Batch</th>
            {!compact ? <th>Candidate Legal Act</th> : null}
            <th>Records</th>
            <th>CSV hash</th>
            <th>Snapshot hash</th>
            <th>Re-Export</th>
            <th>Downloads</th>
            <th>CSV</th>
          </tr>
        </thead>
        <tbody>
          {batches.length > 0 ? (
            batches.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <strong>{batch.fileName}</strong>
                  <small>{formatDateTime(batch.createdAt)}</small>
                </td>
                {!compact ? <td>{batch.candidateId}</td> : null}
                <td>{batch.recordCount}</td>
                <td className="hashCell">{shortHash(batch.fileHash)}</td>
                <td className="hashCell">{shortHash(batch.extractionSnapshotHash)}</td>
                <td>{batch.reexportOfBatchId ? `Re-Export of ${shortHash(batch.reexportOfBatchId)}` : "No"}</td>
                <td>{downloadEvents.filter((event) => event.exportBatchId === batch.id).length}</td>
                <td>
                  <a className="downloadLink" href={`/api/export/batches/${batch.id}/download?actor=evidence-workbench`}>
                    Download
                  </a>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={compact ? 7 : 8}>No immutable Export Batches have been created.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditTrail({ events }: { events: AuditEvent[] }) {
  const visibleEvents = [...events]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 8);

  return (
    <div className="auditList">
      {visibleEvents.length > 0 ? (
        visibleEvents.map((event) => (
          <div className="auditItem" key={event.id}>
            <div>
              <strong>{formatStatus(event.type)}</strong>
              <span>{formatDateTime(event.occurredAt)}</span>
            </div>
            <small>
              {[event.candidateId, event.monitorRunId, event.exportBatchId].filter(Boolean).join(" · ") ||
                event.actor}
            </small>
          </div>
        ))
      ) : (
        <p className="loadState">No audit events have been recorded in this dev session.</p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function groupCandidatesByStatus(candidates: CandidateLegalAct[]) {
  const orderedStatuses = [
    ...statusOrder,
    ...candidates.map((candidate) => candidate.status).filter((status) => !statusOrder.includes(status))
  ];

  return orderedStatuses.map((status) => ({
    status,
    candidates: candidates
      .filter((candidate) => candidate.status === status)
      .sort(compareCandidatesByNewestPublication)
  }));
}

function compareCandidatesByNewestPublication(left: CandidateLegalAct, right: CandidateLegalAct) {
  const publicationComparison = compareOptionalDateDesc(left.publicationDate, right.publicationDate);

  if (publicationComparison !== 0) {
    return publicationComparison;
  }

  const seenComparison = compareOptionalDateDesc(left.lastSeenAt, right.lastSeenAt);

  if (seenComparison !== 0) {
    return seenComparison;
  }

  return left.title.localeCompare(right.title);
}

function compareOptionalDateDesc(left: string | undefined, right: string | undefined) {
  if (left && right) {
    return right.localeCompare(left);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem("sanctions-delta-theme");

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getExportReadiness({
  candidate,
  completeExtractionGate,
  extractionResult,
  exportBatches,
  reexportRequired
}: {
  candidate: CandidateLegalAct | null;
  completeExtractionGate: CompleteExtractionGateResult | null;
  extractionResult: ExtractionResult | undefined;
  exportBatches: ExportBatch[];
  reexportRequired: boolean;
}) {
  if (!candidate) {
    return {
      label: "No Candidate Legal Act",
      reason: "Select a Candidate Legal Act before creating an Export Batch.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (candidate.status === "NO_DELTA") {
    return {
      label: "No Delta",
      reason: "This Candidate Legal Act is classified as No Delta, so no Export Batch is required.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (!extractionResult) {
    return {
      label: "Parser pending",
      reason: "A parser result is required before Complete Extraction can be evaluated.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (!completeExtractionGate?.ready) {
    return {
      label: "Gate blocked",
      reason: "Complete Extraction is blocked. Use Extraction Correction before creating an Export Batch.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (reexportRequired) {
    return {
      label: "Re-Export required",
      reason: "Current Complete Extraction differs from the latest immutable Export Batch.",
      canCreateExportBatch: true,
      requiresReexport: true
    };
  }

  if (exportBatches.length > 0 || candidate.status === "EXPORTED") {
    return {
      label: "Export Batch exists",
      reason: "The latest Complete Extraction already has an immutable Export Batch.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  return {
    label: "Ready",
    reason: "Complete Extraction is ready for one immutable Export Batch containing all Sanctions Delta Records.",
    canCreateExportBatch: true,
    requiresReexport: false
  };
}

function getInitialCandidateId(candidates: CandidateLegalAct[]) {
  return (
    candidates.find((candidate) => candidate.status === "NEEDS_EXTRACTION_CORRECTION")?.id ??
    candidates.find((candidate) => candidate.status === "EXTRACTED_COMPLETE")?.id ??
    candidates[0]?.id ??
    null
  );
}

function getLatestExtractionResult(results: ExtractionResult[]) {
  return [...results].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
}

function formatCount(value: number | undefined) {
  return value === undefined ? "..." : String(value);
}

function formatRunTime(value: string | undefined) {
  return value ? formatDateTime(value) : "...";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatRetrievalState(candidate: CandidateLegalAct) {
  if (candidate.sourceContent) {
    return `Source Content ${shortHash(candidate.sourceContent.contentHash)}`;
  }

  if (candidate.status === "LANGUAGE_PENDING") {
    return "Working Language pending";
  }

  if (candidate.status === "FAILED_RETRIEVAL") {
    return "Source Content retrieval failed";
  }

  return candidate.retrieval?.status ? formatStatus(candidate.retrieval.status) : "Source Content pending";
}

function formatStatus(value: string) {
  if (value === "EXTRACTED_COMPLETE") {
    return "Extracted";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatClassification(value: string) {
  if (value === "NO_DELTA" || value === "UNCERTAIN_NO_DELTA") {
    return value === "NO_DELTA" ? "No Delta" : "Uncertain No Delta";
  }

  return formatStatus(value);
}

function formatDeltaAction(value: string) {
  return formatStatus(value);
}

function statusClass(status: string) {
  return status.toLowerCase();
}

function shortHash(value: string) {
  return value.length > 12 ? value.slice(0, 12) : value;
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
        normalizedEvidence,
        evidenceParts: normalizedEvidence
          .split(/[.;]/)
          .map((part) => part.trim())
          .filter((part) => part.length > 8)
      };
    })
    .filter((matcher) => matcher.normalizedEvidence.length > 0);
}

function findEvidenceMatches(line: string, matchers: EvidenceMatcher[]) {
  const normalizedLine = normalizeEvidence(line);

  return matchers.filter(
    (matcher) =>
      normalizedLine.includes(matcher.normalizedEvidence) ||
      matcher.evidenceParts.some((part) => normalizedLine.includes(part))
  );
}

function normalizeEvidence(value: string) {
  return value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
