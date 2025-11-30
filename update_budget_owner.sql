-- Add owner column to budgets table
alter table public.budgets 
add column if not exists owner text default 'bear';

-- Update existing rows to have a default owner
update public.budgets 
set owner = 'bear' 
where owner is null;

-- Drop existing unique constraint
alter table public.budgets
drop constraint if exists budgets_year_month_key;

-- Add new unique constraint including owner
alter table public.budgets
add constraint budgets_year_month_owner_key unique (year, month, owner);
