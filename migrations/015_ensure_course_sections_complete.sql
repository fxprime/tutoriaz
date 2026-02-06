-- Migration 015: Ensure course_sections table is complete for tag management
-- This migration is idempotent and can run on fresh or existing databases

-- Ensure the table exists with all columns (idempotent)
CREATE TABLE IF NOT EXISTS course_sections (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    section_title TEXT NOT NULL,
    page_url TEXT,
    section_order INTEGER DEFAULT 0,
    parent_section TEXT,
    is_quiz_trigger INTEGER DEFAULT 0 CHECK(is_quiz_trigger IN (0, 1)),
    quiz_id TEXT,
    chapter_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL,
    UNIQUE(course_id, section_id)
);

-- Ensure all indexes exist (idempotent)
CREATE INDEX IF NOT EXISTS idx_course_sections_course ON course_sections(course_id);
CREATE INDEX IF NOT EXISTS idx_course_sections_order ON course_sections(course_id, section_order);
CREATE INDEX IF NOT EXISTS idx_course_sections_chapter ON course_sections(course_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_course_sections_quiz_trigger ON course_sections(course_id, is_quiz_trigger);
