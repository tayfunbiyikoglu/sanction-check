# Export complete candidate legal acts as immutable batches

The system exports sanctions delta records one candidate legal act at a time: an export batch contains all records extracted from that legal act after extraction is complete, and partial record selection is not allowed. This gives audit owners a complete representation of the official act in each CSV; if corrections are needed after export, the system creates a new immutable re-export batch rather than mutating or cancelling the previous batch.
