-- Migration: Add student quiz queue table
-- This tracks which quizzes each student has in their personal queue

CREATE TABLE IF NOT EXISTS student_quiz_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    push_id TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    position INTEGER,
    status TEXT DEFAULT 'pending', -- pending, viewing, answered, removed
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (push_id) REFERENCES quiz_pushes(id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
    UNIQUE(user_id, push_id)
);

CREATE INDEX IF NOT EXISTS idx_student_queue ON student_quiz_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_push_queue ON student_quiz_queue(push_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_queue ON student_quiz_queue(quiz_id, status);
