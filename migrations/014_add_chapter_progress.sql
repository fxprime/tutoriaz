-- Migration 014: Add Chapter-Based Progress Support
-- Adds support for chapter-level progress tracking

-- Add chapter_id to course_sections
ALTER TABLE course_sections ADD COLUMN chapter_id TEXT;

-- Add progress_data JSON column to reading_progress for storing complete progress snapshots
ALTER TABLE reading_progress ADD COLUMN progress_data TEXT;

-- Add chapter_progress JSON column to course_progress_summary
ALTER TABLE course_progress_summary ADD COLUMN chapter_progress TEXT;

-- Index for chapter lookups
CREATE INDEX IF NOT EXISTS idx_course_sections_chapter 
ON course_sections(course_id, chapter_id);
