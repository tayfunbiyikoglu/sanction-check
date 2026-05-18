# Initial Data Model

## Implementation Note

The API currently uses in-memory stores for candidates, monitor runs, retrieval state, extraction results, corrections, and exports. The next implementation slice should wire these tables to PostgreSQL without changing the domain language or dashboard workflow. Once the repository boundary lands, PostgreSQL should be the default API persistence mode for local runtime; in-memory repositories should remain only for focused tests or explicit fallback.

PostgreSQL should store metadata, state, audit events, and immutable references. Official Source Content bytes and raw search/RSS responses stay outside relational tables in filesystem or object storage, with PostgreSQL retaining hashes, references, source URI, content type, language, and retrieval timestamps.

Migrations and baseline seed data should be explicit commands. API startup should validate connectivity and required baseline configuration, but should not silently create, reseed, or overwrite operational records.

Integration tests should use a dedicated PostgreSQL test database through `TEST_DATABASE_URL`, reset by migrations and truncation. Tests must not touch the local development database configured by `DATABASE_URL`.

## Table: monitor_run

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| started_at | timestamp | Run start |
| finished_at | timestamp | Run end |
| status | text | SUCCESS / PARTIAL / FAILED |
| source | text | RSS / EURLEX_WS |
| watch_query_id | uuid | FK watch_query |
| query_snapshot | text | Expert query or RSS URL used at run time |
| items_seen | int | Count |
| new_candidates | int | Count |
| error_message | text | Nullable |

## Table: discovery_trigger

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| monitor_run_id | uuid | FK monitor_run |
| source | text | RSS / EURLEX_WS |
| source_item_id | text | RSS GUID/link hash or search result ID |
| celex_id | text | Nullable |
| cellar_id | text | Nullable |
| official_uri | text | Nullable |
| title | text | Nullable |
| publication_date | date | Nullable |
| trigger_url | text | Nullable |
| candidate_id | uuid | Nullable FK legal_act_candidate |
| status | text | CANDIDATE_CREATED / CANDIDATE_REFRESHED / MALFORMED |
| error_message | text | Nullable |
| raw_metadata | jsonb | Raw trigger metadata, not Source Content |

## Table: configured_base_act

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| celex_id | text | Base act CELEX ID |
| label | text | Human-readable sanctions regime label |
| is_active | boolean | Whether monitoring is enabled |
| created_at | timestamp | Timestamp |

## Table: watch_query

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Human-readable feed/search name |
| source | text | RSS / EURLEX_WS |
| query_text | text | Expert query or RSS URL |
| is_active | boolean | Whether monitoring is enabled |
| created_at | timestamp | Timestamp |

## Table: watch_query_base_act

| Field | Type | Notes |
|---|---|---|
| watch_query_id | uuid | FK watch_query |
| configured_base_act_id | uuid | FK configured_base_act |

## Table: legal_act_candidate

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| celex_id | text | Unique when present |
| cellar_id | text | Nullable |
| title | text | Official title |
| publication_date | date | OJ/publication date |
| source_url | text | EUR-Lex URL |
| official_uri | text | Official document URI fallback identity |
| rss_feed_name | text | Trigger source |
| detected_at | timestamp | First detected |
| last_seen_at | timestamp | Last observed |
| status | text | DETECTED / CONTENT_RETRIEVED / LANGUAGE_PENDING / NO_DELTA / EXTRACTED_COMPLETE / NEEDS_EXTRACTION_CORRECTION / FAILED_RETRIEVAL / FAILED_PARSING / EXPORTED / REEXPORT_REQUIRED |
| raw_metadata | jsonb | Search/RSS metadata |
| raw_content_ref | text | Immutable source content location outside relational tables |
| content_hash | text | Dedup/versioning |
| content_type | text | Retrieved Source Content type, for example text/html or application/xml |
| source_content_language | text | Retrieved Source Content language |
| source_content_retrieved_at | timestamp | Timestamp of latest Source Content retrieval |
| working_language | text | English for MVP |

Recommended identity constraints:

- Unique candidate by CELEX ID when present.
- Unique candidate by CELLAR ID when CELEX is absent and CELLAR is present.
- Unique candidate by official URI when CELEX and CELLAR are absent.
- Preserve all discovered trigger metadata even when an existing candidate is refreshed.

Recommended identity enrichment rule:

- A Candidate Legal Act may first be created from an official URI fallback identity.
- If CELEX ID or CELLAR ID is later discovered for the same legal act, update the existing candidate with the stronger identity instead of creating a duplicate.
- Candidate upsert checks CELEX first, then CELLAR, then official URI before insert.
- If two existing candidates are later proven to be the same legal act, merge them explicitly and record an audit event; avoid automatic complex merging unless the match is exact and safe.

Recommended candidate refresh rule:

- Rediscovery updates observation metadata such as `last_seen_at`, trigger metadata, and missing or improved title/publication/source URL fields.
- Rediscovery must not reset processing state, Source Content references, retrieval history, extraction results, correction actions, export batches, or export status.

## Table: candidate_base_act_match

| Field | Type | Notes |
|---|---|---|
| candidate_id | uuid | FK legal_act_candidate |
| configured_base_act_id | uuid | FK configured_base_act |
| match_source | text | QUERY / METADATA / PARSER |
| confidence | numeric | Nullable 0-1 |
| matched_at | timestamp | Timestamp |

## Table: extraction_result

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| candidate_id | uuid | FK legal_act_candidate |
| parser_version | text | Parser version |
| source_content_hash | text | Source Content hash used by this extraction |
| source_content_ref | text | Immutable Source Content reference used by this extraction |
| classification | text | Delta/no-delta/etc. |
| confidence | numeric | 0-1 |
| annex_found | boolean | Yes/no |
| annex_heading | text | Nullable |
| is_complete | boolean | Complete extraction before export |
| evidence_text | text | Key source evidence |
| created_at | timestamp | Extraction timestamp |

Extraction results should be tied to the Source Content reference and hash used at extraction time. If later retrieval finds different Source Content, preserve existing extraction results and mark the candidate for explicit reprocessing instead of automatically overwriting classification, records, corrections, or export history.

Extraction results are append-mostly. Reprocessing creates a new extraction result and new sanctions delta records linked to that extraction result. Candidate detail may show the latest extraction by default, but older extraction results remain available for audit and parser-version history.

## Table: sanction_delta_record

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| extraction_result_id | uuid | FK extraction_result |
| record_type | text | PERSON / ENTITY |
| action_type | text | ADD / AMEND / REMOVE / REPLACE |
| primary_name | text | Required before export when present in source |
| aliases | jsonb | List |
| date_of_birth | text | Text to preserve source fidelity |
| place_of_birth | text | Nullable |
| nationality | text | Nullable |
| identifiers | jsonb | Passport/ID/reg numbers |
| address | text | Mainly entity |
| function_or_role | text | Nullable |
| grounds | text | Reasons/statement |
| affected_annex | text | Annex heading or identifier |
| detected_base_act | text | Nullable detected base act/regime |
| source_order | int | Order within the candidate legal act |
| source_location | text | Row/section/fragment location when available |
| source_celex_id | text | Source |
| source_publication_date | date | Source |
| evidence_text | text | Exact supporting text |
| confidence | numeric | 0-1 |

## Table: correction_action

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| candidate_id | uuid | FK legal_act_candidate |
| record_id | uuid | Nullable FK sanction_delta_record |
| action | text | CORRECT_FIELD / ADD_RECORD / MARK_EXTRACTION_COMPLETE / COMMENT |
| actor | text | User ID/email |
| action_at | timestamp | Timestamp |
| before_value | jsonb | Nullable |
| after_value | jsonb | Nullable |
| comment | text | Nullable |

## Table: export_batch

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| candidate_id | uuid | FK legal_act_candidate |
| created_at | timestamp | Export timestamp |
| created_by | text | User ID/email |
| status | text | CREATED |
| file_name | text | CSV name |
| file_hash | text | Integrity |
| extraction_snapshot_hash | text | Hash of exportable record content at export time |
| record_count | int | Number exported |
| reexport_of_batch_id | uuid | Nullable FK export_batch |
| reexport_reason | text | Required for re-export |

## Table: export_download

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| export_batch_id | uuid | FK export_batch |
| downloaded_at | timestamp | Download timestamp |
| downloaded_by | text | User ID/email |

## Table: configuration_change

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| changed_entity_type | text | WATCH_QUERY / CONFIGURED_BASE_ACT |
| changed_entity_id | uuid | Entity ID |
| action | text | CREATE / UPDATE / DISABLE / ENABLE |
| actor | text | User ID/email |
| changed_at | timestamp | Timestamp |
| before_value | jsonb | Nullable |
| after_value | jsonb | Nullable |
| comment | text | Nullable |

## Table: export_batch_record

| Field | Type | Notes |
|---|---|---|
| export_batch_id | uuid | FK export_batch |
| record_id | uuid | FK sanction_delta_record |
