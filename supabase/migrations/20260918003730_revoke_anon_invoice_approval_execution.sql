revoke execute on function public.approve_invoice(uuid) from public;
revoke execute on function public.approve_invoice(uuid) from anon;
grant execute on function public.approve_invoice(uuid) to authenticated;
;
