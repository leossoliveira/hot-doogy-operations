-- Human review determines the financial classification; the original model result
-- remains unchanged in invoices.extraction.result for audit and review.
-- Preserve scope/MFA checks, explicit document review, provenance and approval gates.
do $migration$
declare
 definition text := pg_get_functiondef('public.save_llm_invoice_draft(uuid,jsonb)'::regprocedure);
 old_gate text := $old$if p_payload->>'documentKind' is distinct from 'invoice' or p_payload->>'documentReviewed' is distinct from 'true' or p_payload->'extraction'->>'document_type' is distinct from 'invoice' then raise exception 'A reviewed financial invoice is required';end if;$old$;
 new_gate text := $new$if p_payload->>'documentKind' is distinct from 'invoice' or p_payload->>'documentReviewed' is distinct from 'true' then raise exception 'A reviewed financial invoice is required';end if;$new$;
begin
 if strpos(definition,old_gate)=0 then raise exception 'Unexpected invoice document review gate';end if;
 execute replace(definition,old_gate,new_gate);
end $migration$;
