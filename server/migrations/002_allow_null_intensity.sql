-- Forward migration for installations created with 001_init.sql before nullable intensity.
-- Existing numeric values are preserved; the existing CHECK already accepts SQL NULL.
ALTER TABLE records MODIFY COLUMN intensity INT NULL;
