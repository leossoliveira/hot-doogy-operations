alter table public.invoices add column intake_source text check(intake_source is null or intake_source='llm'),
 add column source_sha256 text check(source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
 add column extraction jsonb,add column human_approved_at timestamptz,add column human_approved_by uuid references auth.users(id);
alter table public.invoice_lines add column source_unit text;
create table private.invoice_draft_approvals(invoice_id uuid primary key references public.invoices(id) on delete cascade,actor uuid not null,approved_at timestamptz not null,payment_status text not null check(payment_status in ('paid','unpaid')));
revoke all on private.invoice_draft_approvals from public,anon,authenticated,service_role;

create function private.guard_llm_invoice_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and old.intake_source='llm' and (new.intake_source is distinct from old.intake_source or new.source_sha256 is distinct from old.source_sha256) then raise exception 'Draft provenance cannot be changed';end if;
 if new.intake_source='llm' then
  if TG_OP='INSERT' and (new.status<>'review' or new.human_approved_at is not null or new.source_sha256 is null) then raise exception 'LLM invoices must start as drafts';end if;
  if (new.status in ('approved','paid') or new.human_approved_at is not null) and not exists(select 1 from private.invoice_draft_approvals a where a.invoice_id=new.id and a.actor=new.human_approved_by and a.approved_at=new.human_approved_at) then raise exception 'Human approval is required';end if;
  if TG_OP='UPDATE' and old.human_approved_at is not null and (new.human_approved_at is distinct from old.human_approved_at or new.human_approved_by is distinct from old.human_approved_by or new.total is distinct from old.total or new.supplier_id is distinct from old.supplier_id or new.location_id is distinct from old.location_id or new.purchase_order_id is distinct from old.purchase_order_id) then raise exception 'Approved invoice details cannot be rewritten';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_llm_invoice_approval() from public,anon,authenticated,service_role;
create trigger invoice_llm_approval_guard before insert or update on public.invoices for each row execute function private.guard_llm_invoice_approval();

-- Auto-generated orders remain drafts until the invoice is approved.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.create_order_from_unlinked_invoice()'::regprocedure);
 if position($old$'ordered'::public.purchase_order_status,$old$ in definition)=0 then raise exception 'Unexpected order creation implementation';end if;
 execute replace(definition,$old$'ordered'::public.purchase_order_status,$old$,$new$(case when new.intake_source='llm' then 'draft' else 'ordered' end)::public.purchase_order_status,$new$);
end $migration$;

create function public.save_llm_invoice_draft(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();org uuid;loc uuid:=(p_payload->>'locationId')::uuid;vendor uuid:=(p_payload->>'supplierId')::uuid;ord uuid:=nullif(p_payload->>'orderId','')::uuid;inv public.invoices%rowtype;line jsonb;si uuid;item uuid;unit uuid;factor numeric;generated boolean:=ord is null;matches integer;num text:=btrim(p_payload->>'number');
begin
 select organization_id into org from public.locations where id=loc;
 if actor is null or not private.mfa_authorized() or org is null or not private.is_org_member(org) or not private.can_location(loc) or not private.can_supplier(vendor) or not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) or not exists(select 1 from public.suppliers where id=vendor and organization_id=org) then raise exception 'Invoice access denied';end if;
 if p_payload->>'documentKind' is distinct from 'invoice' or p_payload->>'documentReviewed' is distinct from 'true' or p_payload->'extraction'->>'document_type' is distinct from 'invoice' then raise exception 'A reviewed financial invoice is required';end if;
 if p_id is null or nullif(num,'') is null or length(num)>100 or nullif(p_payload->>'date','') is null or nullif(p_payload->>'dueDate','') is null or p_payload->>'sourceSha256' is null or p_payload->>'sourceSha256' !~ '^[0-9a-f]{64}$' or (p_payload->>'total')::numeric is null or (p_payload->>'total')::numeric<0 then raise exception 'Complete the invoice number, dates and total';end if;
 if coalesce(p_payload->>'currency','USD')<>'USD' then raise exception 'Review currency: only USD invoices are supported';end if;
 if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>500 then raise exception 'Invalid invoice items';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||vendor::text||lower(num),0));
 select * into inv from public.invoices where id=p_id for update;
 if found then
  if inv.organization_id<>org or inv.location_id<>loc or inv.supplier_id<>vendor or inv.intake_source is distinct from 'llm' or inv.source_sha256 is distinct from p_payload->>'sourceSha256' then raise exception 'Invoice identity conflict';end if;
  return jsonb_build_object('id',inv.id,'orderId',inv.purchase_order_id,'status',inv.status,'updatedAt',inv.updated_at);
 end if;
 if exists(select 1 from public.invoices where organization_id=org and supplier_id=vendor and lower(btrim(invoice_number))=lower(num)) then raise exception 'An invoice with this number already exists for this supplier';end if;
 if ord is not null and not exists(select 1 from public.purchase_orders where id=ord and organization_id=org and supplier_id=vendor and location_id=loc and status<>'cancelled') then raise exception 'Order must match the supplier and location';end if;
 insert into public.invoices(id,organization_id,location_id,supplier_id,purchase_order_id,invoice_number,invoice_date,due_date,status,subtotal,tax,fees,total,currency,created_by,document_kind,intake_source,source_sha256,extraction,notes)
 values(p_id,org,loc,vendor,ord,num,(p_payload->>'date')::date,(p_payload->>'dueDate')::date,'review',nullif(p_payload->>'subtotal','')::numeric,nullif(p_payload->>'tax','')::numeric,nullif(p_payload->>'fees','')::numeric,(p_payload->>'total')::numeric,'USD',actor,'invoice','llm',p_payload->>'sourceSha256',jsonb_build_object('result',p_payload->'extraction','model',p_payload->>'model'),p_payload->>'notes');
 select * into strict inv from public.invoices where id=p_id;
 for line in select value from jsonb_array_elements(p_payload->'items') loop
  if nullif(btrim(line->>'description'),'') is null then raise exception 'Each invoice item needs a description';end if;
  if (line->>'quantity')::numeric<0 or (line->>'unit_price')::numeric<0 then raise exception 'Review negative quantities or prices';end if;
  si:=null;item:=null;unit:=null;factor:=null;
  select count(*),(array_agg(id))[1],(array_agg(inventory_item_id))[1] into matches,si,item from public.supplier_items where organization_id=org and supplier_id=vendor and nullif(btrim(line->>'sku'),'') is not null and lower(btrim(sku))=lower(btrim(line->>'sku'));
  if matches<>1 then si:=null;item:=null;end if;
  if item is not null then
   select count(*),(array_agg(iu.id))[1],(array_agg(iu.quantity_in_base_unit))[1] into matches,unit,factor from public.inventory_item_units iu join public.units u on u.id=iu.unit_id where iu.inventory_item_id=item and iu.organization_id=org and lower(btrim(line->>'unit')) in (lower(u.name),lower(u.code));
   if matches<>1 then unit:=null;factor:=null;end if;
  end if;
  insert into public.invoice_lines(organization_id,invoice_id,supplier_item_id,inventory_item_id,description,sku,item_unit_id,source_unit,quantity,quantity_base,unit_price,line_total)
  values(org,p_id,si,item,line->>'description',line->>'sku',unit,line->>'unit',(line->>'quantity')::numeric,(line->>'quantity')::numeric*factor,(line->>'unit_price')::numeric,(line->>'line_total')::numeric);
  if generated and item is not null and unit is not null and (line->>'quantity')::numeric is not null then
   insert into public.purchase_order_lines(organization_id,purchase_order_id,supplier_item_id,inventory_item_id,purchase_item_unit_id,ordered_purchase_qty,estimated_unit_price,line_total,notes)
   values(org,inv.purchase_order_id,si,item,unit,(line->>'quantity')::numeric,(line->>'unit_price')::numeric,(line->>'line_total')::numeric,'From invoice; pending human approval');
  end if;
 end loop;
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,loc,actor,'llm_invoice_draft_created','invoice',p_id,jsonb_build_object('invoice_number',num,'order_id',inv.purchase_order_id,'source_sha256',inv.source_sha256));
 return jsonb_build_object('id',inv.id,'orderId',inv.purchase_order_id,'status',inv.status,'updatedAt',inv.updated_at);
end $$;
revoke all on function public.save_llm_invoice_draft(uuid,jsonb) from public,anon,service_role;
grant execute on function public.save_llm_invoice_draft(uuid,jsonb) to authenticated;

create function public.approve_llm_invoice_draft(p_invoice uuid,p_expected_updated_at timestamptz,p_payment_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype;actor uuid:=auth.uid();approved timestamptz:=now();
begin
 select * into strict inv from public.invoices where id=p_invoice for update;
 if actor is null or not private.mfa_authorized() or not private.is_org_member(inv.organization_id) or not private.can_location(inv.location_id) or not private.can_supplier(inv.supplier_id) or not private.has_org_role(inv.organization_id,array['owner','admin','manager']::public.member_role[]) then raise exception 'Invoice access denied';end if;
 if inv.intake_source is distinct from 'llm' or inv.status<>'review' or inv.human_approved_at is not null or inv.updated_at is distinct from p_expected_updated_at then raise exception 'Draft changed; reload before approving';end if;
 if p_payment_status is null or p_payment_status not in ('unpaid','paid') then raise exception 'Choose Unpaid or Paid';end if;
 if not private.invoice_has_verified_s3(inv.id) then raise exception 'Upload and verify the original invoice before approval';end if;
 insert into private.invoice_draft_approvals values(inv.id,actor,approved,p_payment_status);
 update public.invoices set status=case when p_payment_status='paid' then 'paid'::public.invoice_status else 'approved'::public.invoice_status end,human_approved_at=approved,human_approved_by=actor where id=inv.id;
 -- Only the auto-generated draft order is advanced. No receipt/stock writes.
 update public.purchase_orders po set status='ordered',approved_by=actor where po.id=inv.purchase_order_id and po.status='draft' and po.order_number='INV-'||inv.invoice_number and exists(select 1 from public.purchase_order_tags pt join public.tags t on t.id=pt.tag_id where pt.purchase_order_id=po.id and lower(t.name)='from invoice');
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(inv.organization_id,inv.location_id,actor,'llm_invoice_human_approved','invoice',inv.id,jsonb_build_object('payment_status',p_payment_status,'approved_at',approved));
 return jsonb_build_object('id',inv.id,'paymentStatus',p_payment_status,'approvedAt',approved);
end $$;
revoke all on function public.approve_llm_invoice_draft(uuid,timestamptz,text) from public,anon,service_role;
grant execute on function public.approve_llm_invoice_draft(uuid,timestamptz,text) to authenticated;

-- Bind uploads for this flow to the original file analyzed by the LLM.
create function private.guard_llm_invoice_file() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.invoices i where i.id=new.invoice_id and i.intake_source='llm' and i.source_sha256 is distinct from new.sha256) then raise exception 'Upload the original file used for invoice analysis';end if;
 return new;
end $$;
revoke all on function private.guard_llm_invoice_file() from public,anon,authenticated,service_role;
create trigger invoice_review_original_guard before insert or update on private.invoice_document_reviews for each row execute function private.guard_llm_invoice_file();
