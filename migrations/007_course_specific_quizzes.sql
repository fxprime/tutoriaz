-- Migration: Make quizzes, categories, and student queue course-specific

ALTER TABLE quiz_categories ADD COLUMN course_id TEXT;
ALTER TABLE quizzes ADD COLUMN course_id TEXT;
ALTER TABLE student_quiz_queue ADD COLUMN course_id TEXT;

-- Indexes to keep course specific lookups fast
CREATE INDEX IF NOT EXISTS idx_quiz_categories_course ON quiz_categories(course_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_course ON quizzes(course_id);
CREATE INDEX IF NOT EXISTS idx_student_queue_course ON student_quiz_queue(course_id);
