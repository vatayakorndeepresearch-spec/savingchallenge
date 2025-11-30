-- Add indices to improve query performance
-- Since we filter by owner and date frequently, these indices are crucial.

create index if not exists idx_transactions_owner on public.transactions(owner);
create index if not exists idx_transactions_date on public.transactions(date);
create index if not exists idx_transactions_owner_date on public.transactions(owner, date);

-- Add index for budgets lookup
create index if not exists idx_budgets_owner_year_month on public.budgets(owner, year, month);
