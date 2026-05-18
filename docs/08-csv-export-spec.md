# CSV Export Specification

MVP CSV export is an audit-friendly intermediate format. It preserves extracted fields, source metadata, and evidence text; it is not yet the final bank PTM upload schema.

## Export Rule
Export happens per candidate legal act. Once extraction is complete, all sanctions delta records for that candidate legal act are exported together as one audit CSV batch.

Partial export is not allowed in MVP. If extraction is incomplete or uncertain, the candidate legal act waits for extraction correction before export.

## Suggested CSV Columns

```csv
record_type,action_type,primary_name,aliases,date_of_birth,place_of_birth,nationality,identifiers,address,function_or_role,grounds,affected_annex,detected_base_act,source_order,source_location,source_celex_id,source_publication_date,source_title,source_url,evidence_text,export_batch_id
```

## Column Notes

- `record_type`: PERSON / ENTITY
- `action_type`: ADD / AMEND / REMOVE / REPLACE
- `aliases`: pipe-separated or JSON string depending on target system need
- `identifiers`: pipe-separated or JSON string depending on target system need
- `evidence_text`: included in MVP audit exports
- `affected_annex`: Annex heading or identifier when available
- `detected_base_act`: detected configured base act or regime reference when available
- `source_order`: order in which the listed-entry change appears in the candidate legal act
- `source_location`: source row, section, or fragment location when available

## File Naming

```text
sanctions_delta_YYYYMMDD_HHMMSS_export_<batch_id>.csv
```

## Export Controls

- Generate immutable export batch record.
- Store file hash.
- Store an extraction snapshot hash for the exportable record content.
- Link every exported record for the candidate legal act to the export batch.
- Prevent accidental duplicate export unless user explicitly chooses re-export of the whole candidate legal act.
- Re-export requires a reason, creates a new export batch, and never mutates or replaces a previous batch.
- If reprocessing changes the complete extraction after export, the candidate legal act becomes re-export required.
- Export batches are not cancelled; corrections are handled through re-export.
- Record download events separately from export batch creation.
- Keep exported records visible for audit.

## Extraction Snapshot Hash

The extraction snapshot hash should include stable export-relevant content:

- Candidate legal act identity
- Working language
- Parser or extraction version
- Ordered exported records
- Each record's action type, record type, extracted fields, affected Annex, source metadata, and evidence text or source location

The hash should exclude operational metadata such as download events, UI notes, unrelated timestamps, and CSV file name.

CSV exports and snapshot hashes should order records by source order: affected Annex order, then source row/location order, with internal record ID only as a final deterministic tie-breaker.
