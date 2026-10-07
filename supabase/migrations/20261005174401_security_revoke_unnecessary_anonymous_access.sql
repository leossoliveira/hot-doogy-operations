revoke execute on function public.confirm_purchase_receipt(uuid) from public, anon;
grant execute on function public.confirm_purchase_receipt(uuid) to authenticated;
revoke all privileges on table public.location_menu_items from public, anon;
;
