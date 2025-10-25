#!/usr/bin/env node

const axios = require('axios');

const DEFAULTS = {
    baseUrl: process.env.TUTORIAZ_BASE_URL || 'http://localhost:3030',
    teacherUser: process.env.TUTORIAZ_TEACHER_USER || 'teacher1',
    teacherPass: process.env.TUTORIAZ_TEACHER_PASS || 'admin123',
    studentUser: process.env.TUTORIAZ_STUDENT_USER || 'student1',
    studentPass: process.env.TUTORIAZ_STUDENT_PASS || 'student123',
    courseTitle: process.env.TUTORIAZ_COURSE_TITLE || 'ESP32 Course',
    coursePasskey: process.env.TUTORIAZ_COURSE_PASSKEY || '',
    quizId: process.env.TUTORIAZ_QUIZ_ID || '12d63e6a-c4f5-49bf-9789-44fb0cb55c06'
};

function parseArgs(argv) {
    const options = { ...DEFAULTS };

    argv.forEach(arg => {
        const [key, value] = arg.split('=');
        if (!key || value === undefined) {
            return;
        }
        switch (key) {
            case '--base-url':
                options.baseUrl = value;
                break;
            case '--teacher-user':
                options.teacherUser = value;
                break;
            case '--teacher-pass':
                options.teacherPass = value;
                break;
            case '--student-user':
                options.studentUser = value;
                break;
            case '--student-pass':
                options.studentPass = value;
                break;
            case '--course-title':
                options.courseTitle = value;
                break;
            case '--course-passkey':
                options.coursePasskey = value;
                break;
            case '--quiz-id':
                options.quizId = value;
                break;
            default:
                break;
        }
    });

    return options;
}

function authHeaders(token) {
    return { headers: { Authorization: `Bearer ${token}` } };
}

async function login(client, username, password) {
    const response = await client.post('/api/login', { username, password });
    return response.data;
}

async function fetchTeacherCourse(client, token, courseTitle) {
    const { data } = await client.get('/api/courses', authHeaders(token));
    if (!Array.isArray(data.courses)) {
        throw new Error('Teacher courses response malformed');
    }
    const match = data.courses.find(course => course.title === courseTitle);
    if (!match) {
        const available = data.courses.map(course => course.title).join(', ');
        throw new Error(`Course "${courseTitle}" not found. Available: ${available || 'none'}`);
    }
    return match;
}

async function ensureStudentEnrollment(client, token, course, passkey) {
    const { data } = await client.get('/api/courses', authHeaders(token));
    const match = Array.isArray(data.courses)
        ? data.courses.find(item => item.id === course.id)
        : null;
    if (match && match.is_enrolled) {
        return;
    }
    if (!passkey) {
        throw new Error(`Student is not enrolled in course ${course.title} and no passkey supplied.`);
    }
    await client.post(
        `/api/courses/${encodeURIComponent(course.id)}/enroll`,
        { access_code: passkey },
        authHeaders(token)
    );
}

async function fetchStudentHistory(client, token) {
    const { data } = await client.get('/api/my-quiz-history', authHeaders(token));
    if (!data || !Array.isArray(data.history)) {
        throw new Error('Student history response malformed');
    }
    return data.history;
}

async function pushQuiz(client, token, quizId, courseId) {
    const payload = {
        quiz_id: quizId,
        target_scope: 'all',
        course_id: courseId
    };
    const { data } = await client.post('/api/pushes', payload, authHeaders(token));
    if (!data || !data.push || !data.push.id) {
        throw new Error('Push response missing push id');
    }
    return data.push;
}

async function undoQuiz(client, token, identifier) {
    const url = `/api/pushes/${encodeURIComponent(identifier)}/undo`;
    const { data } = await client.post(url, null, authHeaders(token));
    return data;
}

async function waitFor(conditionFn, { intervalMs = 500, timeoutMs = 5000 } = {}) {
    const start = Date.now();
    let attempt = 0;
    // Poll until condition resolves true or timeout expires.
    for (;;) {
        attempt += 1;
        const result = await conditionFn(attempt);
        if (result) {
            return true;
        }
        if (Date.now() - start >= timeoutMs) {
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const client = axios.create({ baseURL: options.baseUrl, timeout: 10000 });

    console.log('Logging in as teacher:', options.teacherUser);
    const teacherAuth = await login(client, options.teacherUser, options.teacherPass);
    const teacherToken = teacherAuth.token;
    console.log('Teacher login ok');

    console.log('Logging in as student:', options.studentUser);
    const studentAuth = await login(client, options.studentUser, options.studentPass);
    const studentToken = studentAuth.token;
    console.log('Student login ok');

    console.log('Locating course:', options.courseTitle);
    const course = await fetchTeacherCourse(client, teacherToken, options.courseTitle);
    console.log('Using course id:', course.id);

    console.log('Ensuring student enrollment...');
    await ensureStudentEnrollment(client, studentToken, course, options.coursePasskey);
    console.log('Student enrolled.');

    console.log('Fetching baseline quiz history...');
    const historyBefore = await fetchStudentHistory(client, studentToken);
    const beforeIds = new Set(historyBefore.map(item => item.push_id));
    console.log(`History entries before push: ${historyBefore.length}`);

    console.log('Pushing quiz:', options.quizId);
    const push = await pushQuiz(client, teacherToken, options.quizId, course.id);
    console.log('Push id:', push.id);

    const pushId = push.id;

    console.log('Waiting for student history to include new push...');
    const pushVisible = await waitFor(async () => {
        const pending = await fetchStudentHistory(client, studentToken);
        return pending.some(entry => entry.push_id === pushId);
    }, { intervalMs: 500, timeoutMs: 10000 });

    if (!pushVisible) {
        throw new Error('Timed out waiting for push to appear in student history');
    }
    console.log('Push present in student history.');

    console.log('Undoing quiz by identifier:', options.quizId);
    await undoQuiz(client, teacherToken, options.quizId);
    console.log('Undo request completed.');

    console.log('Waiting for student history to drop push...');
    const removed = await waitFor(async () => {
        const pending = await fetchStudentHistory(client, studentToken);
        return !pending.some(entry => entry.push_id === pushId);
    }, { intervalMs: 500, timeoutMs: 10000 });

    if (!removed) {
        throw new Error('Timed out waiting for push to disappear from student history after undo');
    }
    console.log('Push removed from student history.');

    console.log('Verifying active queue status...');
    const { data: queueData } = await client.get(
        `/api/queue-status?courseId=${encodeURIComponent(course.id)}`,
        authHeaders(teacherToken)
    );

    const stillActive = Array.isArray(queueData.active_pushes)
        ? queueData.active_pushes.find(item => item.quiz_id === options.quizId)
        : null;

    if (stillActive) {
        throw new Error(`Active push still present for quiz ${options.quizId}`);
    }
    console.log('No active pushes found for target quiz. Test passed.');
}

main().catch(error => {
    console.error('Test failed:', error.message || error);
    if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Response:', error.response.data);
    }
    process.exitCode = 1;
});
