-- Run this in the Supabase SQL editor if you want a dedicated private `expenses`
-- bucket for receipt storage (separate from the public checklist-photos bucket).
-- Currently, receipts and NA photos use checklist-photos (public bucket that already exists).

-- 1. Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expenses',
  'expenses',
  false,
  26214400,
  ARRAY['image/jpeg','image/png','image/heic','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow anonymous uploads (runners have no login)
CREATE POLICY IF NOT EXISTS "anon_insert_expenses"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'expenses');

-- 3. Allow anonymous reads (needed for signed URL generation to work)
CREATE POLICY IF NOT EXISTS "anon_select_expenses"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'expenses');
