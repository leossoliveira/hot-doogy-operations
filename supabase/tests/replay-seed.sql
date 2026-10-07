-- Synthetic replay prerequisites. Literal labels are required by the historical migration.
insert into public.organizations(id,name,slug) values ('6013ed02-626a-497c-b951-619069035532','Hot Doogy Franchising Corporation','isolated-replay');
insert into public.menu_items(id,organization_id,name) values ('00000000-0000-4000-8000-000000000100','6013ed02-626a-497c-b951-619069035532','Fountain Soda');
