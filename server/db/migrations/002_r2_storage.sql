-- Rename filename to storage_key; recordings now live in R2, not local disk
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recordings' AND column_name = 'filename'
  ) THEN
    ALTER TABLE recordings RENAME COLUMN filename TO storage_key;
  END IF;
END $$;
