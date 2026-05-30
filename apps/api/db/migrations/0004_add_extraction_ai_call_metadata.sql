alter table extraction_result
  add column if not exists ai_call_metadata jsonb;
