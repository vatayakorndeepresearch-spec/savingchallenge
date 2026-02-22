-- Add jar_key to transactions for deterministic 4-jar mapping
alter table public.transactions
add column if not exists jar_key text
check (jar_key in ('expense','saving','investment','debt'));

-- Backfill existing expense rows by category mapping
update public.transactions
set jar_key = case
  when type <> 'expense' then null
  when lower(category) in ('saving (ออม)', 'saving') then 'saving'
  when lower(category) in ('investment (ลงทุน)', 'investment') then 'investment'
  when lower(category) in ('debt (หนี้)', 'debt') then 'debt'
  when lower(category) like '%ออม%' or lower(category) like '%saving%' then 'saving'
  when lower(category) like '%ลงทุน%' or lower(category) like '%investment%' then 'investment'
  when lower(category) like '%หนี้%' or lower(category) like '%debt%' then 'debt'
  else 'expense'
end
where jar_key is null;

-- Helpful index for monthly 4-jar summaries
create index if not exists idx_transactions_owner_date_jar
on public.transactions(owner, date, jar_key);
