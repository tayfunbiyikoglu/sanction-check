import type {
  CandidateLegalAct,
  CompleteExtractionGateResult,
  ExportBatch,
  ExportDownloadEvent,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorOverview,
  SanctionsDeltaRecord,
  SanctionsDeltaRecordReview,
  WatchQuery
} from "@sanctions/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  aiExtractSourceContent,
  classifySourceContent,
  createExportBatch,
  createRssWatchQuery,
  fetchCandidateDetail,
  fetchCandidateLegalActs,
  fetchConfiguration,
  fetchExportBatches,
  fetchAuditEvents,
  fetchMonitorOverview,
  fetchSourceContent,
  markExtractionComplete,
  retrieveSourceContent,
  runRssMonitor,
  saveRecordReview
} from "../api/client.js";
import type { AiExtractionUndercountResponse, CandidateDetailResponse, SourceContentResponse } from "../api/client.js";
import type { AuditEvent } from "../api/client.js";
import { SourceContentPanel } from "./SourceContentPanel.js";
import {
  getExportReadiness,
  getInitialCandidateId,
  getLatestExtractionResult,
  groupCandidatesByStatus,
  RSS_PUBLICATION_YEAR,
  type EvidenceJumpRequest,
  type LiveActionKind,
  type QueueFilter,
  type ReviewDecision,
  type SourceView,
  type Theme
} from "./workbench-model.js";

export { getExportReadiness, groupCandidatesByStatus } from "./workbench-model.js";

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
  const [aiExtractionUndercount, setAiExtractionUndercount] = useState<AiExtractionUndercountResponse | null>(null);
  const [isCreatingExportBatch, setIsCreatingExportBatch] = useState(false);
  const [isMarkingExtractionComplete, setIsMarkingExtractionComplete] = useState(false);
  const [markCompleteComment, setMarkCompleteComment] = useState("");
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

  async function handleAiExtractSourceContent() {
    if (!selectedCandidate) {
      return;
    }

    setLiveActionKind("ai-extract");
    setLiveActionMessage(null);
    setExportActionError(null);
    setAiExtractionUndercount(null);

    try {
      await aiExtractSourceContent(selectedCandidate.id);
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("AI extraction completed from official Source Content.");
    } catch (cause) {
      if (cause instanceof ApiRequestError && isAiExtractionUndercountResponse(cause.body)) {
        setAiExtractionUndercount(cause.body);
      }
      setExportActionError(cause instanceof Error ? cause.message : "Unable to run AI extraction");
    } finally {
      setLiveActionKind(null);
    }
  }

  async function handleUseAnnexExtraction() {
    if (!selectedCandidate) {
      return;
    }

    setLiveActionKind("annex-extract");
    setLiveActionMessage(null);
    setExportActionError(null);

    try {
      await classifySourceContent(selectedCandidate.id);
      setAiExtractionUndercount(null);
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("Deterministic Annex extraction applied.");
    } catch (cause) {
      setExportActionError(cause instanceof Error ? cause.message : "Unable to apply deterministic Annex extraction");
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
      setAiExtractionUndercount(null);
      setReexportReason("");
      setMarkCompleteComment("");

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

  async function handleMarkExtractionComplete() {
    if (!selectedCandidate) {
      return;
    }

    setIsMarkingExtractionComplete(true);
    setExportActionError(null);

    try {
      await markExtractionComplete(selectedCandidate.id, markCompleteComment);
      setMarkCompleteComment("");
      await refreshSelectedCandidate(selectedCandidate.id);
      setLiveActionMessage("Complete Extraction marked after analyst review.");
    } catch (cause) {
      setExportActionError(cause instanceof Error ? cause.message : "Unable to mark extraction complete");
    } finally {
      setIsMarkingExtractionComplete(false);
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
            <h1>Candidate Workbench</h1>
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
          <AiExtractionUndercountPanel
            disabled={liveActionKind !== null}
            isApplying={liveActionKind === "annex-extract"}
            onUseAnnexExtraction={handleUseAnnexExtraction}
            undercount={aiExtractionUndercount}
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
            candidate={candidateDetail?.candidate ?? selectedCandidate}
            reviewAvailable={(candidateDetail?.candidate ?? selectedCandidate)?.status !== "EXPORTED" && selectedBatches.length === 0}
            recordReviews={candidateDetail?.recordReviews ?? []}
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
            isMarkingComplete={isMarkingExtractionComplete}
            markCompleteComment={markCompleteComment}
            onMarkComplete={handleMarkExtractionComplete}
            onMarkCompleteCommentChange={setMarkCompleteComment}
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
              <p>Manual correction actions recorded for the selected Candidate Legal Act</p>
            </div>
            <span className="countBadge">{candidateDetail?.correctionActions.length ?? 0}</span>
          </div>
          <div className="supportBody">
            <CorrectionHistory
              candidate={candidateDetail?.candidate ?? selectedCandidate}
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

type AiRecordPreview = AiExtractionUndercountResponse["aiRecords"][number];

function isAiExtractionUndercountResponse(value: unknown): value is AiExtractionUndercountResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<AiExtractionUndercountResponse>;
  return (
    response.code === "AI_EXTRACTION_UNDERCOUNT" &&
    typeof response.aiRecordCount === "number" &&
    typeof response.deterministicRecordCount === "number" &&
    Array.isArray(response.aiRecords) &&
    Array.isArray(response.deterministicRecords)
  );
}

function AiExtractionUndercountPanel({
  disabled,
  isApplying,
  onUseAnnexExtraction,
  undercount
}: {
  disabled: boolean;
  isApplying: boolean;
  onUseAnnexExtraction: () => void;
  undercount: AiExtractionUndercountResponse | null;
}) {
  if (!undercount) {
    return null;
  }

  return (
    <div className="aiUndercountPanel" role="status" aria-live="polite">
      <div className="aiUndercountHeader">
        <div>
          <p className="eyebrow">AI Extraction Review</p>
          <h3>AI returned fewer records than Annex parsing</h3>
        </div>
        <div className="aiUndercountCounts">
          <span>
            AI <strong>{undercount.aiRecordCount}</strong>
          </span>
          <span>
            Annex <strong>{undercount.deterministicRecordCount}</strong>
          </span>
        </div>
      </div>
      <p className="aiUndercountMessage">{undercount.message}</p>
      <div className="aiUndercountActions">
        <button disabled={disabled} onClick={onUseAnnexExtraction}>
          {isApplying ? <span className="spinner" aria-hidden="true" /> : null}
          {isApplying ? "Applying Annex extraction..." : `Use Annex extraction (${undercount.deterministicRecordCount})`}
        </button>
      </div>
      <div className="aiUndercountGrid">
        <RecordPreviewList label="AI records returned" records={undercount.aiRecords} />
        <RecordPreviewList label="Deterministic records found" records={undercount.deterministicRecords} />
      </div>
    </div>
  );
}

function RecordPreviewList({ label, records }: { label: string; records: AiRecordPreview[] }) {
  return (
    <div className="aiRecordPreview">
      <div className="aiRecordPreviewHeader">
        <h4>{label}</h4>
        <span>{records.length}</span>
      </div>
      {records.length > 0 ? (
        <ol>
          {records.map((record) => (
            <li key={`${record.sourceOrder}-${record.primaryName}-${record.actionType}`}>
              <strong>{record.primaryName || "Unnamed record"}</strong>
              <span>
                {record.recordType} · {formatDeltaAction(record.actionType)}
              </span>
              {record.sourceLocation ? <small>{record.sourceLocation}</small> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="loadState">No records returned.</p>
      )}
    </div>
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

function RecordTable({
  candidate,
  recordReviews,
  records,
  reviewAvailable,
  onJumpToEvidence
}: {
  candidate: CandidateLegalAct | null;
  recordReviews: SanctionsDeltaRecordReview[];
  records: SanctionsDeltaRecord[];
  reviewAvailable: boolean;
  onJumpToEvidence: (recordId: string) => void;
}) {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(records[0]?.id ?? null);
  const [expandedEvidenceRecordId, setExpandedEvidenceRecordId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>(() =>
    buildReviewDecisionMap(recordReviews)
  );
  const [reviewSaveError, setReviewSaveError] = useState<string | null>(null);
  const [savingReviewRecordId, setSavingReviewRecordId] = useState<string | null>(null);
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null;
  const selectedRecordIndex = selectedRecord ? records.findIndex((record) => record.id === selectedRecord.id) : -1;
  const isEvidenceExpanded = selectedRecord ? expandedEvidenceRecordId === selectedRecord.id : false;
  const shouldCollapseEvidence = Boolean(selectedRecord && selectedRecord.evidenceText.length > 180);
  const reviewCounts = getReviewCounts(records, reviewDecisions);

  useEffect(() => {
    if (!selectedRecordId || !records.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(records[0]?.id ?? null);
      setExpandedEvidenceRecordId(null);
    }
  }, [records, selectedRecordId]);

  useEffect(() => {
    if (records.length === 0 || !reviewAvailable) {
      setReviewMode(false);
    }
  }, [records.length, reviewAvailable]);

  useEffect(() => {
    setReviewDecisions(buildReviewDecisionMap(recordReviews));
  }, [recordReviews]);

  useEffect(() => {
    if (!reviewMode) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelectedRecord(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelectedRecord(-1);
      } else if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        void markSelectedRecord("good", true);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void markSelectedRecord("flagged", true);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void markSelectedRecord("skipped", true);
      } else if (event.key.toLowerCase() === "e" && selectedRecord) {
        event.preventDefault();
        onJumpToEvidence(selectedRecord.id);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setReviewMode(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reviewMode, selectedRecord, selectedRecordIndex, records, reviewAvailable]);

  function moveSelectedRecord(direction: 1 | -1) {
    if (records.length === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(records.length - 1, selectedRecordIndex + direction));
    selectRecord(records[nextIndex]?.id ?? null, { jumpToEvidence: true });
    setExpandedEvidenceRecordId(null);
  }

  function selectRecord(recordId: string | null, options: { jumpToEvidence?: boolean } = {}) {
    setSelectedRecordId(recordId);

    if (recordId && options.jumpToEvidence) {
      onJumpToEvidence(recordId);
    }
  }

  function enterReviewMode() {
    setReviewMode(true);

    if (selectedRecord) {
      onJumpToEvidence(selectedRecord.id);
    }
  }

  async function markSelectedRecord(decision: ReviewDecision, advance = false) {
    if (!selectedRecord || !candidate || !reviewAvailable) {
      return;
    }

    setReviewSaveError(null);
    setSavingReviewRecordId(selectedRecord.id);
    setReviewDecisions((current) => ({
      ...current,
      [selectedRecord.id]: decision
    }));

    try {
      await saveRecordReview({
        candidateId: candidate.id,
        recordId: selectedRecord.id,
        decision
      });

      if (advance && selectedRecordIndex < records.length - 1) {
        selectRecord(records[selectedRecordIndex + 1]?.id ?? null, { jumpToEvidence: true });
        setExpandedEvidenceRecordId(null);
      }
    } catch (cause) {
      setReviewSaveError(cause instanceof Error ? cause.message : "Unable to save record review");
    } finally {
      setSavingReviewRecordId(null);
    }
  }

  if (records.length === 0) {
    return <p className="recordEmpty">No Sanctions Delta Records extracted for this Candidate Legal Act.</p>;
  }

  if (reviewMode && selectedRecord) {
    const selectedDecision = reviewDecisions[selectedRecord.id];

    return (
      <div className="nameReviewMode">
        <div className="reviewToolbar">
          <div>
            <strong>Name review</strong>
            <span>
              {reviewCounts.reviewed} of {records.length} reviewed · {reviewCounts.flagged} flagged ·{" "}
              {reviewCounts.skipped} skipped
            </span>
          </div>
          <button onClick={() => setReviewMode(false)}>Exit review</button>
        </div>

        <div className="reviewProgress" aria-hidden="true">
          <span style={{ width: `${Math.round((reviewCounts.reviewed / records.length) * 100)}%` }} />
        </div>

        <div className="reviewCard">
          <div className="reviewCardHeader">
            <div>
              <p>
                Record {selectedRecordIndex + 1} of {records.length}
              </p>
              <h3>{selectedRecord.primaryName}</h3>
            </div>
            <ReviewDecisionBadge decision={selectedDecision} />
          </div>

          <div className="reviewChips">
            <span className="recordType">{selectedRecord.recordType}</span>
            <span className={`deltaAction ${selectedRecord.actionType.toLowerCase()}`}>
              {formatDeltaAction(selectedRecord.actionType)}
            </span>
            <span>{selectedRecord.affectedAnnex ?? "Annex unknown"}</span>
            <span>{Math.round(selectedRecord.confidence * 100)}% confidence</span>
          </div>

          <dl className="recordFacts reviewFacts">
            <div>
              <dt>Source order</dt>
              <dd>{selectedRecord.sourceOrder}</dd>
            </div>
            <div>
              <dt>Source location</dt>
              <dd>{selectedRecord.sourceLocation ?? "Not identified"}</dd>
            </div>
          </dl>

          <div className="evidenceBlock reviewEvidence">
            <div className="evidenceBlockHeader">
              <strong>Evidence text</strong>
              <button onClick={() => onJumpToEvidence(selectedRecord.id)}>Jump to evidence</button>
            </div>
            <p>{selectedRecord.evidenceText}</p>
          </div>

          <div className="reviewActions">
            <button
              className={selectedDecision === "good" ? "selected good" : "good"}
              disabled={savingReviewRecordId === selectedRecord.id}
              onClick={() => void markSelectedRecord("good", true)}
            >
              Looks good
            </button>
            <button
              className={selectedDecision === "flagged" ? "selected flagged" : "flagged"}
              disabled={savingReviewRecordId === selectedRecord.id}
              onClick={() => void markSelectedRecord("flagged", true)}
            >
              Needs correction
            </button>
            <button
              className={selectedDecision === "skipped" ? "selected skipped" : "skipped"}
              disabled={savingReviewRecordId === selectedRecord.id}
              onClick={() => void markSelectedRecord("skipped", true)}
            >
              Skip
            </button>
          </div>
          {reviewSaveError ? <p className="reviewError">{reviewSaveError}</p> : null}

          <div className="reviewFooter">
            <button disabled={selectedRecordIndex <= 0} onClick={() => moveSelectedRecord(-1)}>
              Previous
            </button>
            <span>Shortcuts: ←/→ · G good · F flag · S skip · E evidence · Esc exit</span>
            <button disabled={selectedRecordIndex >= records.length - 1} onClick={() => moveSelectedRecord(1)}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="recordReviewToolbar">
        <div>
          <strong>{reviewCounts.reviewed} reviewed</strong>
          <span>{reviewAvailable ? `${reviewCounts.flagged} flagged` : "Review closed after export"}</span>
        </div>
        {reviewAvailable ? <button onClick={enterReviewMode}>Review names</button> : null}
      </div>
      <div className="recordReview">
        <div className="recordList" aria-label="Extracted Sanctions Delta Records">
          {records.map((record) => (
            <button
              className={`recordListItem ${record.id === selectedRecord?.id ? "selected" : ""}`}
              key={record.id}
              onClick={() => selectRecord(record.id, { jumpToEvidence: true })}
            >
              <span className="recordOrder">{record.sourceOrder}</span>
              <span className="recordNameBlock">
                <strong>{record.primaryName}</strong>
                <small>
                  {record.affectedAnnex ?? "Annex unknown"} · {record.recordType}
                </small>
              </span>
              <ReviewDecisionMarker decision={reviewDecisions[record.id]} />
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
    </>
  );
}

function ReviewDecisionMarker({ decision }: { decision: ReviewDecision | undefined }) {
  return <span className={`reviewMarker ${decision ?? "unreviewed"}`} aria-label={decision ?? "unreviewed"} />;
}

function ReviewDecisionBadge({ decision }: { decision: ReviewDecision | undefined }) {
  if (!decision) {
    return <span className="reviewDecisionBadge unreviewed">Unreviewed</span>;
  }

  const label = decision === "good" ? "Looks good" : decision === "flagged" ? "Needs correction" : "Skipped";
  return <span className={`reviewDecisionBadge ${decision}`}>{label}</span>;
}

function getReviewCounts(records: SanctionsDeltaRecord[], decisions: Record<string, ReviewDecision>) {
  const values = records.map((record) => decisions[record.id]).filter(Boolean) as ReviewDecision[];

  return {
    reviewed: values.length,
    good: values.filter((decision) => decision === "good").length,
    flagged: values.filter((decision) => decision === "flagged").length,
    skipped: values.filter((decision) => decision === "skipped").length
  };
}

function buildReviewDecisionMap(recordReviews: SanctionsDeltaRecordReview[]): Record<string, ReviewDecision> {
  return Object.fromEntries(recordReviews.map((review) => [review.recordId, review.decision]));
}

function ExtractionPanel({
  extraction,
  correctionActions,
  gate,
  isMarkingComplete,
  markCompleteComment,
  onMarkComplete,
  onMarkCompleteCommentChange
}: {
  extraction: ExtractionResult | undefined;
  correctionActions: ExtractionCorrectionAction[];
  gate: CompleteExtractionGateResult | null;
  isMarkingComplete: boolean;
  markCompleteComment: string;
  onMarkComplete: () => void;
  onMarkCompleteCommentChange: (value: string) => void;
}) {
  const canMarkComplete =
    Boolean(extraction) &&
    Boolean(gate?.checks.some((check) => check.id === "complete-extraction-confirmed" && !check.passed)) &&
    gate?.blockers.length === 1 &&
    Boolean(gate.blockers[0]?.includes("incomplete") || gate.blockers[0]?.includes("not mark"));
  const completionCheck = gate?.checks.find((check) => check.id === "complete-extraction-confirmed");

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
        {gate?.checks.length ? (
          gate.checks.map((check) => (
            <li className={check.passed ? "done" : "blocked"} key={check.id}>
              <strong>{check.label}</strong>
              <span>{check.passed ? "Passed" : check.message}</span>
            </li>
          ))
        ) : gate?.ready ? (
          <li className="done">
            <strong>Complete Extraction</strong>
            <span>Ready for Candidate Legal Act export evaluation.</span>
          </li>
        ) : gate ? (
          gate.blockers.map((blocker) => (
            <li className="blocked" key={blocker}>
              <strong>Blocked</strong>
              <span>{blocker}</span>
            </li>
          ))
        ) : (
          <li className="blocked">
            <strong>Loading</strong>
            <span>Candidate Legal Act detail is loading.</span>
          </li>
        )}
      </ul>
      {canMarkComplete ? (
        <div className="markCompleteBox">
          <p>
            {completionCheck?.message ??
              "The extracted records pass field checks, but the extractor did not confirm full Annex coverage."}
          </p>
          <label htmlFor="mark-complete-comment">Reviewer note</label>
          <textarea
            id="mark-complete-comment"
            rows={3}
            value={markCompleteComment}
            onChange={(event) => onMarkCompleteCommentChange(event.target.value)}
            placeholder="Verified the official Annex count and extracted records."
          />
          <button disabled={isMarkingComplete} onClick={onMarkComplete}>
            {isMarkingComplete ? "Marking..." : "Mark complete"}
          </button>
        </div>
      ) : null}
      <div className="correctionStrip">
        <span>Extraction Correction</span>
        <strong>{correctionActions.length}</strong>
      </div>
    </div>
  );
}

function CorrectionHistory({
  candidate,
  correctionActions,
  gate
}: {
  candidate: CandidateLegalAct | null;
  correctionActions: ExtractionCorrectionAction[];
  gate: CompleteExtractionGateResult | null;
}) {
  if (correctionActions.length === 0) {
    return (
      <div className="correctionEmpty">
        <div>
          <h3>No correction actions recorded</h3>
          <p>
            {candidate?.status === "EXPORTED"
              ? "This legal act is already exported and no manual extraction corrections were recorded for it."
              : gate?.ready
                ? "The extracted records currently pass the complete-extraction gate without manual corrections."
                : "If extraction issues are found, correction actions will appear here."}
          </p>
        </div>
        <span className={`status ${gate?.ready ? "extracted_complete" : "needs_extraction_correction"}`}>
          {gate?.ready ? "No correction needed" : "Correction may be needed"}
        </span>
      </div>
    );
  }

  return (
    <div className="correctionList">
      {correctionActions.map((action) => (
        <div className="correctionItem" key={action.id}>
          <div>
            <strong>{formatStatus(action.actionType)}</strong>
            <span>{formatDateTime(action.occurredAt)}</span>
          </div>
          <p>{action.comment ?? action.evidenceText ?? "Extraction completeness was confirmed by analyst review."}</p>
          <small>
            {action.actor}
            {action.sourceLocation ? ` · ${action.sourceLocation}` : ""}
          </small>
        </div>
      ))}
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
