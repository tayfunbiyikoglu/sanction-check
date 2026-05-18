create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table configured_base_act (
  id text primary key,
  celex_id text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table watch_query (
  id text primary key,
  name text not null,
  source text not null check (source in ('RSS', 'EURLEX_WS')),
  query_text text not null,
  feed_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table watch_query_base_act (
  watch_query_id text not null references watch_query(id),
  configured_base_act_id text not null references configured_base_act(id),
  primary key (watch_query_id, configured_base_act_id)
);

create table monitor_run (
  id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('SUCCESS', 'PARTIAL', 'FAILED')),
  source text not null check (source in ('RSS', 'EURLEX_WS')),
  watch_query_id text not null references watch_query(id),
  query_snapshot text not null,
  items_seen integer not null default 0,
  new_candidates integer not null default 0,
  search_response_ref text,
  search_response_hash text,
  search_response_length integer,
  search_response_content_type text,
  search_response_source_uri text,
  search_response_retrieved_at timestamptz,
  error_message text
);

create table legal_act_candidate (
  id text primary key,
  celex_id text unique,
  cellar_id text unique,
  official_uri text unique,
  legal_act_identity_kind text not null check (legal_act_identity_kind in ('CELEX', 'CELLAR', 'OFFICIAL_URI')),
  legal_act_identity_value text not null,
  title text not null,
  publication_date date,
  source_url text,
  rss_feed_name text,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  raw_content_ref text,
  content_hash text,
  content_type text,
  source_content_length integer,
  source_content_uri text,
  retrieved_at timestamptz,
  retrieval_status text not null default 'NOT_REQUESTED',
  retrieval_attempts integer not null default 0,
  retrieval_last_attempt_at timestamptz,
  retrieval_next_retry_at timestamptz,
  source_content_changed boolean not null default false,
  previous_source_content_hash text,
  retrieval_failure_code text,
  retrieval_failure_message text,
  available_languages jsonb not null default '[]'::jsonb,
  working_language text not null default 'en',
  check (celex_id is not null or cellar_id is not null or official_uri is not null),
  unique (legal_act_identity_kind, legal_act_identity_value)
);

create table discovery_trigger (
  id text primary key,
  monitor_run_id text not null references monitor_run(id),
  source text not null check (source in ('RSS', 'EURLEX_WS')),
  source_item_id text,
  source_item_hash text,
  celex_id text,
  cellar_id text,
  official_uri text,
  title text,
  publication_date date,
  trigger_url text,
  candidate_id text references legal_act_candidate(id),
  status text not null check (status in ('CANDIDATE_CREATED', 'CANDIDATE_REFRESHED', 'MALFORMED')),
  error_message text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table candidate_base_act_match (
  candidate_id text not null references legal_act_candidate(id),
  configured_base_act_id text not null references configured_base_act(id),
  match_source text not null check (match_source in ('QUERY', 'METADATA', 'PARSER')),
  confidence numeric,
  matched_at timestamptz not null default now(),
  primary key (candidate_id, configured_base_act_id, match_source)
);

create table extraction_result (
  id text primary key,
  candidate_id text not null references legal_act_candidate(id),
  parser_version text not null,
  classification text not null,
  confidence numeric not null,
  annex_found boolean not null default false,
  annex_heading text,
  is_complete boolean not null default false,
  evidence_text text,
  source_content_ref text,
  source_content_hash text,
  created_at timestamptz not null default now()
);

create table sanction_delta_record (
  id text primary key,
  extraction_result_id text not null references extraction_result(id),
  candidate_id text not null references legal_act_candidate(id),
  record_type text not null check (record_type in ('PERSON', 'ENTITY')),
  action_type text not null check (action_type in ('ADD', 'AMEND', 'REMOVE', 'REPLACE')),
  primary_name text not null,
  listed_entry jsonb not null default '{}'::jsonb,
  aliases jsonb not null default '[]'::jsonb,
  date_of_birth text,
  place_of_birth text,
  nationality text,
  identifiers jsonb not null default '[]'::jsonb,
  address text,
  function_or_role text,
  grounds text,
  affected_annex text,
  detected_base_act text,
  source_order integer not null,
  source_location text,
  source_celex_id text,
  source_publication_date date,
  evidence_text text not null,
  confidence numeric not null
);

create table correction_action (
  id text primary key,
  candidate_id text not null references legal_act_candidate(id),
  record_id text references sanction_delta_record(id),
  action text not null check (action in ('CORRECT_FIELD', 'ADD_RECORD', 'MARK_EXTRACTION_COMPLETE', 'COMMENT')),
  actor text not null,
  action_at timestamptz not null default now(),
  before_value jsonb,
  after_value jsonb,
  comment text
);

create table export_batch (
  id text primary key,
  candidate_id text not null references legal_act_candidate(id),
  created_at timestamptz not null default now(),
  created_by text not null,
  status text not null default 'CREATED' check (status in ('CREATED')),
  file_name text not null,
  file_hash text not null,
  extraction_snapshot_hash text not null,
  record_count integer not null,
  reexport_of_batch_id text references export_batch(id),
  reexport_reason text
);

create table export_batch_record (
  export_batch_id text not null references export_batch(id),
  record_id text not null references sanction_delta_record(id),
  primary key (export_batch_id, record_id)
);

create table export_batch_file (
  export_batch_id text primary key references export_batch(id),
  csv_content text not null
);

create table export_download (
  id text primary key,
  export_batch_id text not null references export_batch(id),
  downloaded_at timestamptz not null default now(),
  downloaded_by text not null
);

create table configuration_change (
  id text primary key,
  changed_entity_type text not null check (changed_entity_type in ('WATCH_QUERY', 'CONFIGURED_BASE_ACT')),
  changed_entity_id text not null,
  action text not null check (action in ('CREATE', 'UPDATE', 'DISABLE', 'ENABLE')),
  actor text not null,
  changed_at timestamptz not null default now(),
  before_value jsonb,
  after_value jsonb,
  comment text
);
