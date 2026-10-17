-- Administrative deployment metadata, deliberately outside the Data API schemas.
create schema deployment;
revoke all on schema deployment from public, anon, authenticated, service_role;

create table deployment.migration_checksums (
  version text primary key check (version ~ '^[0-9]{14}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now()
);
create table deployment.release_events (
  id bigint generated always as identity primary key,
  environment text not null check (environment = 'production'),
  version text not null check (version ~ '^v0[.]1[.][0-9]+$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  event text not null check (event in ('prepared', 'active', 'failed', 'rolled_back')),
  schema_version text not null,
  recorded_at timestamptz not null default now()
);
create table deployment.current_release (
  environment text primary key check (environment = 'production'),
  version text not null check (version ~ '^v0[.]1[.][0-9]+$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  schema_version text not null,
  activated_at timestamptz not null default now()
);
alter table deployment.migration_checksums enable row level security;
alter table deployment.release_events enable row level security;
alter table deployment.current_release enable row level security;
revoke all on all tables in schema deployment from public, anon, authenticated, service_role;
revoke all on all sequences in schema deployment from public, anon, authenticated, service_role;
