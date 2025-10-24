#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const args = process.argv.slice(2);
let teacherUsername = 'teacher';

for (const arg of args) {
    if (arg.startsWith('--teacher=')) {
        teacherUsername = arg.split('=')[1] || teacherUsername;
    }
}

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

const sections = [
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

function openDb(filePath) {
    return new sqlite3.Database(filePath);
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
                resolve(row);
            }
        });
    });
}

async function ensureCategory(db, name, userId) {
    const existing = await get(
        db,
        'SELECT id FROM quiz_categories WHERE name = ? AND created_by = ?',
        [name, userId]
    );

    if (existing) {
        return existing.id;
    }

    const categoryId = uuidv4();
    await run(
        db,
        'INSERT INTO quiz_categories (id, name, created_by) VALUES (?, ?, ?)',
        [categoryId, name, userId]
    );

    return categoryId;
}

async function ensureQuiz(db, quiz, categoryId, userId) {
    const existing = await get(
        db,
        'SELECT id FROM quizzes WHERE title = ? AND created_by = ?',
        [quiz.title, userId]
    );

    if (existing) {
        return existing.id;
    }

    const quizId = uuidv4();

    await run(
        db,
        `INSERT INTO quizzes (id, title, content_text, images, question_type, options, correct_answer, category_id, created_by, timeout_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            quizId,
            quiz.title,
            quiz.content_text || '',
            JSON.stringify(quiz.images || []),
            quiz.question_type,
            JSON.stringify(quiz.options || []),
            quiz.correct_answer || '',
            categoryId,
            userId,
            quiz.timeout_seconds || 60
        ]
    );

    return quizId;
}

async function seed() {
    const db = openDb(DB_PATH);

    try {
        const teacher = await get(
            db,
            'SELECT id, username FROM users WHERE username = ?',
            [teacherUsername]
        );

        if (!teacher) {
            throw new Error(`Teacher account "${teacherUsername}" not found. Please create it before seeding.`);
        }

        console.log(`Seeding quizzes for teacher: ${teacher.username}`);

        for (const section of sections) {
            const categoryId = await ensureCategory(db, section.name, teacher.id);
            console.log(`\nSection: ${section.name}`);

            for (const quiz of section.quizzes) {
                const quizId = await ensureQuiz(db, quiz, categoryId, teacher.id);
                console.log(`  ✔ ${quiz.title} (${quizId})`);
            }
        }

        console.log('\nSeeding complete.');
    } catch (error) {
        console.error('Seeding failed:', error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
}

seed();
