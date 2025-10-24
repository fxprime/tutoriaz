-- Migration: Add first_viewed_at to student_quiz_queue
-- This prevents timeout refresh exploit by tracking when student first viewed the quiz

ALTER TABLE student_quiz_queue ADD COLUMN first_viewed_at DATETIME;

-- Update existing rows to set first_viewed_at = added_at for viewing status
UPDATE student_quiz_queue 
SET first_viewed_at = added_at 
WHERE status = 'viewing' AND first_viewed_at IS NULL;
