# Map export batches to sanctions upload CSV

The system creates immutable export batches from complete candidate legal acts, then maps each batch to the downstream sanctions upload CSV schema.

Audit metadata remains outside the CSV columns: source content references, evidence text, sanctions delta records, extraction snapshot hashes, file hashes, export batch records, record links, and download events remain the audit trail. This keeps the exported file aligned with downstream review tooling without weakening source-backed controls.

This supersedes ADR-0005 for CSV shape. The retained decision from ADR-0005 is that export batches stay source-backed and reviewable; the changed decision is that the downloadable CSV is no longer an audit intermediate format.
