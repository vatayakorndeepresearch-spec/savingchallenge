-- Add batch tracking columns for multi-slip uploads
alter table public.transactions
add column if not exists batch_id text;

alter table public.transactions
add column if not exists source_file_name text;

create index if not exists idx_transactions_batch_id
on public.transactions(batch_id);
