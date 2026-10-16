-- Careers: public job applications submitted from the careers site and reviewed
-- in HOT DOOGY Operations → Team → Careers.
--
-- Write path: the `careers-submit` Edge Function (service role) calls
-- careers_submit / careers_attach_file. Anonymous and authenticated roles have no
-- direct table privileges. Review path: owner/admin with MFA read the tables under
-- RLS and change status, rating and notes through careers_review.

create table public.careers_applications (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 reference text not null unique check (reference ~ '^HD-[A-Z0-9]{6}$'),
 status text not null default 'new' check (status in ('new','reviewing','interview','offer','hired','rejected','archived')),
 locale text not null default 'en' check (locale in ('en','pt')),
 first_name text not null check (length(first_name) between 1 and 100),
 last_name text not null check (length(last_name) between 1 and 100),
 email text not null check (length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 phone text not null check (length(phone) between 7 and 32),
 city text not null check (length(city) between 1 and 100),
 state text not null default 'MA' check (length(state) between 2 and 40),
 preferred_location_id uuid references public.locations(id),
 any_location boolean not null default false,
 position text not null check (position in ('team_member','cook','cashier','shift_lead','manager')),
 at_least_16 boolean not null,
 work_authorized boolean not null,
 earliest_start date not null,
 hours_per_week text not null check (hours_per_week in ('under_15','15_25','25_35','full_time','flexible')),
 availability jsonb not null default '[]'::jsonb check (jsonb_typeof(availability) = 'array'),
 work_experience text not null check (work_experience in ('first_job','under_1_year','1_3_years','3_plus_years')),
 english_proficiency text not null check (english_proficiency in ('basic','conversational','fluent','native')),
 other_languages text check (other_languages is null or length(other_languages) <= 200),
 pitch text check (pitch is null or length(pitch) <= 2000),
 referral_source text check (referral_source is null or length(referral_source) <= 200),
 consent_at timestamptz not null,
 submitted_ip_hash text check (submitted_ip_hash is null or submitted_ip_hash ~ '^[0-9a-f]{64}$'),
 user_agent text check (user_agent is null or length(user_agent) <= 512),
 rating smallint check (rating is null or rating between 1 and 5),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint careers_applications_location_choice check ((preferred_location_id is not null) <> any_location)
);
comment on table public.careers_applications is 'Job applications from the public careers site. Written only by careers_submit (service role).';
create index careers_applications_status_idx on public.careers_applications (organization_id, status, created_at desc);
create index careers_applications_email_idx on public.careers_applications (organization_id, lower(email), created_at desc);

create table public.careers_application_files (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 application_id uuid not null references public.careers_applications(id) on delete cascade,
 kind text not null check (kind in ('resume','selfie')),
 bucket_id text not null default 'careers-uploads' check (bucket_id = 'careers-uploads'),
 object_path text not null unique,
 file_name text not null check (length(file_name) between 1 and 255),
 mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
 size bigint not null check (size > 0 and size <= 5242880),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 unique (application_id, kind)
);

create table public.careers_application_notes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 application_id uuid not null references public.careers_applications(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 body text not null check (length(body) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index careers_application_notes_app_idx on public.careers_application_notes (application_id, created_at);

create table public.careers_application_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 application_id uuid not null references public.careers_applications(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 type text not null check (type in ('submitted','file_attached','status_changed','rated','note_added')),
 from_status text,
 to_status text,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index careers_application_events_app_idx on public.careers_application_events (application_id, created_at);

-- Per-network submission throttle used by careers_submit. Service role only.
create table public.careers_submission_throttle (
 ip_hash text not null,
 window_start timestamptz not null,
 submissions integer not null default 1,
 primary key (ip_hash, window_start)
);

create or replace function private.careers_touch_updated_at() returns trigger
language plpgsql security definer set search_path to '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger careers_applications_touch before update on public.careers_applications
for each row execute function private.careers_touch_updated_at();

create or replace function private.careers_reject_mutation() returns trigger
language plpgsql security definer set search_path to '' as $$
begin raise exception 'Careers history is append-only' using errcode = '42501'; end; $$;
create trigger careers_events_immutable before update or delete on public.careers_application_events
for each row execute function private.careers_reject_mutation();

-- Row-level security: owner/admin with MFA may read; all writes go through functions.
alter table public.careers_applications enable row level security;
alter table public.careers_application_files enable row level security;
alter table public.careers_application_notes enable row level security;
alter table public.careers_application_events enable row level security;
alter table public.careers_submission_throttle enable row level security;

create policy careers_applications_read on public.careers_applications for select to authenticated
 using (private.mfa_authorized() and private.has_org_role(organization_id, array['owner','admin']::public.member_role[]));
create policy careers_files_read on public.careers_application_files for select to authenticated
 using (private.mfa_authorized() and private.has_org_role(organization_id, array['owner','admin']::public.member_role[]));
create policy careers_notes_read on public.careers_application_notes for select to authenticated
 using (private.mfa_authorized() and private.has_org_role(organization_id, array['owner','admin']::public.member_role[]));
create policy careers_events_read on public.careers_application_events for select to authenticated
 using (private.mfa_authorized() and private.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

revoke all on table public.careers_applications, public.careers_application_files, public.careers_application_notes,
 public.careers_application_events, public.careers_submission_throttle from public, anon, authenticated;
grant select on table public.careers_applications, public.careers_application_files, public.careers_application_notes,
 public.careers_application_events to authenticated;

-- Submission (service role only). Validates, throttles and records the application.
create or replace function public.careers_submit(p jsonb, p_ip_hash text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
 org uuid; loc uuid; any_loc boolean; ref text; app public.careers_applications; attempts integer := 0; hits integer;
 day record;
begin
 if current_user not in ('service_role','postgres') then
  raise exception 'Careers submission requires the service role' using errcode = '42501';
 end if;
 if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invalid application' using errcode = '22023'; end if;
 select id into org from public.organizations order by created_at limit 1;
 if org is null then raise exception 'Organization not configured' using errcode = 'P0001'; end if;

 if p_ip_hash is not null then
  insert into public.careers_submission_throttle (ip_hash, window_start)
  values (p_ip_hash, date_trunc('hour', now()))
  on conflict (ip_hash, window_start) do update set submissions = public.careers_submission_throttle.submissions + 1
  returning submissions into hits;
  if hits > 5 then raise exception 'Too many applications from this network. Try again in an hour.' using errcode = 'P0002'; end if;
  delete from public.careers_submission_throttle where window_start < now() - interval '2 days';
 end if;

 any_loc := coalesce((p->>'any_location')::boolean, false);
 if not any_loc then
  select l.id into loc from public.locations l where l.organization_id = org and l.active and (l.id::text = p->>'preferred_location_id' or l.code = p->>'preferred_location_code');
  if loc is null then raise exception 'Choose a valid location' using errcode = '22023'; end if;
 end if;
 if jsonb_typeof(coalesce(p->'availability','[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'availability','[]'::jsonb)) = 0 then
  raise exception 'Select at least one available day' using errcode = '22023';
 end if;
 for day in select value from jsonb_array_elements(p->'availability') loop
  if (day.value->>'day') not in ('sun','mon','tue','wed','thu','fri','sat')
   or (day.value->>'from') !~ '^([01]\d|2[0-3]):[0-5]\d$' or (day.value->>'to') !~ '^([01]\d|2[0-3]):[0-5]\d$'
   or (day.value->>'from') >= (day.value->>'to') then
   raise exception 'Availability times are invalid' using errcode = '22023';
  end if;
 end loop;
 if exists (select 1 from public.careers_applications a where a.organization_id = org and lower(a.email) = lower(p->>'email')
            and a.position = p->>'position' and a.created_at > now() - interval '24 hours') then
  raise exception 'An application with this email was received in the last 24 hours.' using errcode = 'P0003';
 end if;

 loop
  ref := 'HD-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  exit when not exists (select 1 from public.careers_applications where reference = ref);
  attempts := attempts + 1; if attempts > 20 then raise exception 'Unable to allocate a reference' using errcode = 'P0001'; end if;
 end loop;

 insert into public.careers_applications (
  organization_id, reference, locale, first_name, last_name, email, phone, city, state, preferred_location_id, any_location,
  position, at_least_16, work_authorized, earliest_start, hours_per_week, availability, work_experience, english_proficiency,
  other_languages, pitch, referral_source, consent_at, submitted_ip_hash, user_agent)
 values (
  org, ref, coalesce(nullif(p->>'locale',''),'en'), trim(p->>'first_name'), trim(p->>'last_name'), lower(trim(p->>'email')), trim(p->>'phone'),
  trim(p->>'city'), coalesce(nullif(trim(p->>'state'),''),'MA'), loc, any_loc,
  p->>'position', (p->>'at_least_16')::boolean, (p->>'work_authorized')::boolean, (p->>'earliest_start')::date, p->>'hours_per_week',
  p->'availability', p->>'work_experience', p->>'english_proficiency',
  nullif(trim(p->>'other_languages'),''), nullif(trim(p->>'pitch'),''), nullif(trim(p->>'referral_source'),''),
  now(), p_ip_hash, left(p_user_agent, 512))
 returning * into app;

 insert into public.careers_application_events (organization_id, application_id, type, to_status, payload)
 values (org, app.id, 'submitted', 'new', jsonb_build_object('locale', app.locale));
 return jsonb_build_object('id', app.id, 'reference', app.reference, 'organization_id', org);
end; $$;
revoke all on function public.careers_submit(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.careers_submit(jsonb, text, text) to service_role;

-- Attach an uploaded file (service role only, after the Storage upload succeeded).
create or replace function public.careers_attach_file(p_application uuid, p_kind text, p_path text, p_file_name text, p_mime text, p_size bigint, p_sha256 text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare app public.careers_applications; file_id uuid;
begin
 if current_user not in ('service_role','postgres') then
  raise exception 'Careers file attachment requires the service role' using errcode = '42501';
 end if;
 select * into app from public.careers_applications where id = p_application;
 if app.id is null then raise exception 'Application not found' using errcode = 'P0001'; end if;
 if p_path !~ ('^' || app.organization_id::text || '/' || app.id::text || '/' || p_kind || '-[a-z0-9]+\.(pdf|jpg|png)$') then
  raise exception 'Storage path does not belong to this application' using errcode = '22023';
 end if;
 insert into public.careers_application_files (organization_id, application_id, kind, object_path, file_name, mime_type, size, sha256)
 values (app.organization_id, app.id, p_kind, p_path, p_file_name, p_mime, p_size, p_sha256) returning id into file_id;
 insert into public.careers_application_events (organization_id, application_id, type, payload)
 values (app.organization_id, app.id, 'file_attached', jsonb_build_object('kind', p_kind, 'size', p_size));
 return file_id;
end; $$;
revoke all on function public.careers_attach_file(uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.careers_attach_file(uuid, text, text, text, text, bigint, text) to service_role;

-- Review from Operations: status, rating and notes with optimistic locking.
create or replace function public.careers_review(p_id uuid, p_version integer, p_status text default null, p_rating smallint default null, p_clear_rating boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app public.careers_applications; org uuid;
begin
 select organization_id into org from public.careers_applications where id = p_id;
 if org is null then raise exception 'Application not found' using errcode = 'P0001'; end if;
 if auth.uid() is null or not private.mfa_authorized() or not private.has_org_role(org, array['owner','admin']::public.member_role[]) then
  raise exception 'Careers access denied' using errcode = '42501';
 end if;
 if exists (select 1 from public.hr_permission_profiles p join public.organization_members m on m.organization_id = p.organization_id and m.role::text = p.role
            where m.user_id = auth.uid() and m.organization_id = org and (p.permissions->'hr'->>'view' = 'false' or p.permissions->'hr'->>'write' = 'false')) then
  raise exception 'Careers saving denied' using errcode = '42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('careers_review:' || p_id::text, 0));
 select * into app from public.careers_applications where id = p_id for update;
 if p_version is null or app.version <> p_version then raise exception 'Application changed. Reload and retry.' using errcode = '40001'; end if;

 if p_status is not null and p_status <> app.status then
  if p_status not in ('new','reviewing','interview','offer','hired','rejected','archived') then raise exception 'Invalid status' using errcode = '22023'; end if;
  insert into public.careers_application_events (organization_id, application_id, actor_id, type, from_status, to_status)
  values (org, app.id, auth.uid(), 'status_changed', app.status, p_status);
  app.status := p_status; app.reviewed_by := auth.uid(); app.reviewed_at := now();
 end if;
 if p_clear_rating or (p_rating is not null and p_rating is distinct from app.rating) then
  if p_rating is not null and p_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5' using errcode = '22023'; end if;
  insert into public.careers_application_events (organization_id, application_id, actor_id, type, payload)
  values (org, app.id, auth.uid(), 'rated', jsonb_build_object('from', app.rating, 'to', case when p_clear_rating then null else p_rating end));
  app.rating := case when p_clear_rating then null else p_rating end; app.reviewed_by := auth.uid(); app.reviewed_at := now();
 end if;
 if nullif(trim(p_note), '') is not null then
  insert into public.careers_application_notes (organization_id, application_id, author_id, body) values (org, app.id, auth.uid(), trim(p_note));
  insert into public.careers_application_events (organization_id, application_id, actor_id, type) values (org, app.id, auth.uid(), 'note_added');
 end if;

 update public.careers_applications set status = app.status, rating = app.rating, reviewed_by = app.reviewed_by, reviewed_at = app.reviewed_at,
  version = version + 1 where id = app.id returning * into app;
 return to_jsonb(app) - 'submitted_ip_hash' - 'user_agent';
end; $$;
revoke all on function public.careers_review(uuid, integer, text, smallint, boolean, text) from public, anon;
grant execute on function public.careers_review(uuid, integer, text, smallint, boolean, text) to authenticated;

-- Storage: private bucket. Uploads come from the service role; owner/admin read and delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('careers-uploads', 'careers-uploads', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create policy careers_uploads_select on storage.objects for select to authenticated
 using (bucket_id = 'careers-uploads' and exists (
  select 1 from public.careers_applications a
  where a.id::text = (storage.foldername(objects.name))[2] and a.organization_id::text = (storage.foldername(objects.name))[1]
   and private.has_org_role(a.organization_id, array['owner','admin']::public.member_role[])));
create policy careers_uploads_delete on storage.objects for delete to authenticated
 using (bucket_id = 'careers-uploads' and exists (
  select 1 from public.careers_applications a
  where a.id::text = (storage.foldername(objects.name))[2] and a.organization_id::text = (storage.foldername(objects.name))[1]
   and private.has_org_role(a.organization_id, array['owner','admin']::public.member_role[])));
