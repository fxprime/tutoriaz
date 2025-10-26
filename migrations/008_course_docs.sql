-- Migration: Add documentation fields to courses table
-- This allows each course to link to its own documentation repository

-- Check if columns exist before adding them
PRAGMA table_info(courses);

-- Add columns (will fail silently if they already exist in newer SQLite)
BEGIN;
  ALTER TABLE courses ADD COLUMN docs_repo_url TEXT;
  ALTER TABLE courses ADD COLUMN docs_branch TEXT DEFAULT 'main';  
  ALTER TABLE courses ADD COLUMN docs_path TEXT DEFAULT 'docs';
COMMIT;

-- Create index for documentation lookups
CREATE INDEX IF NOT EXISTS idx_courses_docs ON courses(docs_repo_url);