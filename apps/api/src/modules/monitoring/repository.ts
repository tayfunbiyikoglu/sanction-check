import { createHash } from "node:crypto";
import type {
  CandidateLegalAct,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorRun,
  SanctionsDeltaRecord,
  SanctionsDeltaRecordReview,
  WatchQuery
} from "@sanctions/domain";
import { normalizeLegalActIdentityInput } from "@sanctions/domain";
import type { Pool, PoolClient } from "pg";
import type { DiscoveryTrigger, ExecuteMonitorRunInput, ExecuteMonitorRunResult } from "./service.js";
import {
  buildMonitorRun,
  mergeDiscoveryTrigger as mergeDiscoveryTriggerCore
} from "./discovery.js";

export interface MonitoringRepository {
  listCandidates(): Promise<CandidateLegalAct[]>;
  getCandidate(id: string): Promise<CandidateLegalAct | undefined>;
  updateCandidate(candidate: CandidateLegalAct): Promise<CandidateLegalAct>;
  listMonitorRuns(): Promise<MonitorRun[]>;
  listExtractionResults(candidateId: string): Promise<ExtractionResult[]>;
  listSanctionsDeltaRecords(candidateId: string): Promise<SanctionsDeltaRecord[]>;
  listRecordReviews(candidateId: string): Promise<SanctionsDeltaRecordReview[]>;
  upsertRecordReview(review: SanctionsDeltaRecordReview): Promise<SanctionsDeltaRecordReview>;
  listCorrectionActions(candidateId: string): Promise<ExtractionCorrectionAction[]>;
  markLatestExtractionComplete(input: {
    candidate: CandidateLegalAct;
    extractionResult: ExtractionResult;
    actor: string;
    occurredAt: string;
    comment?: string;
  }): Promise<ExtractionCorrectionAction>;
  saveExtractionResult(input: {
    candidate: CandidateLegalAct;
    extractionResult: ExtractionResult;
    records: SanctionsDeltaRecord[];
  }): Promise<void>;
  executeMonitorRun(input: ExecuteMonitorRunInput): Promise<ExecuteMonitorRunResult>;
}

interface DiscoveryTriggerRecord {
  trigger: DiscoveryTrigger;
  candidate?: CandidateLegalAct;
  status: "CANDIDATE_CREATED" | "CANDIDATE_REFRESHED" | "MALFORMED";
  errorMessage?: string;
}

let monitorRunSequence = 1;
let discoveryTriggerSequence = 1;

export class PostgresMonitoringRepository implements MonitoringRepository {
  constructor(private readonly pool: Pool) {}

  async listCandidates(): Promise<CandidateLegalAct[]> {
    const result = await this.pool.query<CandidateRow>(
      `select *
       from legal_act_candidate
       order by detected_at desc, id asc`
    );

    return result.rows.map(mapCandidate);
  }

  async listMonitorRuns(): Promise<MonitorRun[]> {
    const result = await this.pool.query<MonitorRunRow>(
      `select *
       from monitor_run
       order by started_at desc, id desc`
    );

    return result.rows.map(mapMonitorRun);
  }

  async getCandidate(id: string): Promise<CandidateLegalAct | undefined> {
    const result = await this.pool.query<CandidateRow>("select * from legal_act_candidate where id = $1", [id]);
    return result.rows[0] ? mapCandidate(result.rows[0]) : undefined;
  }

  async updateCandidate(candidate: CandidateLegalAct): Promise<CandidateLegalAct> {
    await updateCandidate(this.pool, candidate);
    return candidate;
  }

  async listExtractionResults(candidateId: string): Promise<ExtractionResult[]> {
    const result = await this.pool.query<ExtractionResultRow>(
      `select *
       from extraction_result
       where candidate_id = $1
       order by created_at asc, id asc`,
      [candidateId]
    );

    return result.rows.map(mapExtractionResult);
  }

  async listSanctionsDeltaRecords(candidateId: string): Promise<SanctionsDeltaRecord[]> {
    const result = await this.pool.query<SanctionsDeltaRecordRow>(
      `select sdr.*
       from sanction_delta_record sdr
       join extraction_result er on er.id = sdr.extraction_result_id
       where sdr.candidate_id = $1
         and er.id = (
           select id
           from extraction_result
           where candidate_id = $1
           order by created_at desc, id desc
           limit 1
         )
       order by source_order asc, id asc`,
      [candidateId]
    );

    return result.rows.map(mapSanctionsDeltaRecord);
  }

  async listRecordReviews(candidateId: string): Promise<SanctionsDeltaRecordReview[]> {
    const result = await this.pool.query<RecordReviewRow>(
      `select rr.*
       from record_review rr
       join sanction_delta_record sdr on sdr.id = rr.record_id
       join extraction_result er on er.id = sdr.extraction_result_id
       where rr.candidate_id = $1
         and er.id = (
           select id
           from extraction_result
           where candidate_id = $1
           order by created_at desc, id desc
           limit 1
         )
       order by rr.reviewed_at asc, rr.record_id asc`,
      [candidateId]
    );

    return result.rows.map(mapRecordReview);
  }

  async upsertRecordReview(review: SanctionsDeltaRecordReview): Promise<SanctionsDeltaRecordReview> {
    await this.pool.query(
      `insert into record_review (record_id, candidate_id, decision, actor, reviewed_at, comment)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (record_id) do update
       set decision = excluded.decision,
           actor = excluded.actor,
           reviewed_at = excluded.reviewed_at,
           comment = excluded.comment`,
      [
        review.recordId,
        review.candidateId,
        review.decision,
        review.actor,
        review.reviewedAt,
        review.comment ?? null
      ]
    );

    return review;
  }

  async listCorrectionActions(candidateId: string): Promise<ExtractionCorrectionAction[]> {
    const result = await this.pool.query<CorrectionActionRow>(
      `select *
       from correction_action
       where candidate_id = $1
       order by action_at asc, id asc`,
      [candidateId]
    );

    return result.rows.map(mapCorrectionAction);
  }

  async markLatestExtractionComplete(input: {
    candidate: CandidateLegalAct;
    extractionResult: ExtractionResult;
    actor: string;
    occurredAt: string;
    comment?: string;
  }): Promise<ExtractionCorrectionAction> {
    const client = await this.pool.connect();
    const correctionAction: ExtractionCorrectionAction = {
      id: `correction-action-${input.extractionResult.id}-mark-complete`,
      candidateId: input.candidate.id,
      actionType: "MARK_EXTRACTION_COMPLETE",
      actor: input.actor,
      occurredAt: input.occurredAt,
      beforeValues: { isComplete: input.extractionResult.isComplete, status: input.candidate.status },
      afterValues: { isComplete: true, status: "EXTRACTED_COMPLETE" },
      ...(input.comment ? { comment: input.comment } : {})
    };

    try {
      await client.query("begin");
      await client.query("update extraction_result set is_complete = true where id = $1", [input.extractionResult.id]);
      await client.query("update legal_act_candidate set status = $2 where id = $1", [
        input.candidate.id,
        "EXTRACTED_COMPLETE"
      ]);
      await client.query(
        `insert into correction_action (
           id, candidate_id, record_id, action, actor, action_at, before_value, after_value, comment
         ) values ($1, $2, null, 'MARK_EXTRACTION_COMPLETE', $3, $4, $5, $6, $7)`,
        [
          correctionAction.id,
          correctionAction.candidateId,
          correctionAction.actor,
          correctionAction.occurredAt,
          JSON.stringify(correctionAction.beforeValues),
          JSON.stringify(correctionAction.afterValues),
          correctionAction.comment ?? null
        ]
      );
      await client.query("commit");
      return correctionAction;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveExtractionResult(input: {
    candidate: CandidateLegalAct;
    extractionResult: ExtractionResult;
    records: SanctionsDeltaRecord[];
  }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await updateCandidate(client, input.candidate);
      await insertExtractionResult(client, input.extractionResult, input.candidate);

      for (const record of input.records) {
        await insertSanctionsDeltaRecord(client, input.extractionResult.id, record);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async executeMonitorRun(input: ExecuteMonitorRunInput): Promise<ExecuteMonitorRunResult> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");

      const watchQuery = await findActiveWatchQuery(client, input.watchQueryId);
      const startedAt = input.startedAt ?? new Date().toISOString();
      const finishedAt = input.finishedAt ?? startedAt;
      const records: DiscoveryTriggerRecord[] = [];
      const errors: string[] = [...(input.discoveryErrors ?? [])];
      let newCandidates = 0;

      for (const trigger of input.triggers) {
        const record = await mergeDiscoveryTrigger(client, trigger, watchQuery, finishedAt);
        records.push(record);

        if (record.status === "CANDIDATE_CREATED") {
          newCandidates += 1;
        }

        if (record.errorMessage) {
          errors.push(record.errorMessage);
        }
      }

      for (const error of input.discoveryErrors ?? []) {
        records.push({
          trigger: { title: "Malformed discovery trigger", rawMetadata: { error } },
          status: "MALFORMED",
          errorMessage: error
        });
      }

      const monitorRun: MonitorRun = buildMonitorRun({
        discoveryErrors: errors,
        finishedAt,
        monitorRunId: createMonitorRunId(),
        newCandidates,
        seenCandidateCount: records.filter((record) => record.candidate).length,
        startedAt,
        triggerCount: input.triggers.length,
        watchQuery,
        ...(input.itemsSeen !== undefined ? { itemsSeen: input.itemsSeen } : {}),
        ...(input.searchResponse ? { searchResponse: input.searchResponse } : {})
      });

      await insertMonitorRun(client, monitorRun);

      for (const record of records) {
        await insertDiscoveryTrigger(client, monitorRun, record);
      }

      await client.query("commit");

      return {
        monitorRun,
        candidates: records.flatMap((record) => (record.candidate ? [record.candidate] : [])),
        errors
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findActiveWatchQuery(client: PoolClient, watchQueryId: string): Promise<WatchQuery> {
  const result = await client.query<WatchQueryRow>(
    `select
       wq.id,
       wq.name,
       wq.source,
       wq.query_text,
       wq.is_active,
       wq.created_at,
       coalesce(array_agg(wqba.configured_base_act_id order by wqba.configured_base_act_id)
         filter (where wqba.configured_base_act_id is not null), array[]::text[]) as configured_base_act_ids
     from watch_query wq
     left join watch_query_base_act wqba on wqba.watch_query_id = wq.id
     where wq.id = $1 and wq.is_active
     group by wq.id`,
    [watchQueryId]
  );

  if (!result.rows[0]) {
    throw new Error(`Active watch query not found: ${watchQueryId}`);
  }

  return mapWatchQuery(result.rows[0]);
}

async function mergeDiscoveryTrigger(
  client: PoolClient,
  trigger: DiscoveryTrigger,
  watchQuery: WatchQuery,
  seenAt: string
): Promise<DiscoveryTriggerRecord> {
  try {
    const normalized = normalizeLegalActIdentityInput(trigger);
    const existing = await findCandidateByAnyIdentity(client, normalized);
    const merged = mergeDiscoveryTriggerCore({
      existingCandidates: existing ? [existing] : [],
      fallbackCandidateIdSeed: Date.now(),
      seenAt,
      trigger,
      watchQuery
    });

    if (!merged.created) {
      await updateCandidate(client, merged.candidate);
      return {
        trigger,
        candidate: merged.candidate,
        status: "CANDIDATE_REFRESHED"
      };
    }

    await insertCandidate(client, merged.candidate);

    return {
      trigger,
      candidate: merged.candidate,
      status: "CANDIDATE_CREATED"
    };
  } catch (error) {
    return {
      trigger,
      status: "MALFORMED",
      errorMessage: error instanceof Error ? error.message : "Discovery trigger failed"
    };
  }
}

async function findCandidateByAnyIdentity(
  client: PoolClient,
  identityInput: ReturnType<typeof normalizeLegalActIdentityInput>
): Promise<CandidateLegalAct | undefined> {
  const result = await client.query<CandidateRow>(
    `select *
     from legal_act_candidate
     where ($1::text is not null and celex_id = $1)
        or ($2::text is not null and cellar_id = $2)
        or ($3::text is not null and official_uri = $3)
     order by
       case
         when $1::text is not null and celex_id = $1 then 1
         when $2::text is not null and cellar_id = $2 then 2
         else 3
       end
     limit 1`,
    [identityInput.celexId ?? null, identityInput.cellarId ?? null, identityInput.officialUri ?? null]
  );

  return result.rows[0] ? mapCandidate(result.rows[0]) : undefined;
}

async function insertCandidate(client: PoolClient, candidate: CandidateLegalAct): Promise<void> {
  await client.query(
    `insert into legal_act_candidate (
       id, celex_id, cellar_id, official_uri, legal_act_identity_kind, legal_act_identity_value,
       title, publication_date, source_url, rss_feed_name, detected_at, last_seen_at, status,
       working_language, raw_metadata
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '{}'::jsonb)`,
    [
      candidate.id,
      candidate.celexId ?? null,
      candidate.cellarId ?? null,
      candidate.officialUri ?? null,
      candidate.legalActIdentityKind,
      candidate.legalActIdentityValue,
      candidate.title,
      candidate.publicationDate ?? null,
      candidate.sourceUrl ?? null,
      candidate.rssFeedName ?? null,
      candidate.detectedAt,
      candidate.lastSeenAt,
      candidate.status,
      candidate.workingLanguage
    ]
  );
}

async function updateCandidate(db: Pick<Pool | PoolClient, "query">, candidate: CandidateLegalAct): Promise<void> {
  await db.query(
    `update legal_act_candidate
     set celex_id = $2,
         cellar_id = $3,
         official_uri = $4,
         legal_act_identity_kind = $5,
         legal_act_identity_value = $6,
         title = $7,
         publication_date = $8,
         source_url = $9,
         rss_feed_name = $10,
         last_seen_at = $11,
         status = $12,
         raw_content_ref = $13,
         content_hash = $14,
         content_type = $15,
         source_content_length = $16,
         source_content_uri = $17,
         retrieved_at = $18,
         retrieval_status = $19,
         retrieval_attempts = $20,
         retrieval_last_attempt_at = $21,
         retrieval_next_retry_at = $22,
         source_content_changed = $23,
         previous_source_content_hash = $24,
         retrieval_failure_code = $25,
         retrieval_failure_message = $26,
         available_languages = $27,
         working_language = $28
     where id = $1`,
    [
      candidate.id,
      candidate.celexId ?? null,
      candidate.cellarId ?? null,
      candidate.officialUri ?? null,
      candidate.legalActIdentityKind,
      candidate.legalActIdentityValue,
      candidate.title,
      candidate.publicationDate ?? null,
      candidate.sourceUrl ?? null,
      candidate.rssFeedName ?? null,
      candidate.lastSeenAt,
      candidate.status,
      candidate.sourceContent?.reference ?? null,
      candidate.sourceContent?.contentHash ?? null,
      candidate.sourceContent?.contentType ?? null,
      candidate.sourceContent?.contentLength ?? null,
      candidate.sourceContent?.sourceUri ?? null,
      candidate.sourceContent?.retrievedAt ?? null,
      candidate.retrieval?.status ?? "NOT_REQUESTED",
      candidate.retrieval?.attempts ?? 0,
      candidate.retrieval?.lastAttemptAt ?? null,
      candidate.retrieval?.nextRetryAt ?? null,
      candidate.retrieval?.sourceContentChanged ?? false,
      candidate.retrieval?.previousSourceContentHash ?? null,
      candidate.retrieval?.failureCode ?? null,
      candidate.retrieval?.failureMessage ?? null,
      JSON.stringify(candidate.retrieval?.availableLanguages ?? []),
      candidate.workingLanguage
    ]
  );
}

async function insertExtractionResult(
  client: PoolClient,
  extractionResult: ExtractionResult,
  candidate: CandidateLegalAct
): Promise<void> {
  await client.query(
    `insert into extraction_result (
       id, candidate_id, parser_version, classification, confidence, annex_found,
       annex_heading, is_complete, evidence_text, source_content_ref, source_content_hash, created_at,
       ai_call_metadata
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      extractionResult.id,
      extractionResult.candidateId,
      extractionResult.parserVersion,
      extractionResult.classification,
      extractionResult.confidence,
      extractionResult.annexFound,
      extractionResult.annexHeading ?? null,
      extractionResult.isComplete,
      extractionResult.evidenceText ?? null,
      candidate.sourceContent?.reference ?? null,
      candidate.sourceContent?.contentHash ?? null,
      extractionResult.createdAt,
      extractionResult.aiCall ? JSON.stringify(extractionResult.aiCall) : null
    ]
  );
}

async function insertSanctionsDeltaRecord(
  client: PoolClient,
  extractionResultId: string,
  record: SanctionsDeltaRecord
): Promise<void> {
  await client.query(
    `insert into sanction_delta_record (
       id, extraction_result_id, candidate_id, record_type, action_type, primary_name,
       listed_entry, affected_annex, detected_base_act, source_order, source_location,
       evidence_text, confidence
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      record.id,
      extractionResultId,
      record.candidateId,
      record.recordType,
      record.actionType,
      record.primaryName,
      JSON.stringify(record.listedEntry ?? {}),
      record.affectedAnnex ?? null,
      record.detectedBaseAct ?? null,
      record.sourceOrder,
      record.sourceLocation ?? null,
      record.evidenceText,
      record.confidence
    ]
  );
}

async function insertMonitorRun(client: PoolClient, monitorRun: MonitorRun): Promise<void> {
  await client.query(
    `insert into monitor_run (
       id, started_at, finished_at, status, source, watch_query_id, query_snapshot,
       items_seen, new_candidates, search_response_ref, search_response_hash,
       search_response_length, search_response_content_type, search_response_source_uri,
       search_response_retrieved_at, error_message
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      monitorRun.id,
      monitorRun.startedAt,
      monitorRun.finishedAt ?? null,
      monitorRun.status,
      monitorRun.source,
      monitorRun.watchQueryId,
      monitorRun.querySnapshot,
      monitorRun.itemsSeen,
      monitorRun.newCandidates,
      monitorRun.searchResponse?.reference ?? null,
      monitorRun.searchResponse?.contentHash ?? null,
      monitorRun.searchResponse?.contentLength ?? null,
      monitorRun.searchResponse?.contentType ?? null,
      monitorRun.searchResponse?.sourceUri ?? null,
      monitorRun.searchResponse?.retrievedAt ?? null,
      monitorRun.errorMessage ?? null
    ]
  );
}

async function insertDiscoveryTrigger(
  client: PoolClient,
  monitorRun: MonitorRun,
  record: DiscoveryTriggerRecord
): Promise<void> {
  await client.query(
    `insert into discovery_trigger (
       id, monitor_run_id, source, source_item_id, source_item_hash, celex_id, cellar_id,
       official_uri, title, publication_date, trigger_url, candidate_id, status,
       error_message, raw_metadata
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      createDiscoveryTriggerId(),
      monitorRun.id,
      monitorRun.source,
      record.trigger.sourceItemId ?? null,
      record.trigger.sourceItemHash ?? createTriggerHash(record.trigger),
      record.trigger.celexId ?? null,
      record.trigger.cellarId ?? null,
      record.trigger.officialUri ?? null,
      record.trigger.title ?? null,
      record.trigger.publicationDate ?? null,
      record.trigger.sourceUrl ?? null,
      record.candidate?.id ?? null,
      record.status,
      record.errorMessage ?? null,
      JSON.stringify(record.trigger.rawMetadata ?? record.trigger)
    ]
  );
}

function createMonitorRunId(): string {
  const timestamp = String(Date.now()).padStart(13, "0");
  const sequence = String(monitorRunSequence++).padStart(4, "0");
  return `monitor-run-${timestamp}-${sequence}`;
}

function createDiscoveryTriggerId(): string {
  const timestamp = String(Date.now()).padStart(13, "0");
  const sequence = String(discoveryTriggerSequence++).padStart(4, "0");
  return `discovery-trigger-${timestamp}-${sequence}`;
}

interface CandidateRow {
  id: string;
  celex_id: string | null;
  cellar_id: string | null;
  official_uri: string | null;
  legal_act_identity_kind: "CELEX" | "CELLAR" | "OFFICIAL_URI";
  legal_act_identity_value: string;
  title: string;
  publication_date: Date | string | null;
  source_url: string | null;
  rss_feed_name: string | null;
  detected_at: Date;
  last_seen_at: Date;
  status: CandidateLegalAct["status"];
  working_language: "en";
  raw_content_ref: string | null;
  content_hash: string | null;
  content_type: "application/xml" | "text/html" | "text/plain" | null;
  source_content_length: number | null;
  source_content_uri: string | null;
  retrieved_at: Date | null;
  retrieval_status: NonNullable<CandidateLegalAct["retrieval"]>["status"];
  retrieval_attempts: number;
  retrieval_last_attempt_at: Date | null;
  retrieval_next_retry_at: Date | null;
  source_content_changed: boolean;
  previous_source_content_hash: string | null;
  retrieval_failure_code: string | null;
  retrieval_failure_message: string | null;
  available_languages: string[] | null;
}

interface MonitorRunRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: MonitorRun["status"];
  source: MonitorRun["source"];
  watch_query_id: string;
  query_snapshot: string;
  items_seen: number;
  new_candidates: number;
  search_response_ref: string | null;
  search_response_hash: string | null;
  search_response_length: number | null;
  search_response_content_type: "application/xml" | null;
  search_response_source_uri: string | null;
  search_response_retrieved_at: Date | null;
  error_message: string | null;
}

interface WatchQueryRow {
  id: string;
  name: string;
  source: "RSS" | "EURLEX_WS";
  query_text: string;
  is_active: boolean;
  created_at: Date;
  configured_base_act_ids: string[];
}

interface ExtractionResultRow {
  id: string;
  candidate_id: string;
  parser_version: string;
  classification: ExtractionResult["classification"];
  confidence: string | number;
  annex_found: boolean;
  annex_heading: string | null;
  is_complete: boolean;
  evidence_text: string | null;
  ai_call_metadata: ExtractionResult["aiCall"] | null;
  created_at: Date;
}

interface SanctionsDeltaRecordRow {
  id: string;
  candidate_id: string;
  record_type: SanctionsDeltaRecord["recordType"];
  action_type: SanctionsDeltaRecord["actionType"];
  primary_name: string;
  listed_entry: Record<string, string | string[]> | null;
  affected_annex: string | null;
  detected_base_act: string | null;
  source_order: number;
  source_location: string | null;
  evidence_text: string;
  confidence: string | number;
}

interface RecordReviewRow {
  candidate_id: string;
  record_id: string;
  decision: SanctionsDeltaRecordReview["decision"];
  actor: string;
  reviewed_at: Date;
  comment: string | null;
}

interface CorrectionActionRow {
  id: string;
  candidate_id: string;
  record_id: string | null;
  action: "CORRECT_FIELD" | "ADD_RECORD" | "MARK_EXTRACTION_COMPLETE" | "COMMENT";
  actor: string;
  action_at: Date;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  comment: string | null;
}

function mapCandidate(row: CandidateRow): CandidateLegalAct {
  return {
    id: row.id,
    ...(row.celex_id ? { celexId: row.celex_id } : {}),
    ...(row.cellar_id ? { cellarId: row.cellar_id } : {}),
    ...(row.official_uri ? { officialUri: row.official_uri } : {}),
    legalActIdentityKind: row.legal_act_identity_kind,
    legalActIdentityValue: row.legal_act_identity_value,
    title: row.title,
    ...(row.publication_date ? { publicationDate: formatDateOnly(row.publication_date) } : {}),
    status: row.status,
    workingLanguage: row.working_language,
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.rss_feed_name ? { rssFeedName: row.rss_feed_name } : {}),
    detectedAt: row.detected_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    ...(row.raw_content_ref &&
    row.content_hash &&
    row.content_type &&
    row.source_content_length !== null &&
    row.source_content_uri &&
    row.retrieved_at
      ? {
          sourceContent: {
            reference: row.raw_content_ref,
            contentHash: row.content_hash,
            contentLength: row.source_content_length,
            contentType: row.content_type,
            language: "en",
            sourceUri: row.source_content_uri,
            retrievedAt: row.retrieved_at.toISOString()
          }
        }
      : {}),
    retrieval: {
      status: row.retrieval_status,
      attempts: row.retrieval_attempts,
      ...(row.retrieval_last_attempt_at ? { lastAttemptAt: row.retrieval_last_attempt_at.toISOString() } : {}),
      ...(row.retrieval_next_retry_at ? { nextRetryAt: row.retrieval_next_retry_at.toISOString() } : {}),
      ...(row.available_languages ? { availableLanguages: row.available_languages } : {}),
      ...(row.source_content_changed ? { sourceContentChanged: true } : {}),
      ...(row.previous_source_content_hash ? { previousSourceContentHash: row.previous_source_content_hash } : {}),
      ...(row.retrieval_failure_code ? { failureCode: row.retrieval_failure_code } : {}),
      ...(row.retrieval_failure_message ? { failureMessage: row.retrieval_failure_message } : {})
    }
  };
}

function mapMonitorRun(row: MonitorRunRow): MonitorRun {
  return {
    id: row.id,
    startedAt: row.started_at.toISOString(),
    ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}),
    status: row.status,
    source: row.source,
    watchQueryId: row.watch_query_id,
    querySnapshot: row.query_snapshot,
    itemsSeen: row.items_seen,
    newCandidates: row.new_candidates,
    ...(row.search_response_ref &&
    row.search_response_hash &&
    row.search_response_length !== null &&
    row.search_response_content_type &&
    row.search_response_source_uri &&
    row.search_response_retrieved_at
      ? {
          searchResponse: {
            reference: row.search_response_ref,
            contentHash: row.search_response_hash,
            contentLength: row.search_response_length,
            contentType: row.search_response_content_type,
            sourceUri: row.search_response_source_uri,
            retrievedAt: row.search_response_retrieved_at.toISOString()
          }
        }
      : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {})
  };
}

function mapWatchQuery(row: WatchQueryRow): WatchQuery {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    queryText: row.query_text,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    configuredBaseActIds: row.configured_base_act_ids
  };
}

function mapExtractionResult(row: ExtractionResultRow): ExtractionResult {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    parserVersion: row.parser_version,
    classification: row.classification,
    confidence: Number(row.confidence),
    annexFound: row.annex_found,
    ...(row.annex_heading ? { annexHeading: row.annex_heading } : {}),
    isComplete: row.is_complete,
    ...(row.evidence_text ? { evidenceText: row.evidence_text } : {}),
    ...(row.ai_call_metadata ? { aiCall: row.ai_call_metadata } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function mapSanctionsDeltaRecord(row: SanctionsDeltaRecordRow): SanctionsDeltaRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    recordType: row.record_type,
    actionType: row.action_type,
    primaryName: row.primary_name,
    ...(row.listed_entry ? { listedEntry: row.listed_entry } : {}),
    ...(row.affected_annex ? { affectedAnnex: row.affected_annex } : {}),
    ...(row.detected_base_act ? { detectedBaseAct: row.detected_base_act } : {}),
    sourceOrder: row.source_order,
    ...(row.source_location ? { sourceLocation: row.source_location } : {}),
    evidenceText: row.evidence_text,
    confidence: Number(row.confidence)
  };
}

function mapRecordReview(row: RecordReviewRow): SanctionsDeltaRecordReview {
  return {
    candidateId: row.candidate_id,
    recordId: row.record_id,
    decision: row.decision,
    actor: row.actor,
    reviewedAt: row.reviewed_at.toISOString(),
    ...(row.comment ? { comment: row.comment } : {})
  };
}

function mapCorrectionAction(row: CorrectionActionRow): ExtractionCorrectionAction {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    ...(row.record_id ? { recordId: row.record_id } : {}),
    actionType: mapCorrectionActionType(row.action),
    actor: row.actor,
    occurredAt: row.action_at.toISOString(),
    beforeValues: row.before_value ?? {},
    afterValues: row.after_value ?? {},
    ...(row.comment ? { comment: row.comment } : {})
  };
}

function mapCorrectionActionType(action: CorrectionActionRow["action"]): ExtractionCorrectionAction["actionType"] {
  if (action === "CORRECT_FIELD") {
    return "FIELD_CORRECTION";
  }

  if (action === "ADD_RECORD") {
    return "MISSED_RECORD_ADDITION";
  }

  return "MARK_EXTRACTION_COMPLETE";
}

function formatDateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function createTriggerHash(trigger: DiscoveryTrigger): string {
  return createHash("sha256").update(JSON.stringify(trigger)).digest("hex");
}
