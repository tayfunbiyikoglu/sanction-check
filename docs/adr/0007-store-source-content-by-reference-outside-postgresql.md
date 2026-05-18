# Store source content by reference outside PostgreSQL

Official source content is stored outside the main PostgreSQL relational tables, with PostgreSQL retaining immutable references, hashes, metadata, and retrieval audit. The local MVP can use filesystem storage and later move to object storage; this avoids bloating relational backups while preserving reproducibility and source traceability.
