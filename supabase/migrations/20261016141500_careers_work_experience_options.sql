-- Careers: the form now asks work experience with three answers:
-- "This would be my first job" (first_job), "I have some experience"
-- (some_experience) and "I have several years of experience" (several_years).
-- Only first_job existed in stored rows when this was applied, so the previous
-- values (under_1_year, 1_3_years, 3_plus_years) are dropped.
alter table public.careers_applications drop constraint careers_applications_work_experience_check;
alter table public.careers_applications add constraint careers_applications_work_experience_check
 check (work_experience in ('first_job','some_experience','several_years'));
