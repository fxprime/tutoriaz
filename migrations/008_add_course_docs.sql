-- Migration: Add documentation repository fields to courses table

ALTER TABLE courses ADD COLUMN docs_repo_url TEXT;
ALTER TABLE courses ADD COLUMN docs_branch TEXT DEFAULT 'main';
ALTER TABLE courses ADD COLUMN docs_build_cmd TEXT DEFAULT 'mkdocs build';
ALTER TABLE courses ADD COLUMN docs_output_dir TEXT DEFAULT 'site';

-- Create index for docs lookups
CREATE INDEX IF NOT EXISTS idx_courses_docs ON courses(docs_repo_url);