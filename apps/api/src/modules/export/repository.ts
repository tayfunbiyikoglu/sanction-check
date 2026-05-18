import type { ExportBatch, ExportBatchRecord, ExportDownloadEvent } from "@sanctions/domain";
import type { Pool } from "pg";

export interface ExportRepository {
  listExportBatches(): Promise<ExportBatch[]>;
  listExportBatchRecords(): Promise<ExportBatchRecord[]>;
  listExportDownloadEvents(): Promise<ExportDownloadEvent[]>;
  getExportBatch(id: string): Promise<ExportBatch | undefined>;
  getExportBatchCsv(id: string): Promise<string | undefined>;
  saveExportBatch(input: { batch: ExportBatch; recordLinks: ExportBatchRecord[]; csv: string }): Promise<void>;
  saveExportDownload(event: ExportDownloadEvent): Promise<void>;
}

export class PostgresExportRepository implements ExportRepository {
  constructor(private readonly pool: Pool) {}

  async listExportBatches(): Promise<ExportBatch[]> {
    const result = await this.pool.query<ExportBatchRow>(
      `select *
       from export_batch
       order by created_at asc, id asc`
    );

    return result.rows.map(mapExportBatch);
  }

  async listExportBatchRecords(): Promise<ExportBatchRecord[]> {
    const result = await this.pool.query<ExportBatchRecordRow>(
      `select export_batch_id, record_id
       from export_batch_record
       order by export_batch_id asc, record_id asc`
    );

    return result.rows.map(mapExportBatchRecord);
  }

  async listExportDownloadEvents(): Promise<ExportDownloadEvent[]> {
    const result = await this.pool.query<ExportDownloadRow>(
      `select *
       from export_download
       order by downloaded_at asc, id asc`
    );

    return result.rows.map(mapExportDownloadEvent);
  }

  async getExportBatch(id: string): Promise<ExportBatch | undefined> {
    const result = await this.pool.query<ExportBatchRow>("select * from export_batch where id = $1", [id]);
    return result.rows[0] ? mapExportBatch(result.rows[0]) : undefined;
  }

  async getExportBatchCsv(id: string): Promise<string | undefined> {
    const result = await this.pool.query<{ csv_content: string }>(
      "select csv_content from export_batch_file where export_batch_id = $1",
      [id]
    );

    return result.rows[0]?.csv_content;
  }

  async saveExportBatch(input: { batch: ExportBatch; recordLinks: ExportBatchRecord[]; csv: string }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await client.query(
        `insert into export_batch (
           id, candidate_id, created_at, created_by, status, file_name, file_hash,
           extraction_snapshot_hash, record_count, reexport_of_batch_id, reexport_reason
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.batch.id,
          input.batch.candidateId,
          input.batch.createdAt,
          input.batch.createdBy,
          input.batch.status,
          input.batch.fileName,
          input.batch.fileHash,
          input.batch.extractionSnapshotHash,
          input.batch.recordCount,
          input.batch.reexportOfBatchId ?? null,
          input.batch.reexportReason ?? null
        ]
      );

      for (const recordLink of input.recordLinks) {
        await client.query(
          `insert into export_batch_record (export_batch_id, record_id)
           values ($1, $2)`,
          [recordLink.exportBatchId, recordLink.recordId]
        );
      }

      await client.query(
        `insert into export_batch_file (export_batch_id, csv_content)
         values ($1, $2)`,
        [input.batch.id, input.csv]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveExportDownload(event: ExportDownloadEvent): Promise<void> {
    await this.pool.query(
      `insert into export_download (id, export_batch_id, downloaded_at, downloaded_by)
       values ($1, $2, $3, $4)`,
      [event.id, event.exportBatchId, event.downloadedAt, event.downloadedBy]
    );
  }
}

interface ExportBatchRow {
  id: string;
  candidate_id: string;
  created_at: Date;
  created_by: string;
  status: "CREATED";
  file_name: string;
  file_hash: string;
  extraction_snapshot_hash: string;
  record_count: number;
  reexport_of_batch_id: string | null;
  reexport_reason: string | null;
}

interface ExportBatchRecordRow {
  export_batch_id: string;
  record_id: string;
}

interface ExportDownloadRow {
  id: string;
  export_batch_id: string;
  downloaded_at: Date;
  downloaded_by: string;
}

function mapExportBatch(row: ExportBatchRow): ExportBatch {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    status: row.status,
    fileName: row.file_name,
    fileHash: row.file_hash,
    extractionSnapshotHash: row.extraction_snapshot_hash,
    recordCount: row.record_count,
    ...(row.reexport_of_batch_id ? { reexportOfBatchId: row.reexport_of_batch_id } : {}),
    ...(row.reexport_reason ? { reexportReason: row.reexport_reason } : {})
  };
}

function mapExportBatchRecord(row: ExportBatchRecordRow): ExportBatchRecord {
  return {
    exportBatchId: row.export_batch_id,
    recordId: row.record_id
  };
}

function mapExportDownloadEvent(row: ExportDownloadRow): ExportDownloadEvent {
  return {
    id: row.id,
    exportBatchId: row.export_batch_id,
    downloadedAt: row.downloaded_at.toISOString(),
    downloadedBy: row.downloaded_by
  };
}
