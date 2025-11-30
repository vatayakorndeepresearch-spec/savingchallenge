# Couple Saving Lite 💖

A minimal savings-tracking app for couples, built with SvelteKit and Supabase.

## Features

- **Dashboard**: Monthly summary, budget status, and saving score.
- **Add Transaction**: Record income/expense with categories and receipt images.
- **Transactions List**: View history by month.
- **Budgeting**: Set monthly budget goals.
- **Analytics**: Simple breakdown of expenses and saving rate.
- **Game/Streak**: Track logging consistency and "no-luxury" streaks.

## Tech Stack

- SvelteKit + TypeScript
- Vite
- Tailwind CSS
- Supabase (Postgres + Storage)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Database Setup**
   Run the SQL commands in `schema.sql` in your Supabase SQL Editor to create the tables and storage bucket.

4. **Run Locally**
   ```bash
   npm run dev
   ```

## License

Personal Use Only.
