create function public.edit_llm_invoice_draft(p_id uuid,p_expected_updated_at timestamptz,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();org uuid;loc uuid:=(p_payload->>'locationId')::uuid;vendor uuid:=(p_payload->>'supplierId')::uuid;ord uuid:=nullif(p_payload->>'orderId','')::uuid;inv public.invoices%rowtype;line jsonb;si uuid;item uuid;unit uuid;factor numeric;generated boolean:=ord is null;matches integer;num text:=btrim(p_payload->>'number');
begin
 select * into strict inv from public.invoices where id=p_id for update;
 if actor is null or not private.mfa_authorized() or not private.is_org_member(inv.organization_id) or not private.can_location(inv.location_id) or not private.can_supplier(inv.supplier_id) or not private.has_org_role(inv.organization_id,array['owner','admin','manager']::public.member_role[]) then raise exception 'Invoice access denied';end if;
 if inv.intake_source is distinct from 'llm' or inv.status<>'review' or inv.human_approved_at is not null or inv.updated_at is distinct from p_expected_updated_at then raise exception 'Draft changed; reload before editing';end if;
 p_payload:=p_payload||jsonb_build_object('documentKind','invoice','documentReviewed',true,'extraction',jsonb_build_object('document_type','invoice'),'sourceSha256',inv.source_sha256);
 select organization_id into org from public.locations where id=loc;
 if actor is null or not private.mfa_authorized() or org is null or not private.is_org_member(org) or not private.can_location(loc) or not private.can_supplier(vendor) or not private.has_org_role(org,array['owner','admin','manager']::public.member_role[]) or not exists(select 1 from public.suppliers where id=vendor and organization_id=org) then raise exception 'Invoice access denied';end if;
 if p_payload->>'documentKind' is distinct from 'invoice' or p_payload->>'documentReviewed' is distinct from 'true' or p_payload->'extraction'->>'document_type' is distinct from 'invoice' then raise exception 'A reviewed financial invoice is required';end if;
 if p_id is null or nullif(num,'') is null or length(num)>100 or nullif(p_payload->>'date','') is null or nullif(p_payload->>'dueDate','') is null or p_payload->>'sourceSha256' is null or p_payload->>'sourceSha256' !~ '^[0-9a-f]{64}$' or (p_payload->>'total')::numeric is null or (p_payload->>'total')::numeric<0 then raise exception 'Complete the invoice number, dates and total';end if;
 if coalesce(p_payload->>'currency','USD')<>'USD' then raise exception 'Review currency: only USD invoices are supported';end if;
 if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>500 then raise exception 'Invalid invoice items';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||vendor::text||lower(num),0));
 if org is distinct from inv.organization_id then raise exception 'Organization cannot change';end if;
 if exists(select 1 from public.invoices where id<>p_id and organization_id=org and supplier_id=vendor and lower(btrim(invoice_number))=lower(num)) then raise exception 'An invoice with this number already exists for this supplier';end if;
 if ord is not null and ord is distinct from inv.purchase_order_id and not exists(select 1 from public.purchase_orders where id=ord and organization_id=org and supplier_id=vendor and location_id=loc and status<>'cancelled') then raise exception 'Order must match the supplier and location';end if;
 -- Reuse only the draft order belonging exclusively to this invoice.
 generated:=exists(select 1 from public.purchase_orders po where po.id=inv.purchase_order_id and po.status='draft' and po.order_number='INV-'||inv.invoice_number and exists(select 1 from public.purchase_order_tags pt join public.tags t on t.id=pt.tag_id where pt.purchase_order_id=po.id and lower(t.name)='from invoice') and not exists(select 1 from public.invoices other where other.purchase_order_id=po.id and other.id<>p_id));
 if generated and (ord is null or ord=inv.purchase_order_id) then
  ord:=inv.purchase_order_id;
  update public.purchase_orders set supplier_id=vendor,location_id=loc,order_number='INV-'||num,ordered_at=(p_payload->>'date')::date,estimated_total=(p_payload->>'total')::numeric where id=ord;
  delete from public.purchase_order_lines where purchase_order_id=ord;
 else
  if ord is not null and not exists(select 1 from public.purchase_orders where id=ord and organization_id=org and supplier_id=vendor and location_id=loc and status<>'cancelled') then raise exception 'Order must match the supplier and location';end if;
  generated:=false;
  if ord is null then
   insert into public.purchase_orders(organization_id,location_id,supplier_id,status,order_number,ordered_at,estimated_total,created_by) values(org,loc,vendor,'draft','INV-'||num,(p_payload->>'date')::date,(p_payload->>'total')::numeric,actor) returning id into ord;
   insert into public.tags(organization_id,name,color) select org,'From Invoice','#64748B' where not exists(select 1 from public.tags where organization_id=org and lower(name)='from invoice');
   insert into public.purchase_order_tags(purchase_order_id,tag_id) select ord,id from public.tags where organization_id=org and lower(name)='from invoice' order by id limit 1;
   generated:=true;
  end if;
 end if;
 update public.invoices set location_id=loc,supplier_id=vendor,purchase_order_id=ord,invoice_number=num,invoice_date=(p_payload->>'date')::date,due_date=(p_payload->>'dueDate')::date,subtotal=nullif(p_payload->>'subtotal','')::numeric,tax=nullif(p_payload->>'tax','')::numeric,fees=nullif(p_payload->>'fees','')::numeric,total=(p_payload->>'total')::numeric,currency='USD',notes=p_payload->>'notes',extraction=coalesce(extraction,'{}'::jsonb)||jsonb_build_object('reviewedFields',jsonb_build_object('paymentTerms',p_payload->>'paymentTerms','shipToAddress',p_payload->>'shipToAddress')),updated_at=clock_timestamp() where id=p_id;
 delete from public.invoice_lines where invoice_id=p_id;
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
 insert into public.audit_logs(organization_id,location_id,user_id,action,entity_type,entity_id,new_data) values(org,loc,actor,'llm_invoice_draft_edited','invoice',p_id,jsonb_build_object('invoice_number',num,'order_id',inv.purchase_order_id,'source_sha256',inv.source_sha256));
 return jsonb_build_object('id',inv.id,'orderId',inv.purchase_order_id,'status',inv.status,'updatedAt',inv.updated_at);
end $$;
revoke all on function public.edit_llm_invoice_draft(uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.edit_llm_invoice_draft(uuid,timestamptz,jsonb) to authenticated;


create function public.approve_invoice_draft_payment(p_invoice uuid,p_expected_updated_at timestamptz,p_payment_status text,p_payment_date date,p_payment_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_payment_status='paid' and (p_payment_date is null or p_payment_date>current_date) then raise exception 'Choose a valid payment date';end if;
 if p_payment_method is not null and p_payment_method not in ('credit_card','debit_card','bank_transfer') then raise exception 'Invalid payment method';end if;
 result:=public.approve_llm_invoice_draft(p_invoice,p_expected_updated_at,p_payment_status);
 update public.invoices set payment_date=case when p_payment_status='paid' then p_payment_date end,payment_method=case when p_payment_status='paid' then p_payment_method end where id=p_invoice;
 return result;
end $$;
revoke all on function public.approve_invoice_draft_payment(uuid,timestamptz,text,date,text) from public,anon,service_role;
grant execute on function public.approve_invoice_draft_payment(uuid,timestamptz,text,date,text) to authenticated;
