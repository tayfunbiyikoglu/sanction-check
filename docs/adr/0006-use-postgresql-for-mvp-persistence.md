# Use PostgreSQL for MVP persistence

The MVP uses PostgreSQL for persistence rather than starting with SQLite or an in-memory prototype store. PostgreSQL fits the expected audit trail, JSON metadata, immutable export batches, and eventual job concurrency needs; choosing it upfront adds some setup cost but avoids migration churn once the extraction and export workflow becomes operational.
