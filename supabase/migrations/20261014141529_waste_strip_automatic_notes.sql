-- Waste notes keep only what people wrote. Automations (OpenClaw via WhatsApp) insert waste without an app user
-- (reported_by is null) and add their own annotations such as "WhatsApp Food Waste Log (Sherwood Plaza)".
-- Notes are split on " - "; parts that look like those annotations are dropped, the rest is kept.
create or replace function private.waste_human_notes(p text) returns text language sql immutable set search_path='' as $$
 select nullif(btrim(string_agg(btrim(part),' - ' order by n)),'')
 from unnest(string_to_array(coalesce(p,''),' - ')) with ordinality as t(part,n)
 where btrim(part)<>'' and btrim(part) !~* '(whatsapp|food waste log|registrado via|openclaw)'
$$;
revoke all on function private.waste_human_notes(text) from public,anon,authenticated;

create or replace function private.waste_strip_automatic_notes() returns trigger language plpgsql set search_path='' as $$
begin
 if new.reported_by is null then new.notes:=private.waste_human_notes(new.notes);end if;
 return new;
end $$;
revoke all on function private.waste_strip_automatic_notes() from public,anon,authenticated;

drop trigger if exists waste_strip_automatic_notes on public.waste_events;
create trigger waste_strip_automatic_notes before insert or update of notes,reported_by on public.waste_events
 for each row execute function private.waste_strip_automatic_notes();

-- Existing automation records: the same cleanup, so their notes keep only the human part.
update public.waste_events set notes=private.waste_human_notes(notes)
 where reported_by is null and notes is distinct from private.waste_human_notes(notes);
