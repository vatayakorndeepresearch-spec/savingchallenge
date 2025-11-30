-- Clear existing transactions (optional, use carefully!)
-- delete from public.transactions;

-- Insert Mock Data for Bear 🐻 (Consistent Logger)
-- Logged every day for the last 5 days
insert into public.transactions (type, amount, category, date, owner, note) values
('expense', 100, 'Food', current_date, 'bear', 'Lunch'),
('expense', 150, 'Transport', current_date - 1, 'bear', 'BTS'),
('expense', 200, 'Food', current_date - 2, 'bear', 'Dinner'),
('expense', 50, 'Food', current_date - 3, 'bear', 'Snack'),
('income', 1000, 'Other', current_date - 4, 'bear', 'Refund');

-- Insert Mock Data for Rabbit 🐰 (Missed a day)
-- Logged today, missed yesterday, logged 2 days ago
insert into public.transactions (type, amount, category, date, owner, note) values
('expense', 120, 'Food', current_date, 'rabbit', 'Lunch'),
-- Missed current_date - 1
('expense', 300, 'Shopping', current_date - 2, 'rabbit', 'Clothes'),
('expense', 80, 'Food', current_date - 3, 'rabbit', 'Breakfast');

-- Insert Luxury items to test "No Luxury Streak"
-- Bear bought luxury 5 days ago (Streak should be 4)
insert into public.transactions (type, amount, category, date, owner, note) values
('expense', 5000, 'Luxury', current_date - 5, 'bear', 'New Game');

-- Rabbit bought luxury today (Streak should be 0)
insert into public.transactions (type, amount, category, date, owner, note) values
('expense', 2000, 'Luxury', current_date, 'rabbit', 'Perfume');
