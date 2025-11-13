const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const courseId = urlParams.get('courseId'); // Get the course ID from URL

let socket;
let quizData = {}; // Map of pushId -> quiz data
let studentData = {}; // Map of pushId -> Map of userId -> student data
let isCorrectnessRevealed = false;
let currentCourse = null; // Current course data
let currentTab = 'quizzes'; // Current active tab

// Connect to socket
function connectSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server - authenticating...');
        socket.emit('auth', { token });
    });

    socket.on('auth_ok', (data) => {
        console.log('✓ Authenticated as teacher for multi-monitor');
        updateConnectionStatus(true);
        
        // Initial fetch
        fetchAllActiveQuizzes();
    });

    socket.on('auth_error', (data) => {
        console.error('✗ Authentication failed:', data.message);
        updateConnectionStatus(false);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateConnectionStatus(false);
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        updateConnectionStatus(false);
    });

    // Listen for real-time quiz responses
    socket.on('quiz_response', (data) => {
        console.log('Quiz response received:', data);
        handleQuizResponse(data);
    });

    // Listen for quiz pushes (new quizzes)
    socket.on('push_created', (data) => {
        console.log('New quiz pushed:', data);
        // Refresh to include the new quiz
        fetchAllActiveQuizzes();
    });

    // Listen for queue status updates
    socket.on('queue_status_update', (data) => {
        console.log('Queue status update:', data);
        handleQueueStatusUpdate(data);
    });
}

function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    }
}

async function fetchAllActiveQuizzes() {
    try {
        const response = await fetch('/api/monitor/all-active-quizzes', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch active quizzes');
        }
        
        const data = await response.json();
        console.log('Active quizzes data:', data);
        
        // Update data structures
        quizData = {};
        studentData = {};
        
        if (data.quizzes && Array.isArray(data.quizzes)) {
            data.quizzes.forEach(quiz => {
                quizData[quiz.push_id] = quiz;
                
                // Initialize student data for this quiz
                studentData[quiz.push_id] = {};
                
                if (quiz.students && Array.isArray(quiz.students)) {
                    quiz.students.forEach(student => {
                        studentData[quiz.push_id][student.user_id] = student;
                    });
                }
            });
        }
        
        updateLastUpdateTime();
        renderMonitor();
    } catch (error) {
        console.error('Error fetching active quizzes:', error);
    }
}

function handleQuizResponse(data) {
    const pushId = data.push_id;
    
    if (!pushId || !quizData[pushId]) {
        console.log('Response for unknown push, refreshing...');
        fetchAllActiveQuizzes();
        return;
    }
    
    // Update student data
    if (!studentData[pushId]) {
        studentData[pushId] = {};
    }
    
    const userId = data.user_id;
    
    if (!studentData[pushId][userId]) {
        studentData[pushId][userId] = {
            user_id: userId,
            display_name: data.display_name || data.username,
            status: 'answered'
        };
    }
    
    // Update student status
    studentData[pushId][userId].status = 'answered';
    studentData[pushId][userId].elapsed_ms = data.elapsed_ms;
    studentData[pushId][userId].answered_at = data.answered_at || new Date().toISOString();
    studentData[pushId][userId].is_correct = data.is_correct;
    
    updateLastUpdateTime();
    renderMonitor();
}

function handleQueueStatusUpdate(data) {
    const { user_id, push_id, status } = data;
    
    if (!push_id || !quizData[push_id]) {
        return;
    }
    
    if (!studentData[push_id]) {
        studentData[push_id] = {};
    }
    
    if (!studentData[push_id][user_id]) {
        studentData[push_id][user_id] = {
            user_id: user_id,
            display_name: data.display_name || data.username || 'Unknown',
            status: status
        };
    } else {
        // Only update if not already answered
        if (studentData[push_id][user_id].status !== 'answered') {
            studentData[push_id][user_id].status = status;
        }
    }
    
    updateLastUpdateTime();
    renderMonitor();
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = 
        `Last update: ${now.toLocaleTimeString()}`;
}

function renderMonitor() {
    const grid = document.getElementById('monitorGrid');
    const quizzes = Object.values(quizData);
    
    if (quizzes.length === 0) {
        grid.innerHTML = `
            <div class="no-quizzes">
                Waiting for quiz pushes<span class="waiting-indicator"></span>
            </div>
        `;
        updateStats(0, 0, 0, 0);
        return;
    }
    
    // Sort quizzes by pushed_at (most recent first)
    quizzes.sort((a, b) => {
        const timeA = new Date(a.pushed_at).getTime();
        const timeB = new Date(b.pushed_at).getTime();
        return timeB - timeA;
    });
    
    let totalStudents = 0;
    let totalPending = 0;
    let totalAnswered = 0;
    
    grid.innerHTML = quizzes.map(quiz => {
        const students = Object.values(studentData[quiz.push_id] || {});
        
        // Sort students: viewing first, then pending, then answered
        students.sort((a, b) => {
            const statusOrder = { viewing: 0, pending: 1, answered: 2 };
            const orderA = statusOrder[a.status] || 3;
            const orderB = statusOrder[b.status] || 3;
            
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            
            // Within answered, sort by time
            if (a.status === 'answered' && b.status === 'answered') {
                const timeA = new Date(a.answered_at || 0).getTime();
                const timeB = new Date(b.answered_at || 0).getTime();
                return timeB - timeA;
            }
            
            return 0;
        });
        
        const pendingCount = students.filter(s => s.status === 'pending').length;
        const viewingCount = students.filter(s => s.status === 'viewing').length;
        const answeredCount = students.filter(s => s.status === 'answered').length;
        
        totalStudents += students.length;
        totalPending += (pendingCount + viewingCount);
        totalAnswered += answeredCount;
        
        const pushedTime = new Date(quiz.pushed_at);
        const timeAgo = getTimeAgo(pushedTime);
        
        return `
            <div class="quiz-card">
                <div class="quiz-card-header">
                    <div class="quiz-title">${escapeHtml(quiz.quiz_title)}</div>
                    <button class="quiz-info-icon" data-push-id="${quiz.push_id}" data-quiz-title="${escapeHtml(quiz.quiz_title)}" data-pushed-at="${quiz.pushed_at}" data-push-id-full="${quiz.push_id}">ℹ️</button>
                    <div class="quiz-badge badge-active">ACTIVE</div>
                </div>
                <div class="quiz-meta">
                    <span class="quiz-meta-item">⏰ ${timeAgo}</span>
                    <span class="quiz-meta-item">📝 ${answeredCount}/${students.length}</span>
                </div>
                <div class="student-list">
                    ${students.length > 0 ? students.map(student => renderStudentItem(student)).join('') : 
                        '<div class="empty-state">No students in queue</div>'}
                </div>
            </div>
        `;
    }).join('');
    
    // Add tooltip event listeners
    setupTooltips();
    
    updateStats(quizzes.length, totalStudents, totalPending, totalAnswered);
}

function setupTooltips() {
    // Remove existing tooltip if any
    const existingTooltip = document.querySelector('.quiz-info-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }
    
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'quiz-info-tooltip';
    document.body.appendChild(tooltip);
    
    // Add event listeners to all info icons
    document.querySelectorAll('.quiz-info-icon').forEach(icon => {
        icon.addEventListener('mouseenter', (e) => {
            const pushId = e.target.getAttribute('data-push-id-full');
            const quizTitle = e.target.getAttribute('data-quiz-title');
            const pushedAt = e.target.getAttribute('data-pushed-at');
            const pushedTime = new Date(pushedAt);
            
            tooltip.innerHTML = `
                <div class="quiz-info-tooltip-item">
                    <div class="quiz-info-tooltip-label">Quiz Title</div>
                    <div>${quizTitle}</div>
                </div>
                <div class="quiz-info-tooltip-item">
                    <div class="quiz-info-tooltip-label">Push ID</div>
                    <div style="font-family: monospace; font-size: 11px;">${pushId}</div>
                </div>
                <div class="quiz-info-tooltip-item">
                    <div class="quiz-info-tooltip-label">Pushed At</div>
                    <div>${pushedTime.toLocaleString()}</div>
                </div>
            `;
            
            const rect = e.target.getBoundingClientRect();
            tooltip.style.left = (rect.left - 260) + 'px';
            tooltip.style.top = (rect.top) + 'px';
            tooltip.classList.add('show');
        });
        
        icon.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });
    });
}

function renderStudentItem(student) {
    const statusClass = student.status === 'answered' ? 
        (student.is_correct ? 'correct' : 'incorrect') : 
        student.status;
    
    let statusBadge = '';
    if (student.status === 'pending') {
        statusBadge = '<span class="status-badge badge-pending">⏳</span>';
    } else if (student.status === 'viewing') {
        statusBadge = '<span class="status-badge badge-viewing">👁️</span>';
    } else if (student.status === 'answered') {
        const elapsed = student.elapsed_ms ? Math.round(student.elapsed_ms / 1000) : 0;
        statusBadge = `<span class="status-badge badge-answered">${elapsed}s</span>`;
    }
    
    // Correctness indicator (revealed only if toggle is on)
    let correctnessIndicator = '';
    if (student.status === 'answered' && student.is_correct !== undefined && student.is_correct !== null) {
        const symbol = student.is_correct ? '✓' : '✗';
        const correctnessClass = student.is_correct ? 'correct' : 'incorrect';
        const revealedClass = isCorrectnessRevealed ? 'revealed' : '';
        correctnessIndicator = `
            <span class="correctness-indicator ${correctnessClass} ${revealedClass}">
                ${symbol}
            </span>
        `;
    }
    
    return `
        <div class="student-item ${student.status} ${statusClass}">
            <span class="student-name">${escapeHtml(student.display_name)}</span>
            <div class="student-status">
                ${statusBadge}
                ${correctnessIndicator}
            </div>
        </div>
    `;
}

function updateStats(activeQuizzes, totalStudents, totalPending, totalAnswered) {
    document.getElementById('activeQuizzesCount').textContent = activeQuizzes;
    document.getElementById('totalStudentsCount').textContent = totalStudents;
    document.getElementById('totalPendingCount').textContent = totalPending;
    document.getElementById('totalAnsweredCount').textContent = totalAnswered;
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleCorrectness() {
    isCorrectnessRevealed = document.getElementById('correctnessToggle').checked;
    renderMonitor();
}

function refreshMonitor() {
    if (currentTab === 'quizzes') {
        fetchAllActiveQuizzes();
    } else if (currentTab === 'rankings' && courseId) {
        loadRankings();
    }
}

function switchTab(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        if (tab.getAttribute('data-tab') === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    if (tabName === 'quizzes') {
        document.getElementById('quizzesTab').classList.add('active');
    } else if (tabName === 'rankings') {
        document.getElementById('rankingsTab').classList.add('active');
        if (courseId) {
            loadRankings();
        }
    }
}

async function loadCourseInfo() {
    if (!courseId) return;
    
    // Course info will be loaded when rankings are fetched
    // No need for a separate call
}

async function loadRankings() {
    const container = document.getElementById('rankingsContainer');
    const courseDisplay = document.getElementById('courseDisplay');
    
    if (!courseId) {
        container.innerHTML = '<div class="loading-state">No course selected</div>';
        if (courseDisplay) {
            courseDisplay.textContent = 'No course selected';
        }
        return;
    }
    
    container.innerHTML = '<div class="loading-state">Loading rankings...</div>';
    if (courseDisplay) {
        courseDisplay.textContent = 'Loading course...';
    }
    
    try {
        const response = await fetch(`/api/courses/${courseId}/scores`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch rankings');
        }
        
        const data = await response.json();
        
        // Update course display
        if (data.course && courseDisplay) {
            courseDisplay.innerHTML = `
                <strong>${escapeHtml(data.course.title)}</strong>
                ${data.course.description ? `<br><small style="color: #718096;">${escapeHtml(data.course.description)}</small>` : ''}
            `;
        }
        
        renderRankings(data);
    } catch (error) {
        console.error('Error loading rankings:', error);
        container.innerHTML = '<div class="loading-state" style="color: #e53e3e;">Failed to load rankings</div>';
        if (courseDisplay) {
            courseDisplay.textContent = 'Error loading course';
        }
    }
}

function renderRankings(data) {
    const container = document.getElementById('rankingsContainer');
    const rankings = data.scores || [];
    
    if (rankings.length === 0) {
        container.innerHTML = '<div class="loading-state">No scores available yet</div>';
        return;
    }
    
    const tableHtml = `
        <table class="rankings-table">
            <thead>
                <tr>
                    <th style="text-align: center;">Rank</th>
                    <th>Student</th>
                    <th style="text-align: center;">Total Score</th>
                    <th style="text-align: center;">Answered</th>
                    <th style="text-align: center;">Correct</th>
                    <th style="text-align: center;">Incorrect</th>
                    <th style="text-align: center;">Accuracy</th>
                </tr>
            </thead>
            <tbody>
                ${rankings.map((student, index) => {
                    const rank = index + 1;
                    const accuracy = student.answered_count > 0 
                        ? Math.round((student.correct_count / student.answered_count) * 100) 
                        : 0;
                    const rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                    const rowStyle = rank <= 3 ? 'background: #f0fff4;' : '';
                    
                    return `
                        <tr style="${rowStyle}">
                            <td style="text-align: center;">
                                <span class="rank-badge">${rankBadge}</span>
                            </td>
                            <td style="font-weight: 500;">${escapeHtml(student.display_name || student.username)}</td>
                            <td style="text-align: center; font-size: 18px; font-weight: bold; color: #667eea;">${student.total_score}</td>
                            <td style="text-align: center; color: #718096;">${student.answered_count}</td>
                            <td style="text-align: center; color: #38a169;">${student.correct_count}</td>
                            <td style="text-align: center; color: #e53e3e;">${student.incorrect_count}</td>
                            <td style="text-align: center; font-weight: 600; color: ${accuracy >= 80 ? '#38a169' : accuracy >= 60 ? '#d69e2e' : '#e53e3e'};">${accuracy}%</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHtml;
}

// Event listeners
document.getElementById('correctnessToggle')?.addEventListener('change', toggleCorrectness);
document.getElementById('refreshBtn')?.addEventListener('click', refreshMonitor);

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        switchTab(tabName);
    });
});

// Auto-refresh every 30 seconds
setInterval(() => {
    if (currentTab === 'quizzes') {
        fetchAllActiveQuizzes();
    }
}, 30000);

// Initialize
if (token) {
    connectSocket();
} else {
    console.error('No token provided');
    document.querySelector('.no-quizzes').textContent = 'Authentication required';
}
