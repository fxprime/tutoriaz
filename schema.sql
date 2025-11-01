-- Initialize database schema for ESP32 course platform

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Quiz categories/folders table
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    access_code_hash TEXT,
    docs_repo_url TEXT,
    docs_branch TEXT DEFAULT 'main',
    docs_build_cmd TEXT DEFAULT 'mkdocs build',
    docs_output_dir TEXT DEFAULT 'site',
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_courses_docs ON courses(docs_repo_url);

CREATE TABLE IF NOT EXISTS course_enrollments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, student_id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_student ON course_enrollments(student_id);

CREATE TABLE IF NOT EXISTS course_attendance_sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('viewing','not_viewing','ended')),
    started_at TEXT NOT NULL,
    last_status_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY(student_id) REFERENCES users(id),
    FOREIGN KEY(course_id) REFERENCES courses(id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_student ON course_attendance_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_active ON course_attendance_sessions(student_id, status);

CREATE TABLE IF NOT EXISTS quiz_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id TEXT,
    course_id TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES quiz_categories(id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_categories_course ON quiz_categories(course_id);

-- Quizzes table
CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_text TEXT,
    images TEXT, -- JSON array of image URLs
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'select', 'checkbox')),
    options TEXT, -- JSON array for select/checkbox type questions
    correct_answer TEXT, -- The correct answer for grading (JSON array for checkbox)
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

CREATE INDEX IF NOT EXISTS idx_quizzes_created_by ON quizzes(created_by);
CREATE INDEX IF NOT EXISTS idx_quizzes_course ON quizzes(course_id);

-- Quiz pushes (instances when quiz is sent to students)
CREATE TABLE IF NOT EXISTS quiz_pushes (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    pushed_by TEXT NOT NULL,
    pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    undone_at DATETIME,
    target_scope TEXT NOT NULL, -- JSON: 'all' or array of user_ids
    timeout_seconds INTEGER,
    course_id TEXT,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
    FOREIGN KEY (pushed_by) REFERENCES users(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_pushes_quiz_id ON quiz_pushes(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_pushes_course_id ON quiz_pushes(course_id);

-- Quiz responses
CREATE TABLE IF NOT EXISTS quiz_responses (
    id TEXT PRIMARY KEY,
    push_id TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    answer_text TEXT,
    started_at DATETIME,
    answered_at DATETIME,
    elapsed_ms INTEGER,
    status TEXT NOT NULL CHECK (status IN ('answered', 'timeout', 'ignored')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (push_id) REFERENCES quiz_pushes(id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_responses_push_id ON quiz_responses(push_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_user_id ON quiz_responses(user_id);

-- Student quiz queue table (tracks which quizzes each student has pending)
CREATE TABLE IF NOT EXISTS student_quiz_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    push_id TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    course_id TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    first_viewed_at DATETIME, -- When student first viewed this quiz (for timeout calculation)
    position INTEGER,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'viewing', 'answered', 'removed')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (push_id) REFERENCES quiz_pushes(id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    UNIQUE(user_id, push_id)
);

CREATE INDEX IF NOT EXISTS idx_student_queue ON student_quiz_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_push_queue ON student_quiz_queue(push_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_queue ON student_quiz_queue(quiz_id, status);
CREATE INDEX IF NOT EXISTS idx_student_queue_course ON student_quiz_queue(course_id);

-- Insert default teacher account (password: admin123)
INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role) 
VALUES (
    'teacher-001', 
    'teacher', 
    'Teacher', 
    '$2a$10$Sj0hRP6rfM06jngJCqH/k.W3o1a6gV87tygIDU1/A1rICzL6Isg1O',
    'teacher'
);

-- Insert sample students (password: student123)
INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role) 
VALUES 
    ('student-001', 'student1', 'Student 1', '$2a$10$It4R8SIghGFG6ipLnwD.le6/gXWGRMJtFt6fHf8/WNyo8pRiqeVRi', 'student'),
    ('student-002', 'student2', 'Student 2', '$2a$10$It4R8SIghGFG6ipLnwD.le6/gXWGRMJtFt6fHf8/WNyo8pRiqeVRi', 'student'),
    ('student-003', 'student3', 'Student 3', '$2a$10$It4R8SIghGFG6ipLnwD.le6/gXWGRMJtFt6fHf8/WNyo8pRiqeVRi', 'student');

-- Insert default quiz categories
INSERT OR IGNORE INTO quiz_categories (id, name, description, created_by) 
VALUES 
    ('cat-basics', 'ESP32 Basics', 'Introduction to ESP32 development', 'teacher-001'),
    ('cat-sensors', 'Sensors & Input', 'Working with sensors and input devices', 'teacher-001'),
    ('cat-connectivity', 'Connectivity', 'WiFi, Bluetooth, and communication', 'teacher-001'),
    ('cat-projects', 'Projects', 'Hands-on projects and applications', 'teacher-001');