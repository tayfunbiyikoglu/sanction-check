# Export audit intermediate CSV before PTM-specific mapping

Superseded for CSV shape by ADR-0011. The retained part of this decision is that export batches must stay source-backed and reviewable.

The MVP exports an audit-friendly intermediate CSV that preserves extracted sanctions delta fields, source metadata, source order, and evidence text instead of trying to match the bank's final PTM upload schema. This delays strict downstream integration work, but keeps source fidelity high while the exact upload requirements, code mappings, and field constraints are still unknown.
