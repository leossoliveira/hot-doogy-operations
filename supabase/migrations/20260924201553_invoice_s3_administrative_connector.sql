alter table private.invoice_s3_confirmations
 add column confirmation_channel text not null default 'edge_function',
 add column confirmed_by_session text;

do $migration$
declare definition text; original_guard text := $g$if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted backend required'; end if;$g$;
begin
 select pg_get_functiondef('public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text)'::regprocedure) into definition;
 if position(original_guard in definition)=0 then raise exception 'Unexpected confirmation function definition'; end if;
 definition:=replace(definition,original_guard,$g$
 if not (
 coalesce(auth.role(),'')='service_role'
 or (session_user='postgres' and coalesce(current_setting('role',true),'none') in ('none','postgres')
     and coalesce(auth.role(),'')='')
 ) then raise exception 'Trusted backend required'; end if;
 $g$);
 definition:=replace(definition,'return doc;',$g$
 update private.invoice_s3_confirmations
 set confirmation_channel=case when coalesce(auth.role(),'')='service_role' then 'edge_function' else 'administrative_connector' end,
 confirmed_by_session=session_user
 where document_id=doc;
 return doc;
 $g$);
 execute definition;
end $migration$;
-- No grants to anon/authenticated. Database login is server-established, not user JSON.
revoke all on function public.confirm_invoice_s3_document(uuid,text,text,text,bigint,text,text) from public,anon,authenticated;

;
