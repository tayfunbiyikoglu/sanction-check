Status: completed

# Export One Immutable Audit CSV Batch Per Complete Candidate

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Generate one immutable audit CSV export batch for a complete candidate legal act. Include deterministic source-order serialization, file hash, extraction snapshot hash, export batch records, duplicate export prevention, and download audit event.

## Acceptance criteria

- [ ] Export is allowed only for complete candidate legal acts.
- [ ] CSV includes audit-friendly intermediate columns, evidence text, source order, source location, affected Annex, detected base act, source metadata, and export batch ID.
- [ ] Export batches are immutable and cannot be cancelled or mutated.
- [ ] Duplicate export is prevented unless explicit re-export is requested.
- [ ] File hash, extraction snapshot hash, export batch record links, and download events are persisted.
- [ ] Tests cover deterministic CSV output and snapshot hashing.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/06-enforce-the-complete-extraction-gate.md
