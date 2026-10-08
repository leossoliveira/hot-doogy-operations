-- Separate transaction: PostgreSQL enum additions must commit before use.
alter type public.member_role add value if not exists 'staff';
