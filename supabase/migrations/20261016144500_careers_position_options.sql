-- Careers: the form offers only Crew Member (team_member) and Manager, so the
-- database accepts only those two. No stored row used the removed values.
alter table public.careers_applications drop constraint careers_applications_position_check;
alter table public.careers_applications add constraint careers_applications_position_check
 check (position in ('team_member','manager'));
