-- Assignment System Migration
-- Adds tables for teacher-created assignments with deadlines and submissions

-- Assignments table
CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,  -- Markdown content
    created_by TEXT NOT NULL,   -- teacher_id
    created_at TEXT NOT NULL,
    
    -- Open/Close control
    status TEXT NOT NULL DEFAULT 'closed',  -- 'open', 'closed'
    opened_at TEXT,             -- When manually opened
    
    -- Deadline options
    deadline_type TEXT NOT NULL DEFAULT 'specific',  -- 'specific', 'duration'
    deadline_datetime TEXT,     -- Specific datetime (ISO 8601)
    deadline_duration_hours INTEGER,   -- Duration in hours from open time
    deadline_duration_minutes INTEGER, -- Duration in minutes from open time
    
    -- Auto-close when deadline reached
    auto_close BOOLEAN DEFAULT 1,
    
    -- Attachments
    image_path TEXT,            -- Path to uploaded image
    
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Assignment submissions table
CREATE TABLE IF NOT EXISTS assignment_submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    
    -- Submission content
    content TEXT NOT NULL,      -- Student's answer (markdown)
    image_path TEXT,            -- Optional image attachment from student
    
    -- Timing
    submitted_at TEXT NOT NULL,
    is_late BOOLEAN DEFAULT 0,  -- Submitted after deadline
    
    -- Grading
    score REAL,                 -- Optional score
    feedback TEXT,              -- Teacher feedback (markdown)
    graded_at TEXT,
    graded_by TEXT,             -- teacher_id
    
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL,
    
    -- One submission per student per assignment
    UNIQUE(assignment_id, student_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_assignments_created_by ON assignments(created_by);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student ON assignment_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_course ON assignment_submissions(course_id);
