-- Supabase Migration: Fase 4 - Detailing Pengeluaran (Rincian Belanja)

-- 1. Tambah kolom unit, department, dan notes ke tabel receipt_items jika belum ada
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receipt_items' AND column_name = 'unit') THEN
    ALTER TABLE receipt_items ADD COLUMN unit VARCHAR(50) DEFAULT 'unit';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receipt_items' AND column_name = 'department') THEN
    ALTER TABLE receipt_items ADD COLUMN department VARCHAR(50) DEFAULT 'Kafe';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receipt_items' AND column_name = 'notes') THEN
    ALTER TABLE receipt_items ADD COLUMN notes TEXT;
  END IF;
END $$;

-- 2. Index untuk pencarian cepat per department / divisi
CREATE INDEX IF NOT EXISTS idx_receipt_items_department ON receipt_items(department);
