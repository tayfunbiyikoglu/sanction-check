create table if not exists record_review (
  record_id text primary key references sanction_delta_record(id),
  candidate_id text not null references legal_act_candidate(id),
  decision text not null check (decision in ('good', 'flagged', 'skipped')),
  actor text not null,
  reviewed_at timestamptz not null default now(),
  comment text
);

create index if not exists record_review_candidate_id_idx on record_review(candidate_id);
