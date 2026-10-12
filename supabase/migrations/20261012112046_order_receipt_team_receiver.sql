-- Select the actual receiver during order receipt; received_by remains the authenticated recorder.
alter table public.purchase_receipts add column receiver_team_member_id uuid references public.hr_team_members(id);
create or replace function private.capture_receipt_receiver() returns trigger language plpgsql security definer set search_path='' as $$
declare receiver text;
begin
 if new.receiver_team_member_id is not null and (tg_op='INSERT' or old.status::text is distinct from 'completed') then
  select nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),'') into receiver from public.hr_team_members t where t.id=new.receiver_team_member_id and t.organization_id=new.organization_id and t.status='active' and new.location_id=any(t.location_ids) for share;
  if receiver is null then raise exception 'Choose an active team member assigned to the receiving location';end if;
 end if;
 if new.status::text='completed' and (tg_op='INSERT' or old.status::text is distinct from 'completed') then
  new.received_by=coalesce(auth.uid(),new.received_by);
  if new.receiver_team_member_id is not null then new.receiver_name=receiver;
  else select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),'')) into new.receiver_name from auth.users u left join public.profiles p on p.id=u.id where u.id=new.received_by;end if;
 elsif tg_op='UPDATE' then new.receiver_name=old.receiver_name;if old.status::text='completed' then new.receiver_team_member_id=old.receiver_team_member_id;end if;
 else new.receiver_name=null;end if;
 return new;
end $$;
do $$ declare definition text;old_fragment text;begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 old_fragment:=$old$insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor);$old$;
 if position(old_fragment in definition)=0 then raise exception 'Unexpected receipt operation definition';end if;
 execute replace(definition,old_fragment,$new$insert into public.purchase_receipts(id,organization_id,location_id,supplier_id,purchase_order_id,received_at,received_by,receiver_team_member_id) values(id,org,old_order.location_id,old_order.supplier_id,old_order.id,(p->>'receivedAt')::timestamptz,actor,nullif(p->>'receiverTeamMemberId','')::uuid);$new$);
end $$;
-- Assignment is captured in receipt/approval workflows, never through a separate invoice action.
drop function public.set_invoice_team_receiver(uuid,timestamptz,uuid);
notify pgrst,'reload schema';
