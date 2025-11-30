-- Add owner column to transactions table
alter table public.transactions 
add column if not exists owner text default 'bear';

-- Update existing rows to have a default owner (optional, but good for consistency)
update public.transactions 
set owner = 'bear' 
where owner is null;
