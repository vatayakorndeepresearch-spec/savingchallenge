-- Add OCR debug metadata columns to transactions
alter table public.transactions
add column if not exists ocr_raw_text text;

alter table public.transactions
add column if not exists ocr_confidence numeric(5,2);
