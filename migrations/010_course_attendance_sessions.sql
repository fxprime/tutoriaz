-- Migration: enforce single active course attendance per student

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
