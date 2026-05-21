# CSV Export Specification

MVP CSV export uses the sanctions upload schema expected by downstream review tooling. Audit metadata is retained in export batch records, source records, hashes, and download events rather than in the CSV columns.

## Export Rule
Export happens per candidate legal act. Once extraction is complete, all sanctions delta records for that candidate legal act are exported together as one audit CSV batch.

Partial export is not allowed in MVP. If extraction is incomplete or uncertain, the candidate legal act waits for extraction correction before export.

## CSV Columns

```csv
COUNTRYOFORIGIN,ENTRYDATE,FIRSTNAME,GENDER,ID,ISDELETED,JUSTIFICATION,LEGALSTATUS,NAME,YEAR
```

## Column Notes

- `COUNTRYOFORIGIN`: emitted as an empty column when the source does not provide a mapped value.
- `ENTRYDATE`: listing date from the extracted record when present, otherwise source publication date, formatted as `YYYY-MM-DD`.
- `FIRSTNAME`: for natural persons, all personal-name tokens before the final surname token.
- `GENDER`: `MALE` / `FEMALE` for natural persons, using source gender when available and a deterministic name heuristic otherwise; `NONE` for legal entities.
- `ID`: generated per export row as `YYYYMMDD0001`, using the export batch creation date and a one-based row counter.
- `ISDELETED`: always `FALSE`.
- `JUSTIFICATION`: emitted as an empty column.
- `LEGALSTATUS`: `NATURAL_PERSON` for person records and `LEGAL_ENTITY` for entity records.
- `NAME`: surname in uppercase for natural persons; full entity name for legal entities.
- `YEAR`: emitted as an empty column.

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
