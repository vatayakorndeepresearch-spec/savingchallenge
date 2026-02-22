# Couple Saving Lite 💖

A minimal savings-tracking app for couples, built with SvelteKit and Supabase.

## Features

- **Dashboard**: Monthly summary, budget status, and saving score.
- **4-Jar Auto-Allocation**: Split income into Expense/Saving/Investment/Debt with 40/20/20/20 guidance.
- **Add Transaction**: Record income/expense with categories and receipt images.
- **Bulk Slip Upload**: Upload many slips in one round, OCR each slip, edit each row, then save as a batch.
- **Slip OCR Autofill**: When uploading a slip image, auto-detect amount/date/note and prefill the form.
- **Actionable Analytics**: See Saving/Investment/Debt gaps and jump to prefilled add form actions.
- **AI Assist**: MiniMax ช่วยจัดหมวดจากโน้ตและโค้ชนิสัยการเงิน พร้อม fallback เมื่อ AI ใช้งานไม่ได้.
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
   MINIMAX_API_KEY=your_minimax_api_key
   APP_PASSCODE=928461
   # Optional
   # MINIMAX_BASE_URL=https://api.minimax.io/v1
   # MINIMAX_MODEL=MiniMax-M2.5
   ```
   Notes:
   - `/api/classify-note` and `/api/financial-coach` can be used without auth in no-auth mode.
   - If `APP_PASSCODE` is set (digits only), users must enter this passcode at `/unlock` before using the app/API.

3. **Database Setup**
   Run the SQL commands in `schema.sql` in your Supabase SQL Editor to create the tables and storage bucket.
   If your DB is already running on an older schema:
   - Run `add_jar_key.sql` to add and backfill `transactions.jar_key`.
   - Run `add_ocr_metadata.sql` to add `ocr_raw_text` and `ocr_confidence`.
   - Run `add_batch_columns.sql` to support multi-slip batch tracking (`batch_id`, `source_file_name`).
   - Run `secure_rls.sql` before production to enforce owner-based RLS policies.
   - If you want no-auth usage, run `no_auth_mode.sql` after schema/migrations.
   - `secure_rls.sql` expects authenticated users and owner values aligned with `auth.uid()` or `auth.jwt()->>'owner'`.
   - `no_auth_mode.sql` is still recommended only for personal/private deployments.

4. **Run Locally**
   ```bash
   npm run dev
   ```

5. **Run Tests**
   ```bash
   npm test
   ```

## License

Personal Use Only.
