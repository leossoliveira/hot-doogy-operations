-- Careers: English proficiency answers are now None, Basic, Intermediate and
-- Fluent. Stored rows only used basic and fluent when this was applied, so
-- conversational and native are dropped.
alter table public.careers_applications drop constraint careers_applications_english_proficiency_check;
alter table public.careers_applications add constraint careers_applications_english_proficiency_check
 check (english_proficiency in ('none','basic','intermediate','fluent'));
