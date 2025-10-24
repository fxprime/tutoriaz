#!/usr/bin/env node

const axios = require('axios').default;
const { io } = require('socket.io-client');

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEFAULT_PASSWORD = process.env.STUDENT_PASSWORD || 'student123';
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        baseUrl: DEFAULT_BASE_URL,
        count: 50,
        usernamePrefix: 'student',
        password: DEFAULT_PASSWORD,
        correctRate: 0.6,
        teacherUser: null,
        teacherPassword: null,
        staggerMs: 150,
        dryRun: false
    };

    args.forEach(arg => {
        if (arg.startsWith('--base=')) config.baseUrl = arg.split('=')[1] || config.baseUrl;
        else if (arg.startsWith('--count=')) config.count = parseInt(arg.split('=')[1], 10) || config.count;
        else if (arg.startsWith('--prefix=')) config.usernamePrefix = arg.split('=')[1] || config.usernamePrefix;
        else if (arg.startsWith('--password=')) config.password = arg.split('=')[1] || config.password;
        else if (arg.startsWith('--correctRate=')) config.correctRate = parseFloat(arg.split('=')[1]) || config.correctRate;
        else if (arg.startsWith('--teacherUser=')) config.teacherUser = arg.split('=')[1] || null;
        else if (arg.startsWith('--teacherPassword=')) config.teacherPassword = arg.split('=')[1] || null;
        else if (arg.startsWith('--stagger=')) config.staggerMs = parseInt(arg.split('=')[1], 10) || config.staggerMs;
        else if (arg === '--dry-run') config.dryRun = true;
    });

    return config;
}

async function login(baseUrl, username, password, maxAttempts = 3) {
    const url = new URL('/api/login', baseUrl).toString();
    const networkErrorCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const { data } = await axios.post(url, { username, password }, { timeout: 5000 });
            return data;
        } catch (err) {
            const message = err.response?.data?.error || err.message;
            const code = err.code;
            const isNetworkError = networkErrorCodes.has(code);

            if (isNetworkError && attempt < maxAttempts) {
                console.warn(`[${username}] login attempt ${attempt} failed (${message}). Retrying...`);
                await wait(500 * attempt);
                continue;
            }

            if (isNetworkError) {
                const fatalError = new Error(`Login failed for ${username}: ${message}`);
                fatalError.fatal = true;
                throw fatalError;
            }

            throw new Error(`Login failed for ${username}: ${message}`);
        }
    }
}

async function fetchTeacherQuizMap(baseUrl, token) {
    const url = new URL('/api/quizzes', baseUrl).toString();
    const headers = { Authorization: `Bearer ${token}` };
    const quizMap = new Map();

    try {
        const { data } = await axios.get(url, { headers, timeout: 5000 });
        if (!data || !Array.isArray(data.quizzes)) {
            return quizMap;
        }
        data.quizzes.forEach(quiz => {
            quizMap.set(quiz.id, {
                correct_answer: quiz.correct_answer,
                options: quiz.options,
                question_type: quiz.question_type
            });
        });
        return quizMap;
    } catch (err) {
        console.warn('Unable to load quizzes for answer key, continuing without them:', err.message);
        return quizMap;
    }
}

function chooseAnswer(quiz, quizAnswers, correctRate) {
    const entry = quizAnswers.get(quiz.id) || quiz;
    const questionType = entry.question_type || quiz.question_type || 'text';
    const options = Array.isArray(entry.options) ? entry.options : Array.isArray(quiz.options) ? quiz.options : [];
    const correctAnswer = entry.correct_answer ?? quiz.correct_answer ?? null;
    const roll = Math.random();

    if (questionType === 'select' && options.length > 0) {
        if (correctAnswer && roll <= correctRate) {
            return correctAnswer;
        }
        const incorrect = options.filter(opt => opt !== correctAnswer);
        if (incorrect.length > 0) {
            return incorrect[Math.floor(Math.random() * incorrect.length)];
        }
        return options[Math.floor(Math.random() * options.length)];
    }

    if (typeof correctAnswer === 'string' && roll <= correctRate) {
        return correctAnswer;
    }

    const randomText = `Answer ${Math.random().toString(36).slice(2, 8)}`;
    return roll <= correctRate && correctAnswer ? correctAnswer : randomText;
}

function simulateStudent({ baseUrl, token, username, quizAnswers, correctRate, dryRun }) {
    return new Promise((resolve) => {
        const socket = io(baseUrl, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 5000
        });

        let answeredCount = 0;
        const answeredPushes = new Set();
        let active = true;
        const MAX_RUN_MS = 60 * 60 * 1000; // 1 hour safety cut-off
        const maxRunTimer = setTimeout(() => {
            if (active) {
                console.log(`[${username}] simulation reached max run time, shutting down`);
                finish();
            }
        }, MAX_RUN_MS);

        const finish = () => {
            if (!active) return;
            active = false;
            clearTimeout(maxRunTimer);
            socket.disconnect();
            resolve({ username, answeredCount });
        };

        socket.on('connect', () => {
            socket.emit('auth', { token });
        });

        socket.on('auth_ok', () => {
            console.log(`[${username}] authenticated`);
        });

        socket.on('quiz_queue_updated', (payload) => {
            if (!payload?.currentQuiz) {
                return;
            }
            const current = payload.currentQuiz;
            answerCurrentQuiz(current);
        });

        socket.on('show_next_quiz', (payload) => {
            if (!payload) {
                return;
            }
            const currentQuiz = {
                push_id: payload.push_id,
                quiz: payload.quiz,
                quiz_id: payload.quiz?.id
            };
            answerCurrentQuiz(currentQuiz);
        });

        socket.on('quiz_push', (payload) => {
            if (!payload) {
                return;
            }
            const currentQuiz = {
                push_id: payload.push_id,
                quiz: payload.quiz,
                quiz_id: payload.quiz?.id
            };
            answerCurrentQuiz(currentQuiz);
        });

        socket.on('quiz_timeout', () => {
            // user timed out on a push; allow future pushes
        });

        socket.on('queue_empty', () => {
            // no quizzes right now; wait for future pushes
        });

        socket.on('disconnect', () => {
            finish();
        });

        function answerCurrentQuiz(currentQuiz) {
            if (!currentQuiz?.quiz || !currentQuiz.push_id) {
                return;
            }
            if (answeredPushes.has(currentQuiz.push_id)) {
                return;
            }
            answeredPushes.add(currentQuiz.push_id);

            const delayMs = Math.floor(3000 + Math.random() * 7000);

            setTimeout(() => {
                if (!socket.connected) {
                    return;
                }

                const quiz = currentQuiz.quiz;
                const answer = chooseAnswer(quiz, quizAnswers, correctRate);
                const payload = {
                    push_id: currentQuiz.push_id,
                    answer,
                    answered_at: new Date().toISOString()
                };

                if (dryRun) {
                    console.log(`[${username}] would answer push ${currentQuiz.push_id} with`, answer, `(delay ${delayMs}ms)`);
                    return;
                }

                socket.emit('quiz_answer', payload);
                answeredCount += 1;
                console.log(`[${username}] answered quiz ${quiz.title || quiz.id} with`, answer, `(delay ${delayMs}ms)`);
            }, delayMs);
        }
    });
}

async function main() {
    const config = parseArgs();
    console.log('Simulation config:', config);

    const quizAnswers = new Map();

    if (config.teacherUser && config.teacherPassword) {
        try {
            const teacherLogin = await login(config.baseUrl, config.teacherUser, config.teacherPassword);
            const teacherToken = teacherLogin.token;
            const map = await fetchTeacherQuizMap(config.baseUrl, teacherToken);
            map.forEach((value, key) => quizAnswers.set(key, value));
            console.log(`Loaded ${quizAnswers.size} quiz answer keys from teacher account.`);
        } catch (err) {
            console.warn('Teacher fetch skipped:', err.message);
        }
    }

    const students = Array.from({ length: config.count }).map((_, idx) => ({
        username: `${config.usernamePrefix}${idx + 1}`,
        password: config.password
    }));

    const results = [];

    for (const student of students) {
        try {
            const loginData = await login(config.baseUrl, student.username, student.password);
            results.push({
                username: student.username,
                promise: simulateStudent({
                    baseUrl: config.baseUrl,
                    token: loginData.token,
                    username: student.username,
                    quizAnswers,
                    correctRate: config.correctRate,
                    dryRun: config.dryRun
                })
            });
        } catch (err) {
            console.warn(err.message);
            if (err.fatal) {
                console.error('Encountered unrecoverable connection error. Aborting simulation.');
                process.exit(1);
            }
        }

        await wait(config.staggerMs);
    }

    const summary = await Promise.all(results.map(r => r.promise));
    console.log('\nSimulation complete. Answer counts:');
    summary.forEach(item => {
        console.log(` - ${item.username}: ${item.answeredCount}`);
    });
}

main().catch(err => {
    console.error('Simulation failed:', err);
    process.exitCode = 1;
});
