# Store search responses by immutable reference

EUR-Lex search responses are audit artifacts for monitor runs, not Source Content for extraction. The system stores raw search responses outside PostgreSQL by immutable reference and hash, with PostgreSQL retaining query metadata and references, so monitor behavior is reproducible without bloating relational audit tables or confusing search responses with Evidence Text.
