
alter table public.recipes add constraint modifier_recipe_type_consistent
check ((classification::text = 'modifier_recipe') = (recipe_type::text = 'modifier'));
alter table public.menu_item_modifier_rules
 add column action text not null default 'add' check (action in ('add','extra','remove')),
 add column price numeric(12,2) not null default 0 check (price >= 0),
 add constraint removal_has_no_charge check (action <> 'remove' or price = 0);
update public.menu_item_modifier_rules set action='remove' where effect_type='fixed_removal';
do $$ declare c record; begin
for c in select conname from pg_constraint where conrelid='public.menu_item_modifier_rules'::regclass and contype='u'
loop execute format('alter table public.menu_item_modifier_rules drop constraint %I',c.conname); end loop;
end $$;
alter table public.menu_item_modifier_rules add constraint menu_modifier_action_unique unique(menu_item_id,modifier_id,action);

create function private.validate_modifier_recipe_rule() returns trigger
language plpgsql set search_path='' as $$
begin
 new.effect_type := case when new.action='remove' then 'fixed_removal'::public.modifier_effect_type else 'fixed_addition'::public.modifier_effect_type end;
 if new.recipe_id is not null and not exists (
 select 1 from public.recipes r where r.id=new.recipe_id and r.classification='modifier_recipe'
 ) then raise exception 'Modifier rules require a Modifier Recipe'; end if;
 return new;
end $$;
create trigger validate_modifier_recipe_rule before insert or update on public.menu_item_modifier_rules
for each row execute function private.validate_modifier_recipe_rule();

create function private.require_modifier_menu_relationship() returns trigger
language plpgsql set search_path='' as $$
declare mid uuid;
begin
 if tg_table_name='modifiers' then mid:=new.id; else mid:=old.modifier_id; end if;
 if exists(select 1 from public.modifiers where id=mid)
 and not exists(select 1 from public.menu_item_modifier_rules where modifier_id=mid)
 then raise exception 'Every modifier must be linked to at least one menu item'; end if;
 return null;
end $$;
create constraint trigger modifier_requires_menu after insert or update on public.modifiers
deferrable initially deferred for each row execute function private.require_modifier_menu_relationship();
create constraint trigger modifier_rule_removal_check after delete or update on public.menu_item_modifier_rules
deferrable initially deferred for each row execute function private.require_modifier_menu_relationship();
revoke all on function private.validate_modifier_recipe_rule() from public;
revoke all on function private.require_modifier_menu_relationship() from public;
comment on column public.menu_item_modifier_rules.price is 'Sale surcharge per modifier application, in menu currency. Zero means no surcharge.';
comment on column public.menu_item_modifier_rules.action is 'add, extra, or remove; independent rules and prices per menu item.';

;
