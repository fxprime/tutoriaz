-- Migration 013: Add Reading Progress Tracking Tables
-- Similar to Udemy's progress tracking system

-- Table to track section reading progress
CREATE TABLE IF NOT EXISTS reading_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    section_title TEXT,
    page_url TEXT,
    completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    session_id TEXT,
    time_spent_seconds INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id, section_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_course 
ON reading_progress(user_id, course_id);

CREATE INDEX IF NOT EXISTS idx_reading_progress_course 
ON reading_progress(course_id);

CREATE INDEX IF NOT EXISTS idx_reading_progress_session 
ON reading_progress(session_id);

-- Table to define course structure and sections
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL,
    UNIQUE(course_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_course_sections_course 
ON course_sections(course_id);

CREATE INDEX IF NOT EXISTS idx_course_sections_order 
ON course_sections(course_id, section_order);

-- Table to track overall course progress percentage
CREATE TABLE IF NOT EXISTS course_progress_summary (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    total_sections INTEGER DEFAULT 0,
    completed_sections INTEGER DEFAULT 0,
    progress_percentage REAL DEFAULT 0.0,
    last_accessed_at DATETIME,
    first_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    estimated_completion_date DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_progress_user 
ON course_progress_summary(user_id);

CREATE INDEX IF NOT EXISTS idx_course_progress_course 
ON course_progress_summary(course_id);

-- Table to track reading sessions (like Udemy's time tracking)
CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    total_time_seconds INTEGER DEFAULT 0,
    sections_viewed TEXT, -- JSON array of section IDs viewed in this session
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_course 
ON reading_sessions(user_id, course_id);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_session_id 
ON reading_sessions(session_id);

-- Table to track quiz triggers from reading progress
CREATE TABLE IF NOT EXISTS reading_quiz_triggers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    quiz_id TEXT,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    quiz_taken INTEGER DEFAULT 0 CHECK(quiz_taken IN (0, 1)),
    quiz_taken_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_quiz_triggers_user 
ON reading_quiz_triggers(user_id, quiz_taken);

CREATE INDEX IF NOT EXISTS idx_reading_quiz_triggers_course 
ON reading_quiz_triggers(course_id);
