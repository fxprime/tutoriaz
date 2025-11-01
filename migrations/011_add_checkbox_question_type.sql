-- Add 'checkbox' question type to quizzes table
-- This migration updates the CHECK constraint to allow 'checkbox' as a question type
-- Checkbox questions support multiple correct answers stored as JSON array

-- SQLite doesn't support ALTER COLUMN directly, so we need to:
-- 1. Create a new table with the updated constraint
-- 2. Copy data from old table
-- 3. Drop old table
-- 4. Rename new table

BEGIN TRANSACTION;

-- Create new table with updated constraint
CREATE TABLE IF NOT EXISTS quizzes_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_text TEXT,
    images TEXT,
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'select', 'checkbox')),
    options TEXT,
    correct_answer TEXT,
    course_id TEXT,
    category_id TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT FALSE,
    timeout_seconds INTEGER,
    is_scored INTEGER DEFAULT 1 CHECK(is_scored IN (0, 1)),
    points INTEGER DEFAULT 1 CHECK(points >= 0),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (category_id) REFERENCES quiz_categories(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Copy all data from old table
INSERT INTO quizzes_new SELECT * FROM quizzes;

-- Drop old table
DROP TABLE quizzes;

-- Rename new table
ALTER TABLE quizzes_new RENAME TO quizzes;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_quizzes_created_by ON quizzes(created_by);
CREATE INDEX IF NOT EXISTS idx_quizzes_course ON quizzes(course_id);

COMMIT;
