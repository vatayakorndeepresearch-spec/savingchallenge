-- ล้างข้อมูลทั้งหมดในตาราง transactions และ budgets
-- คำเตือน: ข้อมูลจะถูกลบออกทั้งหมดและไม่สามารถกู้คืนได้

-- 1) ล้างข้อมูลในตาราง transactions และรีเซ็ตลำดับ (id)
TRUNCATE TABLE public.transactions RESTART IDENTITY CASCADE;

-- 2) ล้างข้อมูลในตาราง budgets
TRUNCATE TABLE public.budgets RESTART IDENTITY CASCADE;

-- (เพิ่มเติม) หากต้องการลบรายชื่อรูปภาพใน Storage ด้วย:
-- DELETE FROM storage.objects WHERE bucket_id = 'receipts';

-- หมายเหตุ: การใช้ TRUNCATE จะล้างข้อมูลทุก Owner (ทั้ง bear และ rabbit)
