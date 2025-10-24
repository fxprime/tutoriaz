-- Migration: track course on quiz pushes

ALTER TABLE quiz_pushes ADD COLUMN course_id TEXT;

CREATE INDEX IF NOT EXISTS idx_quiz_pushes_course_id ON quiz_pushes(course_id);

UPDATE quiz_pushes
SET course_id = (
    SELECT course_id FROM quizzes WHERE quizzes.id = quiz_pushes.quiz_id
)
WHERE course_id IS NULL;
