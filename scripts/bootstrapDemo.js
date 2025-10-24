#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

const DEFAULT_CONFIG = {
    wipeExisting: true,
    seedQuizzes: true,
    teacher: {
        id: 'teacher-001',
        username: 'teacher',
        displayName: 'Teacher',
        password: 'admin123'
    },
    students: {
        count: 50,
        prefix: 'student',
        displayPrefix: 'Student',
        startIndex: 1,
        password: 'student123'
    },
    course: {
        title: 'ESP32 Fundamentals',
        description: 'Demo classroom course for quick lobby testing.',
        passkey: 'JOIN-ESP32',
        enrollAll: false
    }
};

const QUIZ_SECTIONS = [
    {
        name: 'Mathematics',
        quizzes: [
            {
                title: 'Algebra Warmup',
                content_text: 'Solve for x: 2x + 5 = 17.',
                question_type: 'text',
                options: [],
                correct_answer: '6',
                timeout_seconds: 90
            },
            {
                title: 'Fractions Refresher',
                content_text: 'What is 3/4 expressed as a percentage?',
                question_type: 'select',
                options: ['65%', '70%', '75%', '80%'],
                correct_answer: '75%',
                timeout_seconds: 75
            },
            {
                title: 'Geometry Quick Check',
                content_text: 'A triangle has sides 3cm, 4cm, 5cm. Is it a right triangle?',
                question_type: 'select',
                options: ['True', 'False'],
                correct_answer: 'True',
                timeout_seconds: 60
            }
        ]
    },
    {
        name: 'Science',
        quizzes: [
            {
                title: 'States of Matter',
                content_text: 'Which state of matter has a definite volume but no definite shape?',
                question_type: 'select',
                options: ['Solid', 'Liquid', 'Gas', 'Plasma'],
                correct_answer: 'Liquid',
                timeout_seconds: 60
            },
            {
                title: 'Photosynthesis Basics',
                content_text: 'Name the gas plants absorb from the atmosphere during photosynthesis.',
                question_type: 'text',
                options: [],
                correct_answer: 'Carbon dioxide',
                timeout_seconds: 80
            }
        ]
    },
    {
        name: 'History',
        quizzes: [
            {
                title: 'World War II Dates',
                content_text: 'In what year did World War II end?',
                question_type: 'select',
                options: ['1943', '1944', '1945', '1946'],
                correct_answer: '1945',
                timeout_seconds: 70
            },
            {
                title: 'Ancient Civilizations',
                content_text: 'The Pyramids of Giza were built in which ancient civilization?',
                question_type: 'text',
                options: [],
                correct_answer: 'Egyptian',
                timeout_seconds: 75
            }
        ]
    },
    {
        name: 'Language Arts',
        quizzes: [
            {
                title: 'Parts of Speech',
                content_text: 'Identify the part of speech for the underlined word: "She quickly finished her homework." (quickly)',
                question_type: 'select',
                options: ['Noun', 'Verb', 'Adverb', 'Adjective'],
                correct_answer: 'Adverb',
                timeout_seconds: 65
            },
            {
                title: 'Literary Devices',
                content_text: 'What literary device is used in the phrase "The classroom was a zoo"?',
                question_type: 'text',
                options: [],
                correct_answer: 'Metaphor',
                timeout_seconds: 85
            }
        ]
    }
];

function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function readValue(arg, prefix) {
    return arg.startsWith(prefix) ? arg.slice(prefix.length) : null;
}

function parseArgs(argv) {
    const config = cloneDefaults();

    argv.forEach(arg => {
        if (arg === '--keep-db') {
            config.wipeExisting = false;
            return;
        }
        if (arg === '--skip-quizzes') {
            config.seedQuizzes = false;
            return;
        }
        if (arg === '--enroll-all') {
            config.course.enrollAll = true;
            return;
        }

        const teacherUser = readValue(arg, '--teacher-username=');
        if (teacherUser) {
            config.teacher.username = teacherUser;
            return;
        }
        const teacherPass = readValue(arg, '--teacher-password=');
        if (teacherPass) {
            config.teacher.password = teacherPass;
            return;
        }
        const teacherDisplay = readValue(arg, '--teacher-display=');
        if (teacherDisplay) {
            config.teacher.displayName = teacherDisplay;
            return;
        }
        const studentCount = readValue(arg, '--student-count=');
        if (studentCount) {
            const parsed = parseInt(studentCount, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                config.students.count = parsed;
            }
            return;
        }
        const studentPrefix = readValue(arg, '--student-prefix=');
        if (studentPrefix) {
            config.students.prefix = studentPrefix;
            return;
        }
        const studentStart = readValue(arg, '--student-start=');
        if (studentStart) {
            const parsed = parseInt(studentStart, 10);
            if (!Number.isNaN(parsed) && parsed >= 0) {
                config.students.startIndex = parsed;
            }
            return;
        }
        const studentPassword = readValue(arg, '--student-password=');
        if (studentPassword) {
            config.students.password = studentPassword;
            return;
        }
        const displayPrefix = readValue(arg, '--student-display-prefix=');
        if (displayPrefix) {
            config.students.displayPrefix = displayPrefix;
            return;
        }
        const courseTitle = readValue(arg, '--course-title=');
        if (courseTitle) {
            config.course.title = courseTitle;
            return;
        }
        const courseDescription = readValue(arg, '--course-description=');
        if (courseDescription) {
            config.course.description = courseDescription;
            return;
        }
        const coursePasskey = readValue(arg, '--course-passkey=');
        if (coursePasskey !== null) {
            config.course.passkey = coursePasskey;
        }
    });

    return config;
}

function openDatabase() {
    return new sqlite3.Database(DB_PATH);
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function applySchema(db) {
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await exec(db, schemaSql);

    const courseSql = `
        CREATE TABLE IF NOT EXISTS courses (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            access_code_hash TEXT,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS course_enrollments (
            id TEXT PRIMARY KEY,
            course_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            enrolled_at TEXT NOT NULL,
            UNIQUE(course_id, student_id),
            FOREIGN KEY(course_id) REFERENCES courses(id),
            FOREIGN KEY(student_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);
        CREATE INDEX IF NOT EXISTS idx_course_enrollments_student ON course_enrollments(student_id);
    `;

    await exec(db, courseSql);
}

async function upsertTeacher(db, teacherConfig) {
    const passwordHash = await bcrypt.hash(teacherConfig.password, 10);
    const now = new Date().toISOString();

    await run(
        db,
        'DELETE FROM users WHERE username = ? AND id != ?',
        [teacherConfig.username, teacherConfig.id]
    );

    const existing = await get(db, 'SELECT id FROM users WHERE id = ?', [teacherConfig.id]);

    if (existing) {
        await run(
            db,
            `UPDATE users
             SET username = ?, display_name = ?, password_hash = ?, role = 'teacher'
             WHERE id = ?`,
            [teacherConfig.username, teacherConfig.displayName, passwordHash, teacherConfig.id]
        );
    } else {
        await run(
            db,
            `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
             VALUES (?, ?, ?, ?, 'teacher', ?)` ,
            [teacherConfig.id, teacherConfig.username, teacherConfig.displayName, passwordHash, now]
        );
    }

    return {
        id: teacherConfig.id,
        username: teacherConfig.username,
        password: teacherConfig.password,
        displayName: teacherConfig.displayName
    };
}

async function resetStudents(db) {
    await run(db, "DELETE FROM users WHERE role = 'student'");
}

async function createStudents(db, studentsConfig) {
    await resetStudents(db);

    const passwordHash = await bcrypt.hash(studentsConfig.password, 10);
    const now = new Date().toISOString();
    const created = [];

    for (let i = 0; i < studentsConfig.count; i += 1) {
        const index = studentsConfig.startIndex + i;
        const id = uuidv4();
        const username = `${studentsConfig.prefix}${index}`;
        const displayName = `${studentsConfig.displayPrefix} ${index}`;

        await run(
            db,
            `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
             VALUES (?, ?, ?, ?, 'student', ?)` ,
            [id, username, displayName, passwordHash, now]
        );

        created.push({ id, username, displayName });
    }

    return {
        password: studentsConfig.password,
        created
    };
}

async function ensureCourse(db, courseConfig, teacherId) {
    const now = new Date().toISOString();
    const accessCodeHash = courseConfig.passkey ? await bcrypt.hash(courseConfig.passkey, 10) : null;

    const existing = await get(
        db,
        'SELECT id FROM courses WHERE created_by = ? AND title = ?',
        [teacherId, courseConfig.title]
    );

    if (existing) {
        await run(
            db,
            `UPDATE courses
             SET description = ?, access_code_hash = ?
             WHERE id = ?`,
            [courseConfig.description || '', accessCodeHash, existing.id]
        );

        return { id: existing.id, isNew: false };
    }

    const courseId = uuidv4();
    await run(
        db,
        `INSERT INTO courses (id, title, description, created_by, created_at, access_code_hash)
         VALUES (?, ?, ?, ?, ?, ?)` ,
        [courseId, courseConfig.title, courseConfig.description || '', teacherId, now, accessCodeHash]
    );

    return { id: courseId, isNew: true };
}

async function enrollStudents(db, courseId) {
    const students = await all(
        db,
        "SELECT id, username FROM users WHERE role = 'student' ORDER BY username"
    );

    let enrolled = 0;
    for (const student of students) {
        const existing = await get(
            db,
            'SELECT id FROM course_enrollments WHERE course_id = ? AND student_id = ?',
            [courseId, student.id]
        );

        if (existing) {
            continue;
        }

        await run(
            db,
            `INSERT INTO course_enrollments (id, course_id, student_id, enrolled_at)
             VALUES (?, ?, ?, ?)` ,
            [uuidv4(), courseId, student.id, new Date().toISOString()]
        );
        enrolled += 1;
    }

    return enrolled;
}

async function ensureCategory(db, name, teacherId, courseId) {
    const courseMatch = await get(
        db,
        'SELECT id FROM quiz_categories WHERE name = ? AND created_by = ? AND course_id = ?',
        [name, teacherId, courseId]
    );

    if (courseMatch) {
        return courseMatch.id;
    }

    const legacy = await get(
        db,
        'SELECT id FROM quiz_categories WHERE name = ? AND created_by = ? AND course_id IS NULL',
        [name, teacherId]
    );

    if (legacy) {
        await run(
            db,
            'UPDATE quiz_categories SET course_id = ? WHERE id = ?',
            [courseId, legacy.id]
        );
        return legacy.id;
    }

    const categoryId = uuidv4();
    await run(
        db,
        'INSERT INTO quiz_categories (id, name, course_id, created_by) VALUES (?, ?, ?, ?)',
        [categoryId, name, courseId, teacherId]
    );

    return categoryId;
}

async function ensureQuiz(db, quiz, categoryId, teacherId, courseId) {
    const existing = await get(
        db,
        'SELECT id FROM quizzes WHERE title = ? AND created_by = ? AND course_id = ?',
        [quiz.title, teacherId, courseId]
    );

    if (existing) {
        await run(
            db,
            `UPDATE quizzes
             SET content_text = ?, images = ?, question_type = ?, options = ?, correct_answer = ?, timeout_seconds = ?, category_id = ?, course_id = ?
             WHERE id = ?`,
            [
                quiz.content_text || '',
                JSON.stringify(quiz.images || []),
                quiz.question_type,
                JSON.stringify(quiz.options || []),
                quiz.correct_answer || '',
                quiz.timeout_seconds || 60,
                categoryId,
                courseId,
                existing.id
            ]
        );
        return existing.id;
    }

    const legacy = await get(
        db,
        'SELECT id FROM quizzes WHERE title = ? AND created_by = ? AND course_id IS NULL',
        [quiz.title, teacherId]
    );

    if (legacy) {
        await run(
            db,
            `UPDATE quizzes
             SET content_text = ?, images = ?, question_type = ?, options = ?, correct_answer = ?, timeout_seconds = ?, category_id = ?, course_id = ?
             WHERE id = ?`,
            [
                quiz.content_text || '',
                JSON.stringify(quiz.images || []),
                quiz.question_type,
                JSON.stringify(quiz.options || []),
                quiz.correct_answer || '',
                quiz.timeout_seconds || 60,
                categoryId,
                courseId,
                legacy.id
            ]
        );
        return legacy.id;
    }

    const quizId = uuidv4();
    await run(
        db,
        `INSERT INTO quizzes (id, title, content_text, images, question_type, options, correct_answer, course_id, category_id, created_by, timeout_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            quizId,
            quiz.title,
            quiz.content_text || '',
            JSON.stringify(quiz.images || []),
            quiz.question_type,
            JSON.stringify(quiz.options || []),
            quiz.correct_answer || '',
            courseId,
            categoryId,
            teacherId,
            quiz.timeout_seconds || 60
        ]
    );

    return quizId;
}

async function seedQuizzes(db, teacherId, courseId) {
    const seeded = [];
    const categories = [];

    for (const section of QUIZ_SECTIONS) {
        const categoryId = await ensureCategory(db, section.name, teacherId, courseId);
        categories.push({ id: categoryId, name: section.name });

        for (const quiz of section.quizzes) {
            const quizId = await ensureQuiz(db, quiz, categoryId, teacherId, courseId);
            seeded.push({ id: quizId, title: quiz.title });
        }
    }

    return { categories, quizzes: seeded };
}

async function main() {
    const config = parseArgs(process.argv.slice(2));

    if (config.wipeExisting && fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH);
        console.log(`Removed existing database at ${DB_PATH}`);
    }

    const db = openDatabase();

    try {
        await exec(db, 'PRAGMA foreign_keys = ON;');
        await applySchema(db);
        console.log('Database schema applied.');

        const teacher = await upsertTeacher(db, config.teacher);
        console.log(`Teacher ready -> username: ${teacher.username} (password: ${teacher.password})`);

        const studentResult = await createStudents(db, config.students);
        console.log(`Created ${studentResult.created.length} student accounts (password: ${studentResult.password}).`);

        const course = await ensureCourse(db, config.course, teacher.id);
        const passkeyMsg = config.course.passkey
            ? `with passkey "${config.course.passkey}"`
            : 'without a passkey';
        console.log(`${course.isNew ? 'Created' : 'Updated'} course "${config.course.title}" ${passkeyMsg}.`);

        if (config.course.enrollAll) {
            const enrolled = await enrollStudents(db, course.id);
            console.log(`Enrolled ${enrolled} students into the course.`);
        } else {
            console.log('Skipped automatic enrollment (use --enroll-all to enable).');
        }

        if (config.seedQuizzes) {
            const result = await seedQuizzes(db, teacher.id, course.id);
            console.log(`Seeded ${result.quizzes.length} quizzes across ${result.categories.length} categories.`);
        } else {
            console.log('Skipped quiz seeding (--skip-quizzes was supplied).');
        }

        console.log('\nSetup complete. You can now run `npm start` and log in with the generated accounts.');
    } catch (error) {
        console.error('Bootstrap failed:', error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
}

main();
