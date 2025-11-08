/**
 * Load Testing Script for Tutoriaz Quiz System
 * Simulates multiple students connecting and taking quizzes simultaneously
 * 
 * Usage:
 *   node scripts/loadTest.js [numStudents] [serverUrl]
 *   node scripts/loadTest.js 40 http://localhost:3030
 */

const io = require('socket.io-client');
const fetch = require('node-fetch');

const NUM_STUDENTS = parseInt(process.argv[2]) || 40;
const SERVER_URL = process.argv[3] || 'http://127.0.0.1:3030';  // Use IPv4 instead of localhost
const TEACHER_USERNAME = 'teacher';
const TEACHER_PASSWORD = 'admin123';

let teacherToken = null;
let studentTokens = [];
let studentSockets = [];
let courseId = null;

console.log(`\n🧪 Load Test Configuration:`);
console.log(`   Students: ${NUM_STUDENTS}`);
console.log(`   Server: ${SERVER_URL}`);
console.log(`   Teacher: ${TEACHER_USERNAME}\n`);

// Create test students in database
async function createTestStudents() {
    console.log('📝 Creating test students...');
    const timestamp = Date.now();
    
    // Process in batches to avoid overwhelming the server
    const batchSize = 5;
    for (let batchStart = 1; batchStart <= NUM_STUDENTS; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize - 1, NUM_STUDENTS);
        const batchPromises = [];
        
        for (let i = batchStart; i <= batchEnd; i++) {
            const username = `loadtest_${timestamp}_${i}`;
            const password = 'test12345';  // Must be at least 8 characters
            
            batchPromises.push(
                (async () => {
                    try {
                        const response = await fetch(`${SERVER_URL}/api/register`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                username,
                                password,
                                display_name: `Test Student ${i}`,
                                role: 'student'
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (response.ok) {
                            return { username, token: data.token, userId: data.user.userId };
                        } else if (response.status === 409) {
                            // Student exists, try to login
                            const loginResponse = await fetch(`${SERVER_URL}/api/login`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username, password })
                            });
                            const loginData = await loginResponse.json();
                            if (loginResponse.ok) {
                                return { username, token: loginData.token, userId: loginData.user.userId };
                            } else {
                                console.error(`   ✗ Login failed for ${username}:`, loginData.error);
                                return null;
                            }
                        } else {
                            console.error(`   ✗ Register failed for ${username}:`, data.error);
                            return null;
                        }
                    } catch (error) {
                        console.error(`   ✗ Failed to create ${username}:`, error.message);
                        return null;
                    }
                })()
            );
        }
        
        // Wait for batch to complete
        const results = await Promise.all(batchPromises);
        results.forEach(result => {
            if (result) {
                studentTokens.push(result);
            }
        });
        
        console.log(`   ✓ Created ${studentTokens.length}/${NUM_STUDENTS} students`);
        
        // Small delay between batches to avoid rate limiting
        if (batchEnd < NUM_STUDENTS) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    console.log(`   ✅ ${studentTokens.length}/${NUM_STUDENTS} students ready\n`);
}

// Login teacher
async function loginTeacher() {
    console.log('👨‍🏫 Logging in teacher...');
    
    try {
        const response = await fetch(`${SERVER_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: TEACHER_USERNAME,
                password: TEACHER_PASSWORD
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            teacherToken = data.token;
            console.log(`   ✅ Teacher logged in\n`);
            return true;
        } else {
            console.error(`   ✗ Teacher login failed:`, data.error);
            return false;
        }
    } catch (error) {
        console.error(`   ✗ Teacher login error:`, error.message);
        return false;
    }
}

// Get or create a course
async function setupCourse() {
    console.log('📚 Setting up course...');
    
    try {
        // Get existing courses
        const response = await fetch(`${SERVER_URL}/api/courses`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        
        if (!response.ok) {
            console.error('   ✗ Failed to fetch courses:', response.status, response.statusText);
            return;
        }
        
        const courses = await response.json();
        console.log(`   📋 Found ${courses ? courses.length : 0} courses`);
        
        if (courses && courses.length > 0) {
            courseId = courses[0].id;
            const courseName = courses[0].title || courses[0].name || 'Unknown Course';
            console.log(`   ✅ Using existing course: ${courseName} (${courseId})\n`);
        } else {
            // Create a new course
            const createResponse = await fetch(`${SERVER_URL}/api/courses`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${teacherToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: 'Load Test Course',
                    description: 'Automated load testing',
                    passkey: 'loadtest123'  // Required passkey for course enrollment
                })
            });
            
            if (!createResponse.ok) {
                const errorData = await createResponse.json();
                console.error('   ✗ Failed to create course:', errorData);
                return;
            }
            
            const newCourse = await createResponse.json();
            // Try multiple possible response structures
            courseId = newCourse.course?.id || newCourse.id || newCourse.courseId;
            
            if (!courseId) {
                console.error('   ✗ Course created but ID is undefined. Response:', JSON.stringify(newCourse));
                return;
            }
            
            console.log(`   ✅ Created new course: ${courseId}\n`);
        }
        
        if (!courseId) {
            console.error('   ✗ No course ID available');
            return;
        }
        
        // Enroll all students
        console.log('📝 Enrolling students...');
        for (let i = 0; i < studentTokens.length; i++) {
            try {
                await fetch(`${SERVER_URL}/api/courses/${courseId}/enroll`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${studentTokens[i].token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if ((i + 1) % 10 === 0) {
                    console.log(`   ✓ Enrolled ${i + 1}/${studentTokens.length} students`);
                }
            } catch (error) {
                console.error(`   ✗ Failed to enroll ${studentTokens[i].username}`);
            }
        }
        console.log(`   ✅ Students enrolled\n`);
        
    } catch (error) {
        console.error('   ✗ Course setup error:', error.message);
    }
}

// Connect all students via WebSocket
async function connectStudents() {
    console.log('🔌 Connecting students via WebSocket...');
    
    const connectPromises = studentTokens.map((student, index) => {
        return new Promise((resolve) => {
            const socket = io(SERVER_URL, {
                transports: ['websocket'],
                reconnection: false
            });
            
            socket.on('connect', () => {
                socket.emit('auth', { token: student.token, tab_id: `tab_${index}` });
            });
            
            socket.on('auth_ok', (data) => {
                studentSockets.push({ socket, username: student.username, userId: student.userId });
                if (studentSockets.length % 10 === 0) {
                    console.log(`   ✓ Connected ${studentSockets.length}/${studentTokens.length} students`);
                }
                resolve();
            });
            
            socket.on('auth_error', (error) => {
                console.error(`   ✗ Auth failed for ${student.username}:`, error.message);
                resolve();
            });
            
            // Listen for quizzes
            socket.on('show_next_quiz', (data) => {
                console.log(`   📩 ${student.username} received quiz: ${data.quiz.title}`);
                
                // Auto-answer after random delay (1-5 seconds)
                const delay = 1000 + Math.random() * 4000;
                setTimeout(() => {
                    const answer = generateRandomAnswer(data.quiz);
                    socket.emit('quiz_answer', {
                        push_id: data.push_id,
                        answer: answer,
                        answered_at: new Date().toISOString()
                    });
                    console.log(`   ✅ ${student.username} answered`);
                }, delay);
            });
            
            socket.on('answer_submitted', () => {
                console.log(`   ✓ ${student.username} answer confirmed`);
            });
            
            // Timeout fallback
            setTimeout(() => resolve(), 5000);
        });
    });
    
    await Promise.all(connectPromises);
    console.log(`   ✅ ${studentSockets.length}/${studentTokens.length} students connected\n`);
}

// Generate random answer based on question type
function generateRandomAnswer(quiz) {
    switch (quiz.question_type) {
        case 'text':
            return `Test answer ${Math.floor(Math.random() * 100)}`;
        case 'select':
            if (quiz.options && quiz.options.length > 0) {
                const randomOption = quiz.options[Math.floor(Math.random() * quiz.options.length)];
                return { selected_text: randomOption };
            }
            return 'Option A';
        case 'checkbox':
            if (quiz.options && quiz.options.length > 0) {
                const numSelections = Math.floor(Math.random() * quiz.options.length) + 1;
                const selected = [];
                for (let i = 0; i < numSelections; i++) {
                    selected.push(quiz.options[Math.floor(Math.random() * quiz.options.length)]);
                }
                return selected;
            }
            return ['Option 1'];
        default:
            return 'Test answer';
    }
}

// Push a quiz to all students
async function pushQuiz(quizId) {
    console.log(`\n🚀 Pushing quiz ${quizId} to ${studentSockets.length} students...`);
    
    const startTime = Date.now();
    
    try {
        const response = await fetch(`${SERVER_URL}/api/pushes`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${teacherToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                quiz_id: quizId,
                target_scope: 'all',
                course_id: courseId
            })
        });
        
        const data = await response.json();
        const endTime = Date.now();
        
        if (response.ok) {
            console.log(`   ✅ Push completed in ${endTime - startTime}ms`);
            console.log(`   📊 Added: ${data.added_count}, Skipped: ${data.skipped_count}`);
            return data.push.id;
        } else {
            console.error(`   ✗ Push failed:`, data.error);
            return null;
        }
    } catch (error) {
        const endTime = Date.now();
        console.error(`   ✗ Push error after ${endTime - startTime}ms:`, error.message);
        return null;
    }
}

// Get first quiz from course
async function getFirstQuiz() {
    try {
        const response = await fetch(`${SERVER_URL}/api/quizzes?course_id=${courseId}`, {
            headers: { 'Authorization': `Bearer ${teacherToken}` }
        });
        
        const quizzes = await response.json();
        
        if (quizzes.length > 0) {
            console.log(`   ✅ Found ${quizzes.length} quizzes\n`);
            return quizzes[0].id;
        } else {
            console.log('   ⚠️  No quizzes found. Creating test quiz...');
            return await createTestQuiz();
        }
    } catch (error) {
        console.error('   ✗ Failed to get quiz:', error.message);
        return null;
    }
}

// Create a test quiz
async function createTestQuiz() {
    try {
        const response = await fetch(`${SERVER_URL}/api/quizzes`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${teacherToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Load Test Quiz',
                content_text: 'What is 2 + 2?',
                question_type: 'text',
                correct_answer: '4',
                timeout_seconds: 60,
                course_id: courseId,
                is_scored: true,
                points: 10
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('   ✗ Failed to create quiz:', errorData);
            return null;
        }
        
        const quiz = await response.json();
        const quizId = quiz.quiz?.id || quiz.id;
        
        if (!quizId) {
            console.error('   ✗ Quiz created but ID is undefined. Response:', JSON.stringify(quiz));
            return null;
        }
        
        console.log(`   ✅ Created test quiz: ${quizId}\n`);
        return quizId;
    } catch (error) {
        console.error('   ✗ Failed to create quiz:', error.message);
        return null;
    }
}

// Cleanup: disconnect all students
function cleanup() {
    console.log('\n🧹 Cleaning up...');
    studentSockets.forEach(({ socket }) => {
        socket.disconnect();
    });
    console.log('   ✅ All students disconnected\n');
}

// Main test execution
async function runLoadTest() {
    console.log('═══════════════════════════════════════════════════');
    console.log('   TUTORIAZ LOAD TEST');
    console.log('═══════════════════════════════════════════════════\n');
    
    try {
        // Step 1: Login teacher
        const teacherOk = await loginTeacher();
        if (!teacherOk) {
            console.error('❌ Cannot proceed without teacher login\n');
            process.exit(1);
        }
        
        // Step 2: Create students
        await createTestStudents();
        if (studentTokens.length === 0) {
            console.error('❌ No students created\n');
            process.exit(1);
        }
        
        // Step 3: Setup course
        await setupCourse();
        
        if (!courseId) {
            console.error('❌ No course ID available. Cannot proceed.\n');
            cleanup();
            process.exit(1);
        }
        
        // Step 4: Connect students
        await connectStudents();
        
        // Step 5: Get or create quiz
        console.log('📝 Preparing quiz...');
        const quizId = await getFirstQuiz();
        if (!quizId) {
            console.error('❌ No quiz available\n');
            cleanup();
            process.exit(1);
        }
        
        // Step 6: Push quiz (Test 1)
        console.log('\n═══════════════════════════════════════════════════');
        console.log('   TEST 1: First Quiz Push');
        console.log('═══════════════════════════════════════════════════');
        const push1 = await pushQuiz(quizId);
        
        if (push1) {
            // Wait for answers
            console.log('\n⏳ Waiting 10 seconds for students to answer...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Step 7: Push second quiz (Test 2)
            console.log('\n═══════════════════════════════════════════════════');
            console.log('   TEST 2: Second Quiz Push (Critical Test)');
            console.log('═══════════════════════════════════════════════════');
            const push2 = await pushQuiz(quizId);
            
            if (push2) {
                console.log('\n⏳ Waiting 10 seconds for final answers...');
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                console.log('\n✅ LOAD TEST COMPLETED SUCCESSFULLY!');
                console.log('═══════════════════════════════════════════════════\n');
            } else {
                console.log('\n❌ SECOND QUIZ PUSH FAILED (This was the reported issue)');
                console.log('═══════════════════════════════════════════════════\n');
            }
        }
        
    } catch (error) {
        console.error('\n❌ LOAD TEST FAILED:', error.message);
        console.error(error.stack);
    } finally {
        cleanup();
        process.exit(0);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Test interrupted by user');
    cleanup();
    process.exit(0);
});

// Run the test
runLoadTest();
