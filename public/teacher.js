        // Configure marked.js with custom renderer for better code highlighting
        const renderer = new marked.Renderer();
        const originalCodeRenderer = renderer.code.bind(renderer);
        
        renderer.code = function(code, language, isEscaped) {
            // If a language is specified, try to highlight it
            if (language && hljs.getLanguage(language)) {
                try {
                    const highlighted = hljs.highlight(code, { language: language }).value;
                    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
                } catch (err) {
                    console.error('Highlight.js error:', err);
                }
            }
            // Auto-detect language
            try {
                const result = hljs.highlightAuto(code);
                const detectedLang = result.language || 'plaintext';
                return `<pre><code class="hljs language-${detectedLang}">${result.value}</code></pre>`;
            } catch (err) {
                console.error('Highlight.js auto error:', err);
            }
            // Fallback to default
            return originalCodeRenderer(code, language, isEscaped);
        };

        marked.setOptions({
            renderer: renderer,
            breaks: true,
            gfm: true,
            tables: true
        });
        
        let socket;
        let user;
        let token;
        let quizzes = [];
        let categories = [];
        let onlineStudents = [];
    let activeResponses = new Map(); // pushId -> responses array

    // Track active pushes keyed by quiz ID to align with undo semantics.
    // Each entry holds { push_id, quiz_id, course_id, started_at, title }.
    let activePushesByQuiz = new Map();
        let teacherCourses = [];
        let selectedCourseId = null;
        let currentCourse = null;
        let lastGeneratedPasskey = '';
        let activeStudentDetailId = null;
        let baseUrl = window.location.origin; // Default fallback

        // Fetch app configuration
        async function fetchAppConfig() {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    baseUrl = config.baseUrl;
                    console.log('Base URL configured:', baseUrl);
                    
                    // Update page title if provided
                    if (config.appName) {
                        const titleEl = document.getElementById('appTitle');
                        if (titleEl) {
                            titleEl.textContent = `${config.appName} - Teacher Dashboard`;
                        }
                        document.title = `Teacher Dashboard - ${config.appName}`;
                    }
                    
                    // Update version info
                    const versionInfoEl = document.getElementById('versionInfo');
                    if (versionInfoEl && config.version) {
                        versionInfoEl.textContent = config.version;
                    } else if (versionInfoEl) {
                        versionInfoEl.textContent = 'v1.0.0';
                    }
                    
                    // Update build info (build date)
                    const buildInfoEl = document.getElementById('buildInfo');
                    if (buildInfoEl) {
                        const dateIso = config.buildDate || null;
                        let formatted = '';
                        if (dateIso) {
                            try {
                                const d = new Date(dateIso);
                                formatted = d.toLocaleString();
                            } catch (e) {
                                formatted = dateIso;
                            }
                        }
                        if (formatted) {
                            buildInfoEl.textContent = formatted;
                        } else {
                            buildInfoEl.textContent = 'Development';
                        }
                    }
                }
            } catch (error) {
                console.warn('Could not fetch app config, using default:', error);
            }
        }

        function escapeHtml(value) {
            if (value === null || value === undefined) {
                return '';
            }
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getCourseTitle(courseId) {
            if (!courseId) {
                return null;
            }
            const match = teacherCourses.find(course => String(course.id) === String(courseId));
            return match ? match.title : null;
        }

        function formatDateTime(value) {
            if (!value) {
                return 'Not available';
            }
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return 'Not available';
            }
            return date.toLocaleString();
        }

        function formatTimeOfDay(value) {
            if (!value) {
                return 'Not available';
            }
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return 'Not available';
            }
            return date.toLocaleTimeString();
        }

        function formatDuration(seconds) {
            if (!Number.isFinite(seconds) || seconds <= 0) {
                return 'Not available';
            }

            const units = [
                { label: 'h', value: 3600 },
                { label: 'm', value: 60 },
                { label: 's', value: 1 }
            ];

            let remaining = Math.floor(seconds);
            const parts = [];

            units.forEach(unit => {
                if (remaining >= unit.value) {
                    const amount = Math.floor(remaining / unit.value);
                    remaining -= amount * unit.value;
                    parts.push(`${amount}${unit.label}`);
                }
            });

            if (parts.length === 0 && remaining > 0) {
                return `${remaining}s`;
            }

            return parts.length ? parts.join(' ') : 'Not available';
        }

        function describeTabState(student) {
            if (!student) {
                return 'Unknown';
            }
            const primary = student.is_primary_tab ? 'Primary window' : 'Background tab';
            const visibility = student.is_visible ? 'Visible' : 'Hidden';
            return `${primary} | ${visibility}`;
        }

        // Build the student detail modal contents with current telemetry.
        function renderStudentDetailHtml(student) {
            if (!student) {
                return '<div class="student-detail-empty">Student details are not available.</div>';
            }

            const displayNameValue = student.display_name ? escapeHtml(student.display_name) : 'Not set';
            const usernameValue = escapeHtml(student.username || 'Unknown');
            const userIdValue = escapeHtml(String(student.user_id || 'Unknown'));
            const onlineSince = formatDateTime(student.connected_at);
            const activeCourseTitle = getCourseTitle(student.active_course_id);
            const activeCourse = activeCourseTitle ? escapeHtml(activeCourseTitle) : 'None';
            const tabState = escapeHtml(describeTabState(student));

            const attendanceStatus = student.attendance_status ? escapeHtml(student.attendance_status) : 'Not available';
            const attendanceStartedAt = formatDateTime(student.attendance_started_at);
            const attendanceDuration = formatDuration(student.attendance_duration_seconds);
            const attendanceLastUpdate = formatDateTime(student.attendance_last_status_at);

            const queueLengthValue = Number(student.queue_length);
            const queueLength = Number.isFinite(queueLengthValue) ? queueLengthValue : 0;
            const pendingCountValue = Number(student.pending_count);
            const pendingCount = Number.isFinite(pendingCountValue) ? pendingCountValue : 0;
            const currentQuizTitle = student.current_quiz && student.current_quiz.title
                ? escapeHtml(student.current_quiz.title)
                : 'None';

            const quizStats = student.quiz_stats || {};
            const totalResponsesValue = Number(quizStats.total_responses);
            const totalResponses = Number.isFinite(totalResponsesValue) ? totalResponsesValue : 0;
            const answeredCountValue = Number(quizStats.answered_count);
            const answeredCount = Number.isFinite(answeredCountValue) ? answeredCountValue : 0;
            const lastAnswered = formatDateTime(quizStats.last_answered_at);

            return `
                <div class="student-detail-section">
                    <div class="student-detail-grid">
                        <div class="student-detail-kv"><span>Display name</span><span>${displayNameValue}</span></div>
                        <div class="student-detail-kv"><span>Username</span><span>${usernameValue}</span></div>
                        <div class="student-detail-kv"><span>User ID</span><span>${userIdValue}</span></div>
                    </div>
                </div>
                <div class="student-detail-section">
                    <div class="student-detail-grid">
                        <div class="student-detail-kv"><span>Online since</span><span>${onlineSince}</span></div>
                        <div class="student-detail-kv"><span>Active course</span><span>${activeCourse}</span></div>
                        <div class="student-detail-kv"><span>Tab state</span><span>${tabState}</span></div>
                    </div>
                </div>
                <div class="student-detail-section">
                    <div class="student-detail-grid">
                        <div class="student-detail-kv"><span>Attendance status</span><span>${attendanceStatus}</span></div>
                        <div class="student-detail-kv"><span>Started at</span><span>${attendanceStartedAt}</span></div>
                        <div class="student-detail-kv"><span>Duration</span><span>${attendanceDuration}</span></div>
                        <div class="student-detail-kv"><span>Last update</span><span>${attendanceLastUpdate}</span></div>
                    </div>
                </div>
                <div class="student-detail-section">
                    <div class="student-detail-grid">
                        <div class="student-detail-kv"><span>Queue length</span><span>${queueLength}</span></div>
                        <div class="student-detail-kv"><span>Pending count</span><span>${pendingCount}</span></div>
                        <div class="student-detail-kv"><span>Current quiz</span><span>${currentQuizTitle}</span></div>
                    </div>
                </div>
                <div class="student-detail-section">
                    <div class="student-detail-grid">
                        <div class="student-detail-kv"><span>Total responses</span><span>${totalResponses}</span></div>
                        <div class="student-detail-kv"><span>Answered count</span><span>${answeredCount}</span></div>
                        <div class="student-detail-kv"><span>Last answered</span><span>${lastAnswered}</span></div>
                    </div>
                </div>
            `;
        }

        function openStudentDetail(studentId) {
            const modal = document.getElementById('studentDetailModal');
            const body = document.getElementById('studentDetailBody');
            if (!modal || !body) {
                return;
            }

            const student = onlineStudents.find(item => String(item.user_id) === String(studentId));
            if (!student) {
                showNotification('Student disconnected before details could load.', 'info');
                closeStudentDetail();
                return;
            }

            activeStudentDetailId = String(student.user_id);
            body.innerHTML = renderStudentDetailHtml(student);
            const titleEl = document.getElementById('studentDetailTitle');
            if (titleEl) {
                const displayPart = student.display_name ? student.display_name : null;
                const usernamePart = student.username ? student.username : null;
                let combined;
                if (displayPart && usernamePart && displayPart !== usernamePart) {
                    combined = `${displayPart} (${usernamePart})`;
                } else {
                    combined = displayPart || usernamePart || 'Student';
                }
                titleEl.textContent = `Student Details - ${combined}`;
            }
            modal.classList.remove('hidden');

            const closeButton = document.getElementById('closeStudentDetail');
            if (closeButton) {
                closeButton.focus();
            }
        }

        function closeStudentDetail() {
            const modal = document.getElementById('studentDetailModal');
            if (!modal) {
                return;
            }
            const body = document.getElementById('studentDetailBody');
            if (body) {
                body.innerHTML = '';
            }
            modal.classList.add('hidden');
            activeStudentDetailId = null;
            const titleEl = document.getElementById('studentDetailTitle');
            if (titleEl) {
                titleEl.textContent = 'Student Details';
            }
        }

    // Wire modal dismissal gestures once the DOM is ready.
    function initializeStudentDetailModal() {
            const modal = document.getElementById('studentDetailModal');
            const closeButton = document.getElementById('closeStudentDetail');

            if (closeButton) {
                closeButton.addEventListener('click', () => closeStudentDetail());
            }

            if (modal) {
                modal.addEventListener('click', (event) => {
                    if (event.target === modal) {
                        closeStudentDetail();
                    }
                });
            }

            window.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeStudentDetail();
                }
            });
        }

        initializeStudentDetailModal();

        function generateReadablePasskey() {
            const prefixes = ['ESP', 'LAB', 'CODE', 'TECH', 'NODE', 'BOARD'];
            const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const digits = Math.floor(100 + Math.random() * 900);
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            return `${prefix}-${suffix}${digits}`;
        }

        function setPasskeyValue(value) {
            const input = document.getElementById('lobbyCoursePasskey');
            if (input) {
                input.value = value;
            }
        }

        function showPasskeyNotice(passkey, courseTitle) {
            const notice = document.getElementById('newCoursePasskey');
            if (!notice) return;

            if (!passkey) {
                notice.classList.add('hidden');
                notice.innerHTML = '';
                return;
            }

            const title = escapeHtml(courseTitle || 'New course');
            const code = escapeHtml(passkey);
            notice.innerHTML = `<strong>${title}</strong> passkey: <strong>${code}</strong><br><small>Share this code with students so they can enroll.</small>`;
            notice.classList.remove('hidden');
        }

        async function loadTeacherCourses() {
            try {
                const response = await fetch('/api/courses', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    throw new Error('Failed to load courses');
                }

                const data = await response.json();
                teacherCourses = Array.isArray(data.courses) ? data.courses : [];
            } catch (error) {
                console.error('Load teacher courses error:', error);
                showNotification('Could not load courses. Try refreshing.', 'error');
            } finally {
                renderTeacherLobby();
            }
        }

        function renderTeacherLobby() {
            const listEl = document.getElementById('teacherCourseList');
            if (!listEl) {
                return;
            }

            if (!teacherCourses.length) {
                listEl.innerHTML = '<div class="empty-state">No courses yet. Create one to get started.</div>';
            } else {
                listEl.innerHTML = teacherCourses.map(course => {
                    const description = course.description ? escapeHtml(course.description) : 'No description provided yet.';
                    const createdAt = course.created_at ? new Date(course.created_at).toLocaleString() : 'Unknown date';
                    const enrolledCount = typeof course.enrollment_count === 'number' ? course.enrollment_count : 0;
                    return `
                        <div class="teacher-course-card">
                            <h4>${escapeHtml(course.title)}</h4>
                            <p>${description}</p>
                            <p class="meta">Created ${escapeHtml(createdAt)} • Enrolled: ${enrolledCount}</p>
                            <div class="course-card-actions">
                                <button data-course-action="select" data-course-id="${escapeHtml(course.id)}" class="select-btn">Open Course</button>
                                <button data-course-action="edit" data-course-id="${escapeHtml(course.id)}" class="edit-btn">Edit</button>
                                <button data-course-action="delete" data-course-id="${escapeHtml(course.id)}" class="delete-btn">Delete</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            listEl.querySelectorAll('[data-course-action="select"]').forEach(button => {
                button.addEventListener('click', () => selectCourse(button.getAttribute('data-course-id')));
            });

            listEl.querySelectorAll('[data-course-action="edit"]').forEach(button => {
                button.addEventListener('click', () => openEditCourseModal(button.getAttribute('data-course-id')));
            });

            listEl.querySelectorAll('[data-course-action="delete"]').forEach(button => {
                button.addEventListener('click', () => deleteCourse(button.getAttribute('data-course-id')));
            });

            if (selectedCourseId && teacherCourses.length) {
                const match = teacherCourses.find(course => course.id === selectedCourseId);
                if (match && document.getElementById('teacherWorkspace').classList.contains('hidden')) {
                    selectCourse(selectedCourseId, { silent: true });
                }
                if (!match) {
                    selectedCourseId = null;
                    localStorage.removeItem('teacherSelectedCourseId');
                }
            }
        }

        function updateTeacherCourseHeader(course) {
            const nameEl = document.getElementById('teacherActiveCourseName');
            if (nameEl) {
                nameEl.textContent = course.title || 'Course Workspace';
            }

            const metaEl = document.getElementById('teacherActiveCourseMeta');
            if (metaEl) {
                const createdAt = course.created_at ? new Date(course.created_at).toLocaleString() : '';
                const enrollment = typeof course.enrollment_count === 'number' ? course.enrollment_count : 0;
                metaEl.textContent = `${createdAt ? `Created ${createdAt}` : ''}${createdAt ? ' • ' : ''}Enrolled: ${enrollment}`;
            }

            // Load course documentation
            loadTeacherCourseDocumentation(course);
        }

        function loadTeacherCourseDocumentation(courseData) {
            console.log('Loading teacher course documentation for:', courseData);
            
            const docsContainer = document.getElementById('teacherDocsContainer');
            const docsFrame = document.getElementById('teacherDocsFrame');
            const docsPlaceholder = document.getElementById('teacherDocsPlaceholder');
            
            // Use docs_local_path if available, otherwise fall back to docs_repo_url
            const docsPath = courseData.docs_local_path || courseData.docs_repo_url;
            
            if (courseData && docsPath) {
                // Show documentation container
                if (docsContainer) {
                    docsContainer.classList.remove('hidden');
                    docsContainer.style.display = 'block';
                }
                if (docsPlaceholder) {
                    docsPlaceholder.style.display = 'none';
                }
                
                // Load the documentation in iframe
                if (docsFrame) {
                    let docsUrl = docsPath;
                    
                    // Check if it's a local path (starts with /)
                    if (docsUrl.startsWith('/')) {
                        // Local path - use as-is, browser will resolve relative to current origin
                        console.log('Using local documentation path:', docsUrl);
                    }
                    // Check if it's already a full URL (starts with http:// or https://)
                    else if (docsUrl.startsWith('http://') || docsUrl.startsWith('https://')) {
                        // Convert localhost URLs to use current host/baseUrl
                        if (docsUrl.includes('localhost:3030')) {
                            docsUrl = docsUrl.replace('http://localhost:3030', baseUrl);
                        }
                        
                        // If it's a GitHub repo URL, convert to GitHub Pages URL
                        if (docsUrl.includes('github.com')) {
                            const repoPath = docsUrl.replace('https://github.com/', '');
                            const [owner, repo] = repoPath.split('/');
                            docsUrl = `https://${owner}.github.io/${repo}/`;
                            
                            // Add branch/path if specified
                            if (courseData.docs_branch && courseData.docs_branch !== 'main') {
                                docsUrl += `${courseData.docs_branch}/`;
                            }
                            if (courseData.docs_path) {
                                docsUrl += courseData.docs_path;
                            }
                        }
                    }
                    // Otherwise treat as relative path
                    else {
                        console.log('Treating as relative path:', docsUrl);
                    }
                    
                    docsFrame.src = docsUrl;
                    console.log('Loading teacher docs from:', docsUrl);
                }
            } else {
                // No documentation available, show placeholder
                if (docsContainer) {
                    docsContainer.classList.add('hidden');
                }
                if (docsPlaceholder) {
                    docsPlaceholder.style.display = 'block';
                }
            }
        }

        function toggleTeacherDocsView() {
            const docsFrame = document.getElementById('teacherDocsFrame');
            const toggleBtn = document.querySelector('.teacher-docs-container .docs-btn');
            
            if (docsFrame.style.display === 'none') {
                docsFrame.style.display = 'block';
                if (toggleBtn) toggleBtn.textContent = 'Hide Docs';
            } else {
                docsFrame.style.display = 'none';
                if (toggleBtn) toggleBtn.textContent = 'Show Docs';
            }
        }

        function openTeacherDocsNewTab() {
            const docsFrame = document.getElementById('teacherDocsFrame');
            if (docsFrame.src) {
                window.open(docsFrame.src, '_blank');
            }
        }

        function toggleSidebar() {
            const mainContent = document.querySelector('.main-content');
            const toggleBtn = document.querySelector('.sidebar-toggle');
            
            mainContent.classList.toggle('sidebar-collapsed');
            
            // Update button icon and tooltip
            if (mainContent.classList.contains('sidebar-collapsed')) {
                toggleBtn.innerHTML = '☰';
                toggleBtn.title = 'Show Sidebar';
            } else {
                toggleBtn.innerHTML = '‹';
                toggleBtn.title = 'Hide Sidebar';
            }
        }

        function selectCourse(courseId, options = {}) {
            const course = teacherCourses.find(item => item.id === courseId);
            if (!course) {
                showNotification('Course unavailable. Refresh and try again.', 'error');
                return;
            }

            selectedCourseId = courseId;
            currentCourse = course;
            localStorage.setItem('teacherSelectedCourseId', courseId);
            updateTeacherCourseHeader(course);
            showPasskeyNotice('', '');

            const lobby = document.getElementById('teacherLobbySection');
            const workspace = document.getElementById('teacherWorkspace');
            if (lobby) {
                lobby.classList.add('hidden');
            }
            if (workspace) {
                workspace.classList.remove('hidden');
            }

            if (!options.silent) {
                showNotification(`Managing ${course.title}`, 'success');
            }

            loadCategories();
            loadQuizzes();
            loadAssignments();
            updateQueueStatus();
        }

        function returnToTeacherLobby(clearSelection = false) {
            const lobby = document.getElementById('teacherLobbySection');
            const workspace = document.getElementById('teacherWorkspace');
            if (workspace) {
                workspace.classList.add('hidden');
            }
            if (lobby) {
                lobby.classList.remove('hidden');
            }

            if (clearSelection) {
                selectedCourseId = null;
                localStorage.removeItem('teacherSelectedCourseId');
            }
        }

        async function handleCreateCourse(event) {
            event.preventDefault();

            const titleInput = document.getElementById('lobbyCourseTitle');
            const descriptionInput = document.getElementById('lobbyCourseDescription');
            const passkeyInput = document.getElementById('lobbyCoursePasskey');
            const docsRepoInput = document.getElementById('lobbyDocsRepoUrl');
            const docsBranchInput = document.getElementById('lobbyDocsBranch');
            
            if (!titleInput || !passkeyInput) {
                return;
            }

            const title = titleInput.value.trim();
            const description = descriptionInput ? descriptionInput.value.trim() : '';
            const passkey = passkeyInput.value.trim();
            const docsRepoUrl = docsRepoInput ? docsRepoInput.value.trim() : '';
            const docsBranch = docsBranchInput ? docsBranchInput.value.trim() || 'main' : 'main';

            if (!title) {
                showNotification('Course title is required.', 'error');
                return;
            }
            if (passkey.length < 4) {
                showNotification('Passkey must be at least 4 characters.', 'error');
                return;
            }

            // Show progress if git URL is provided
            let progressNotification = null;
            if (docsRepoUrl && (docsRepoUrl.includes('github.com') || docsRepoUrl.includes('git@'))) {
                progressNotification = showNotification('Preparing to clone repository...', 'info', 0);
                
                // Listen for clone progress
                socket.on('clone-progress', (data) => {
                    if (data.userId === user.userId) {
                        const progressBar = document.querySelector('.notification.info .progress-bar');
                        const progressText = document.querySelector('.notification.info .notification-text');
                        
                        if (progressBar && progressText) {
                            progressText.textContent = data.message;
                            progressBar.style.width = `${data.progress || 0}%`;
                        }
                    }
                });
            }

            try {
                const payload = {
                    title,
                    description,
                    access_code: passkey
                };

                if (docsRepoUrl) {
                    payload.docs_repo_url = docsRepoUrl;
                    payload.docs_branch = docsBranch;
                }

                const response = await fetch('/api/courses', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                // Remove progress listener
                socket.off('clone-progress');
                
                // Close progress notification
                if (progressNotification) {
                    progressNotification.remove();
                }
                
                // Check if response is JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    const text = await response.text();
                    throw new Error(`Server error: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to create course');
                }

                showPasskeyNotice(data.passkey, data.course.title);
                titleInput.value = '';
                if (descriptionInput) {
                    descriptionInput.value = '';
                }
                passkeyInput.value = '';
                if (docsRepoInput) {
                    docsRepoInput.value = '';
                }
                if (docsBranchInput) {
                    docsBranchInput.value = 'main';
                }

                await loadTeacherCourses();
                selectCourse(data.course.id);
            } catch (error) {
                console.error('Create course error:', error);
                socket.off('clone-progress');
                if (progressNotification) {
                    progressNotification.remove();
                }
                showNotification(error.message || 'Failed to create course.', 'error');
            }
        }

        function openEditCourseModal(courseId) {
            const course = teacherCourses.find(c => c.id === courseId);
            if (!course) {
                showNotification('Course not found', 'error');
                return;
            }

            // Populate the form
            document.getElementById('editCourseId').value = course.id;
            document.getElementById('editCourseTitle').value = course.title || '';
            document.getElementById('editCourseDescription').value = course.description || '';
            document.getElementById('editDocsRepoUrl').value = course.docs_repo_url || '';
            document.getElementById('editDocsBranch').value = course.docs_branch || 'main';
            document.getElementById('editCoursePasskey').value = ''; // Always empty for security

            // Show the modal
            document.getElementById('editCourseModal').classList.remove('hidden');
        }

        function closeEditCourseModal() {
            document.getElementById('editCourseModal').classList.add('hidden');
            // Clear form
            document.getElementById('editCourseForm').reset();
        }

        // CSV Export Functions
        function showExportModal() {
            if (!selectedCourseId) {
                showNotification('Please select a course first', 'error');
                return;
            }
            document.getElementById('exportCsvModal').classList.remove('hidden');
        }

        function closeExportModal() {
            document.getElementById('exportCsvModal').classList.add('hidden');
        }

        async function exportCSV(mode) {
            if (!selectedCourseId) {
                showNotification('No course selected', 'error');
                return;
            }

            try {
                closeExportModal();
                showNotification(`Generating ${mode} export...`, 'info');

                const response = await fetch(`/api/courses/${selectedCourseId}/export-csv?mode=${mode}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || 'Failed to generate CSV export');
                }

                // Get the blob from the response
                const blob = await response.blob();
                
                // Create a download link and trigger it
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                
                // Extract filename from Content-Disposition header if available
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = `student_export_${mode}.csv`;
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
                    if (filenameMatch) {
                        filename = filenameMatch[1];
                    }
                }
                
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                
                // Cleanup
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                showNotification('CSV export downloaded successfully', 'success');
            } catch (error) {
                console.error('Export CSV error:', error);
                showNotification(error.message || 'Failed to export CSV', 'error');
            }
        }

        window.showExportModal = showExportModal;
        window.closeExportModal = closeExportModal;
        window.exportCSV = exportCSV;

        // Push Answers Functions
        async function showPushAnswersConfirm() {
            if (!selectedCourseId) {
                showNotification('Please select a course first', 'error');
                return;
            }

            if (confirm('Push quiz answers to all students?\n\nStudents will see:\n- Quiz questions\n- Their answers\n- Correct answers\n- Whether they got it right or wrong')) {
                await pushAnswersToStudents();
            }
        }

        async function pushAnswersToStudents() {
            if (!selectedCourseId) {
                return;
            }

            try {
                showNotification('Pushing answers to students...', 'info');

                const response = await fetch(`/api/courses/${selectedCourseId}/push-answers`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to push answers');
                }

                showNotification(`Answers pushed to ${data.pushed_to} of ${data.total_students} students`, 'success');
            } catch (error) {
                console.error('Push answers error:', error);
                showNotification(error.message || 'Failed to push answers', 'error');
            }
        }

        window.showPushAnswersConfirm = showPushAnswersConfirm;

        // Profile Management Functions
        function showProfileModal() {
            const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
            document.getElementById('profileDisplayName').value = currentUser.display_name || currentUser.username || '';
            document.getElementById('profileCurrentPassword').value = '';
            document.getElementById('profileNewPassword').value = '';
            document.getElementById('profileConfirmPassword').value = '';
            document.getElementById('profileModal').classList.remove('hidden');
        }

        function closeProfileModal() {
            document.getElementById('profileModal').classList.add('hidden');
        }

        async function handleProfileUpdate(event) {
            event.preventDefault();

            const displayName = document.getElementById('profileDisplayName').value.trim();
            const currentPassword = document.getElementById('profileCurrentPassword').value;
            const newPassword = document.getElementById('profileNewPassword').value;
            const confirmPassword = document.getElementById('profileConfirmPassword').value;

            if (!displayName) {
                showNotification('Display name is required', 'error');
                return;
            }

            // Validate password fields if changing password
            if (newPassword || confirmPassword || currentPassword) {
                if (!currentPassword) {
                    showNotification('Current password is required to change password', 'error');
                    return;
                }

                if (newPassword !== confirmPassword) {
                    showNotification('New passwords do not match', 'error');
                    return;
                }

                if (newPassword.length < 6) {
                    showNotification('New password must be at least 6 characters', 'error');
                    return;
                }
            }

            try {
                const updateData = {
                    display_name: displayName
                };

                if (newPassword) {
                    updateData.current_password = currentPassword;
                    updateData.password = newPassword;
                }

                const response = await fetch('/api/profile', {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to update profile');
                }

                // Update local storage with new user info
                const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
                const updatedUser = { ...currentUser, ...data.user };
                localStorage.setItem('user', JSON.stringify(updatedUser));

                // Update display name in the UI
                document.getElementById('teacherName').textContent = data.user.display_name;

                closeProfileModal();
                showNotification('Profile updated successfully!', 'success');
            } catch (error) {
                console.error('Profile update error:', error);
                showNotification(error.message || 'Failed to update profile', 'error');
            }
        }

        window.showProfileModal = showProfileModal;
        window.closeProfileModal = closeProfileModal;

        async function handleEditCourse(event) {
            event.preventDefault();

            const courseId = document.getElementById('editCourseId').value;
            const title = document.getElementById('editCourseTitle').value.trim();
            const description = document.getElementById('editCourseDescription').value.trim();
            const docsRepoUrl = document.getElementById('editDocsRepoUrl').value.trim();
            const docsBranch = document.getElementById('editDocsBranch').value.trim();
            const passkey = document.getElementById('editCoursePasskey').value.trim();

            if (!title) {
                showNotification('Course title is required', 'error');
                return;
            }

            if (passkey && passkey.length < 4) {
                showNotification('Passkey must be at least 4 characters', 'error');
                return;
            }

            try {
                const payload = {
                    title,
                    description,
                    docs_repo_url: docsRepoUrl || null,
                    docs_branch: docsBranch || 'main'
                };

                // Only include passkey if it's being changed
                if (passkey) {
                    payload.access_code = passkey;
                }

                const response = await fetch(`/api/courses/${courseId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to update course');
                }

                // Show success message
                if (data.passkey_updated) {
                    showNotification('Course updated! Passkey has been changed.', 'success');
                } else {
                    showNotification('Course updated successfully', 'success');
                }

                // Close modal
                closeEditCourseModal();

                // Reload courses
                await loadTeacherCourses();

                // If this is the selected course, update the header
                if (selectedCourseId === courseId) {
                    const updatedCourse = teacherCourses.find(c => c.id === courseId);
                    if (updatedCourse) {
                        updateTeacherCourseHeader(updatedCourse);
                    }
                }
            } catch (error) {
                console.error('Edit course error:', error);
                showNotification(error.message || 'Failed to update course', 'error');
            }
        }

        async function deleteCourse(courseId) {
            const course = teacherCourses.find(item => item.id === courseId);
            const courseName = course ? course.title : 'this course';

            if (!confirm(`Delete ${courseName}? This will also remove enrollments.`)) {
                return;
            }

            try {
                const response = await fetch(`/api/courses/${courseId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to delete course');
                }

                showNotification('Course deleted', 'success');
                if (selectedCourseId === courseId) {
                    returnToTeacherLobby(true);
                }
                await loadTeacherCourses();
            } catch (error) {
                console.error('Delete course error:', error);
                showNotification(error.message || 'Failed to delete course.', 'error');
            }
        }

        window.returnToTeacherLobby = returnToTeacherLobby;

        // Initialize
        window.addEventListener('load', () => {
            token = localStorage.getItem('token');
            const userData = localStorage.getItem('user');
            
            if (!token || !userData) {
                window.location.href = '/';
                return;
            }

            try {
                user = JSON.parse(userData);
                if (user.role !== 'teacher') {
                    window.location.href = '/';
                    return;
                }
                
                const displayName = user.display_name || user.username || 'Teacher';
                document.getElementById('teacherName').textContent = displayName;

                const storedCourseId = localStorage.getItem('teacherSelectedCourseId');
                if (storedCourseId) {
                    selectedCourseId = storedCourseId;
                }

                const createCourseForm = document.getElementById('createCourseLobbyForm');
                if (createCourseForm) {
                    createCourseForm.addEventListener('submit', handleCreateCourse);
                }

                const editCourseForm = document.getElementById('editCourseForm');
                if (editCourseForm) {
                    editCourseForm.addEventListener('submit', handleEditCourse);
                }

                // Close modal when clicking outside
                const editModal = document.getElementById('editCourseModal');
                if (editModal) {
                    editModal.addEventListener('click', (e) => {
                        if (e.target === editModal) {
                            closeEditCourseModal();
                        }
                    });
                }

                const exportModal = document.getElementById('exportCsvModal');
                if (exportModal) {
                    exportModal.addEventListener('click', (e) => {
                        if (e.target === exportModal) {
                            closeExportModal();
                        }
                    });
                }

                const profileModal = document.getElementById('profileModal');
                if (profileModal) {
                    profileModal.addEventListener('click', (e) => {
                        if (e.target === profileModal) {
                            closeProfileModal();
                        }
                    });
                }

                const profileForm = document.getElementById('profileForm');
                if (profileForm) {
                    profileForm.addEventListener('submit', handleProfileUpdate);
                }

                const generateButton = document.getElementById('generateLobbyPasskey');
                if (generateButton) {
                    generateButton.addEventListener('click', () => {
                        lastGeneratedPasskey = generateReadablePasskey();
                        setPasskeyValue(lastGeneratedPasskey);
                    });
                }

                // Setup all UI button event listeners
                const profileBtn = document.getElementById('profileBtn');
                if (profileBtn) profileBtn.addEventListener('click', showProfileModal);

                const teacherLogoutBtn = document.getElementById('teacherLogoutBtn');
                if (teacherLogoutBtn) teacherLogoutBtn.addEventListener('click', logout);

                const exportCsvBtn = document.getElementById('exportCsvBtn');
                if (exportCsvBtn) exportCsvBtn.addEventListener('click', showExportModal);

                const pushAnswersBtn = document.getElementById('pushAnswersBtn');
                if (pushAnswersBtn) pushAnswersBtn.addEventListener('click', showPushAnswersConfirm);

                const studentScoresBtn = document.getElementById('studentScoresBtn');
                if (studentScoresBtn) studentScoresBtn.addEventListener('click', showStudentScores);

                const multiQuizMonitorBtn = document.getElementById('multiQuizMonitorBtn');
                if (multiQuizMonitorBtn) multiQuizMonitorBtn.addEventListener('click', openMultiQuizMonitor);

                const viewProgressBtn = document.getElementById('viewProgressBtn');
                if (viewProgressBtn) viewProgressBtn.addEventListener('click', openCourseProgress);

                const backToTeacherLobbyBtn = document.getElementById('backToTeacherLobbyBtn');
                if (backToTeacherLobbyBtn) backToTeacherLobbyBtn.addEventListener('click', returnToTeacherLobby);

                const manageCategoriesBtn = document.getElementById('manageCategoriesBtn');
                if (manageCategoriesBtn) manageCategoriesBtn.addEventListener('click', showCategoryManager);

                const createAssignmentBtn = document.getElementById('createAssignmentBtn');
                if (createAssignmentBtn) createAssignmentBtn.addEventListener('click', showCreateAssignmentModal);

                const toggleTeacherDocsBtn = document.getElementById('toggleTeacherDocsBtn');
                if (toggleTeacherDocsBtn) toggleTeacherDocsBtn.addEventListener('click', toggleTeacherDocsView);

                const openTeacherDocsTabBtn = document.getElementById('openTeacherDocsTabBtn');
                if (openTeacherDocsTabBtn) openTeacherDocsTabBtn.addEventListener('click', openTeacherDocsNewTab);

                const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
                if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);

                const exportQuizzesBtn = document.getElementById('exportQuizzesBtn');
                if (exportQuizzesBtn) exportQuizzesBtn.addEventListener('click', showExportQuizzesModal);

                const importQuizzesBtn = document.getElementById('importQuizzesBtn');
                if (importQuizzesBtn) importQuizzesBtn.addEventListener('click', showImportQuizzesModal);

                const selectAllQuizzesBtn = document.getElementById('selectAllQuizzesBtn');
                if (selectAllQuizzesBtn) selectAllQuizzesBtn.addEventListener('click', () => selectAllQuizzes(true));

                const deselectAllQuizzesBtn = document.getElementById('deselectAllQuizzesBtn');
                if (deselectAllQuizzesBtn) deselectAllQuizzesBtn.addEventListener('click', () => selectAllQuizzes(false));

                const exportSelectedBtn = document.getElementById('exportSelectedBtn');
                if (exportSelectedBtn) exportSelectedBtn.addEventListener('click', exportSelectedQuizzes);

                const exportAllBtn = document.getElementById('exportAllBtn');
                if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllQuizzes);

                const cancelExportQuizzesBtn = document.getElementById('cancelExportQuizzesBtn');
                if (cancelExportQuizzesBtn) cancelExportQuizzesBtn.addEventListener('click', closeExportQuizzesModal);

                const importBtn = document.getElementById('importBtn');
                if (importBtn) importBtn.addEventListener('click', importQuizzes);

                const cancelImportBtn = document.getElementById('cancelImportBtn');
                if (cancelImportBtn) cancelImportBtn.addEventListener('click', closeImportQuizzesModal);

                const closeEditCourseBtn = document.getElementById('closeEditCourseBtn');
                if (closeEditCourseBtn) closeEditCourseBtn.addEventListener('click', closeEditCourseModal);

                const cancelEditCourseBtn = document.getElementById('cancelEditCourseBtn');
                if (cancelEditCourseBtn) cancelEditCourseBtn.addEventListener('click', closeEditCourseModal);

                const closeExportCsvBtn = document.getElementById('closeExportCsvBtn');
                if (closeExportCsvBtn) closeExportCsvBtn.addEventListener('click', closeExportModal);

                const exportBasicBtn = document.getElementById('exportBasicBtn');
                if (exportBasicBtn) exportBasicBtn.addEventListener('click', () => exportCSV('basic'));

                const exportFullBtn = document.getElementById('exportFullBtn');
                if (exportFullBtn) exportFullBtn.addEventListener('click', () => exportCSV('full'));

                const cancelExportCsvBtn = document.getElementById('cancelExportCsvBtn');
                if (cancelExportCsvBtn) cancelExportCsvBtn.addEventListener('click', closeExportModal);

                const closeProfileBtn = document.getElementById('closeProfileBtn');
                if (closeProfileBtn) closeProfileBtn.addEventListener('click', closeProfileModal);

                const cancelProfileBtn = document.getElementById('cancelProfileBtn');
                if (cancelProfileBtn) cancelProfileBtn.addEventListener('click', closeProfileModal);

                const closeAssignmentBtn = document.getElementById('closeAssignmentBtn');
                if (closeAssignmentBtn) closeAssignmentBtn.addEventListener('click', closeAssignmentModal);

                const assignmentForm = document.getElementById('assignmentForm');
                if (assignmentForm) assignmentForm.addEventListener('submit', saveAssignment);

                const removeImageBtn = document.getElementById('removeImageBtn');
                if (removeImageBtn) removeImageBtn.addEventListener('click', removeImage);

                const cancelAssignmentBtn = document.getElementById('cancelAssignmentBtn');
                if (cancelAssignmentBtn) cancelAssignmentBtn.addEventListener('click', closeAssignmentModal);

                const closeSubmissionsBtn = document.getElementById('closeSubmissionsBtn');
                if (closeSubmissionsBtn) closeSubmissionsBtn.addEventListener('click', closeSubmissionsModal);

                const deadlineTypeSelect = document.getElementById('deadlineType');
                if (deadlineTypeSelect) deadlineTypeSelect.addEventListener('change', toggleDeadlineFields);

                renderTeacherLobby();
                initializeSocket();
                loadTeacherCourses();
            } catch (error) {
                console.error('Error parsing user data:', error);
                window.location.href = '/';
            }
        });

        // Socket initialization
        function initializeSocket() {
            socket = io();
            
            socket.on('connect', () => {
                socket.emit('auth', { token });
            });

            socket.on('auth_ok', (data) => {
                console.log('Authenticated as teacher');
            });

            socket.on('auth_error', (data) => {
                console.error('Authentication failed:', data.message);
                logout();
            });

            socket.on('online_students', (data) => {
                onlineStudents = data.students;
                updateOnlineStudentsList();
            });

            socket.on('quiz_response', (data) => {
                handleQuizResponse(data);
                showNotification(`${data.display_name} answered quiz`, 'success');
            });

            socket.on('push_created', (data) => {
                showNotification(`Quiz pushed to ${data.target_count} students`, 'success');
                // Reload active pushes to update UI
                loadActivePushes().then(() => renderQuizzes());
                updateQueueStatus(data);
            });

            socket.on('push_undone', (data) => {
                showNotification('Quiz undone', 'info');
                // Reload active pushes to update UI
                loadActivePushes().then(() => renderQuizzes());
                updateQueueStatus();
            });

            socket.on('quizPushConfirmed', (data) => {
                if (data.queuePosition === 'active') {
                    showNotification(`Quiz "${data.title}" is now active`, 'success');
                } else {
                    showNotification(`Quiz "${data.title}" added to queue`, 'info');
                }
                updateQueueStatus();
            });
        }

        // Quiz form handling
        document.getElementById('questionType').addEventListener('change', function() {
            const questionType = this.value;
            const optionsGroup = document.getElementById('optionsGroup');
            const optionsPreviewGroup = document.getElementById('optionsPreviewGroup');
            const textAnswerGroup = document.getElementById('textAnswerGroup');
            
            if (questionType === 'select' || questionType === 'checkbox') {
                optionsGroup.classList.remove('hidden');
                optionsPreviewGroup.classList.remove('hidden');
                textAnswerGroup.classList.add('hidden');
            } else {
                optionsGroup.classList.add('hidden');
                optionsPreviewGroup.classList.add('hidden');
                textAnswerGroup.classList.remove('hidden');
            }
            
            updateOptionsPreview();
        });

        // Update options preview when options are changed
        document.getElementById('quizOptions').addEventListener('input', updateOptionsPreview);

        function updateOptionsPreview() {
            const questionType = document.getElementById('questionType').value;
            const optionsText = document.getElementById('quizOptions').value;
            const previewContainer = document.getElementById('optionsPreview');
            
            if (questionType !== 'select' && questionType !== 'checkbox') {
                return;
            }
            
            const options = optionsText.split('\n').filter(opt => opt.trim());
            
            if (options.length === 0) {
                previewContainer.innerHTML = '<p style="color: #6b7280; font-style: italic;">Enter options above to preview...</p>';
                return;
            }
            
            let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
            
            if (questionType === 'select') {
                // Radio buttons for single selection
                options.forEach((option, index) => {
                    const cleanOption = option.trim();
                    html += `
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px; border: 2px solid #e5e7eb; border-radius: 6px; background: white;" data-option-index="${index}">
                            <input type="radio" name="correctAnswerPreview" value="${index}" style="cursor: pointer;">
                            <span>${escapeHtml(cleanOption)}</span>
                        </label>
                    `;
                });
            } else if (questionType === 'checkbox') {
                // Checkboxes for multiple selection
                options.forEach((option, index) => {
                    const cleanOption = option.trim();
                    html += `
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px; border: 2px solid #e5e7eb; border-radius: 6px; background: white;" data-option-index="${index}">
                            <input type="checkbox" name="correctAnswerPreview" value="${index}" style="cursor: pointer;">
                            <span>${escapeHtml(cleanOption)}</span>
                        </label>
                    `;
                });
            }
            
            html += '</div>';
            html += '<p style="margin-top: 10px; font-size: 13px; color: #6b7280;">Click to select the correct answer(s)</p>';
            
            previewContainer.innerHTML = html;
            
            // Add event listeners to update hidden correct answer field
            const inputs = previewContainer.querySelectorAll('input[name="correctAnswerPreview"]');
            inputs.forEach(input => {
                input.addEventListener('change', updateCorrectAnswerFromPreview);
            });
        }

        function updateCorrectAnswerFromPreview() {
            const questionType = document.getElementById('questionType').value;
            const optionsText = document.getElementById('quizOptions').value;
            const options = optionsText.split('\n').filter(opt => opt.trim()).map(opt => opt.trim());
            const inputs = document.querySelectorAll('input[name="correctAnswerPreview"]:checked');
            
            if (questionType === 'select') {
                // Single selection - get the selected option text
                if (inputs.length > 0) {
                    const index = parseInt(inputs[0].value);
                    document.getElementById('correctAnswer').value = options[index] || '';
                }
            } else if (questionType === 'checkbox') {
                // Multiple selection - get array of selected option texts
                const selectedOptions = Array.from(inputs).map(input => {
                    const index = parseInt(input.value);
                    return options[index];
                });
                document.getElementById('correctAnswer').value = JSON.stringify(selectedOptions);
            }
        }

        // Handle scoring checkbox
        document.getElementById('isScored').addEventListener('change', function() {
            const pointsGroup = document.getElementById('pointsGroup');
            if (this.checked) {
                pointsGroup.style.display = 'block';
            } else {
                pointsGroup.style.display = 'none';
            }
        });

        // Set up form handler - use a flag to track mode
        let isEditMode = false;
        let currentEditQuizId = null;

        document.getElementById('createQuizForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (isEditMode && currentEditQuizId) {
                await updateQuiz(currentEditQuizId);
            } else {
                await createQuizHandler(e);
            }
        });

        // Load quizzes
        async function loadQuizzes() {
            if (!selectedCourseId) {
                quizzes = [];
                renderQuizzes();
                return;
            }

            try {
                const response = await fetch(`/api/quizzes?courseId=${encodeURIComponent(selectedCourseId)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    quizzes = data.quizzes;
                    
                    // Load active pushes
                    await loadActivePushes();
                    
                    renderQuizzes();
                }
            } catch (error) {
                console.error('Load quizzes error:', error);
            }
        }

        // Load active pushes from server
        async function loadActivePushes() {
            if (!selectedCourseId) {
                activePushesByQuiz.clear();
                return;
            }
            try {
                const response = await fetch(`/api/queue-status?courseId=${encodeURIComponent(selectedCourseId)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok && data.active_pushes) {
                    // Clear and rebuild activePushes map
                    activePushesByQuiz.clear();
                    data.active_pushes.forEach(push => {
                        const key = String(push.quiz_id || '').trim();
                        if (key) {
                            activePushesByQuiz.set(key, push);
                        }
                    });
                }
            } catch (error) {
                console.error('Load active pushes error:', error);
            }
        }

        // Render quizzes
        function renderQuizzes() {
            const quizList = document.getElementById('quizList');
            if (!selectedCourseId) {
                quizList.innerHTML = '<div class="quiz-item"><p>Select a course to manage quizzes.</p></div>';
                return;
            }
            
            if (quizzes.length === 0) {
                quizList.innerHTML = '<div class="quiz-item"><p>No quizzes created yet</p></div>';
                return;
            }

            // Group quizzes by category
            const grouped = {};
            quizzes.forEach(quiz => {
                const categoryName = quiz.category_name || 'Uncategorized';
                if (!grouped[categoryName]) {
                    grouped[categoryName] = [];
                }
                grouped[categoryName].push(quiz);
            });

            quizList.innerHTML = Object.keys(grouped).map(categoryName => {
                const categoryQuizzes = grouped[categoryName];
                return `
                    <div class="category-section">
                        <h4 class="category-title">${categoryName} (${categoryQuizzes.length})</h4>
                        ${categoryQuizzes.map(quiz => {
                            const quizIdSafe = escapeHtml(String(quiz.id));
                            const quizKey = String(quiz.id || '').trim();
                            const activePush = quizKey ? activePushesByQuiz.get(quizKey) : null;
                            const isSent = !!activePush;
                            const sentTime = isSent ? new Date(activePush.started_at).toLocaleTimeString() : '';
                            
                            const activePushId = activePush ? (activePush.push_id || activePush.id || '') : '';
                            const activePushIdEscaped = escapeHtml(String(activePushId));
                            return `
                            <div class="quiz-item" data-quiz-id="${quiz.id}">
                                <input type="checkbox" class="quiz-checkbox" data-quiz-id="${quiz.id}" ${isSent ? 'disabled' : ''}>
                                <h5>
                                    ${quiz.title}
                                    ${isSent ? `<span class="sent-badge">📤 SENT at ${sentTime}</span>` : ''}
                                </h5>
                                <span class="quiz-id-label">ID: ${quizIdSafe}</span>
                                <div class="quiz-info">
                                    Type: ${quiz.question_type} | Timeout: ${quiz.timeout_seconds}s
                                    ${quiz.question_type === 'select' ? `| ${quiz.options.length} options` : ''}
                                    ${quiz.is_scored ? `| <span style="color: #28a745; font-weight: bold;">📊 ${quiz.points || 1} pts</span>` : `| <span style="color: #666;">Non-scored</span>`}
                                    ${quiz.correct_answer ? `<br>Answer: <strong>${quiz.correct_answer}</strong>` : ''}
                                </div>
                                <div class="quiz-actions" data-quiz-id="${quiz.id}">
                                    <button class="btn btn-sm btn-secondary" data-action="edit">
                                        Edit
                                    </button>
                                    <button class="btn btn-sm btn-info" data-action="view-responses">
                                        Responses
                                    </button>
                                    <button class="btn btn-sm btn-danger" data-action="delete">
                                        Delete
                                    </button>
                                    <button class="btn btn-sm btn-primary push-btn" data-action="push" ${isSent ? 'disabled' : ''}>
                                        ${isSent ? 'Pushed' : 'Push'}
                                    </button>
                                    ${isSent ? `
                                        <button class="btn btn-sm undo-sent-btn" data-push-id="${activePushIdEscaped}" data-action="undo" title="Undo this sent quiz">
                                            🔙 Undo
                                        </button>
                                    ` : ''}
                                </div>
                                <div class="responses-section" id="responses-${quiz.id}"></div>
                            </div>
                        `;
                        }).join('')}
                    </div>
                `;
            }).join('');
            
            // Setup event listeners for quiz actions
            setupQuizEventListeners();
        }

        // Setup event listeners for quiz actions using event delegation
        function setupQuizEventListeners() {
            const quizListContainer = document.getElementById('quizList');
            if (!quizListContainer) return;

            // Remove old listener if exists
            quizListContainer.removeEventListener('click', handleQuizActionClick);
            // Add new listener
            quizListContainer.addEventListener('click', handleQuizActionClick);

            // Setup multi-select toggle button
            const toggleBtn = document.getElementById('toggleMultiSelectBtn');
            if (toggleBtn) {
                toggleBtn.removeEventListener('click', toggleMultiSelect);
                toggleBtn.addEventListener('click', toggleMultiSelect);
            }

            // Setup push selected button
            const pushSelectedBtn = document.getElementById('pushSelectedBtn');
            if (pushSelectedBtn) {
                pushSelectedBtn.removeEventListener('click', pushSelectedQuizzes);
                pushSelectedBtn.addEventListener('click', pushSelectedQuizzes);
            }

            // Setup checkbox change handler (delegated)
            quizListContainer.removeEventListener('change', handleCheckboxChange);
            quizListContainer.addEventListener('change', handleCheckboxChange);
        }

        let isMultiSelectMode = false;

        function toggleMultiSelect() {
            isMultiSelectMode = !isMultiSelectMode;
            const quizListContainer = document.getElementById('quizList');
            const toggleBtn = document.getElementById('toggleMultiSelectBtn');
            const pushBtn = document.getElementById('pushSelectedBtn');
            
            if (isMultiSelectMode) {
                quizListContainer.classList.add('multi-select-mode');
                toggleBtn.textContent = '✖️ Cancel Multi-Select';
                toggleBtn.style.background = '#ff5252';
                if (pushBtn) pushBtn.style.display = 'inline-block';
            } else {
                quizListContainer.classList.remove('multi-select-mode');
                toggleBtn.textContent = '☑️ Multi-Select';
                toggleBtn.style.background = '#4CAF50';
                if (pushBtn) pushBtn.style.display = 'none';
                
                // Clear all checkboxes
                document.querySelectorAll('.quiz-checkbox:checked').forEach(cb => cb.checked = false);
                document.querySelectorAll('.quiz-item.selected').forEach(item => item.classList.remove('selected'));
                updateSelectedCount();
            }
        }

        function handleCheckboxChange(event) {
            if (!event.target.classList.contains('quiz-checkbox')) return;
            
            const quizItem = event.target.closest('.quiz-item');
            if (event.target.checked) {
                quizItem.classList.add('selected');
            } else {
                quizItem.classList.remove('selected');
            }
            updateSelectedCount();
        }

        function updateSelectedCount() {
            const count = document.querySelectorAll('.quiz-checkbox:checked').length;
            const countSpan = document.getElementById('selectedCount');
            const pushBtn = document.getElementById('pushSelectedBtn');
            
            if (countSpan) countSpan.textContent = count;
            if (pushBtn) pushBtn.disabled = count === 0;
        }

        async function pushSelectedQuizzes() {
            if (!selectedCourseId) {
                showNotification('Select a course before pushing quizzes.', 'error');
                return;
            }

            const checkboxes = document.querySelectorAll('.quiz-checkbox:checked');
            const quizIds = Array.from(checkboxes).map(cb => cb.getAttribute('data-quiz-id'));
            
            if (quizIds.length === 0) {
                showNotification('No quizzes selected', 'warning');
                return;
            }

            const pushBtn = document.getElementById('pushSelectedBtn');
            const originalText = pushBtn.textContent;
            pushBtn.disabled = true;
            pushBtn.textContent = '⏳ Pushing...';

            try {
                const response = await fetch('/api/pushes/bulk', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        quiz_ids: quizIds,
                        course_id: selectedCourseId
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Track active pushes
                    data.pushed_quizzes.forEach(result => {
                        const quiz = quizzes.find(q => String(q.id) === String(result.quiz_id));
                        const pushedMeta = {
                            push_id: result.push_id,
                            quiz_id: String(result.quiz_id),
                            course_id: selectedCourseId,
                            started_at: new Date().toISOString(),
                            title: result.quiz_title
                        };
                        const mapKey = String(result.quiz_id || '').trim();
                        if (mapKey) {
                            activePushesByQuiz.set(mapKey, pushedMeta);
                            activeResponses.set(result.push_id, []);
                        }
                    });

                    // Clear selection and exit multi-select mode
                    isMultiSelectMode = false;
                    const quizListContainer = document.getElementById('quizList');
                    quizListContainer.classList.remove('multi-select-mode');
                    const toggleBtn = document.getElementById('toggleMultiSelectBtn');
                    toggleBtn.textContent = '☑️ Multi-Select';
                    toggleBtn.style.background = '#4CAF50';
                    pushBtn.style.display = 'none';
                    
                    document.querySelectorAll('.quiz-checkbox:checked').forEach(cb => cb.checked = false);
                    document.querySelectorAll('.quiz-item.selected').forEach(item => item.classList.remove('selected'));
                    updateSelectedCount();
                    
                    // Re-render to show sent badges
                    renderQuizzes();
                    updateQueueStatus();

                    const successMsg = `Pushed ${data.pushed_quizzes.length} quiz${data.pushed_quizzes.length > 1 ? 'zes' : ''} to ${data.total_students} student${data.total_students > 1 ? 's' : ''}`;
                    if (data.failed_quizzes.length > 0) {
                        showNotification(`${successMsg}. ${data.failed_quizzes.length} failed.`, 'warning');
                    } else {
                        showNotification(successMsg, 'success');
                    }
                } else {
                    showNotification(data.error || 'Failed to push quizzes', 'error');
                }
            } catch (error) {
                console.error('Bulk push error:', error);
                showNotification('Network error', 'error');
            } finally {
                pushBtn.disabled = false;
                pushBtn.textContent = originalText;
            }
        }

        function handleQuizActionClick(event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const action = button.getAttribute('data-action');
            const quizActionsDiv = button.closest('.quiz-actions');
            const quizId = quizActionsDiv?.getAttribute('data-quiz-id');
            
            if (!quizId) return;

            switch (action) {
                case 'edit':
                    editQuiz(quizId);
                    break;
                case 'view-responses':
                    viewResponses(quizId);
                    break;
                case 'delete':
                    deleteQuiz(quizId);
                    break;
                case 'push':
                    if (!button.disabled) {
                        pushQuiz(quizId);
                    }
                    break;
                case 'undo':
                    const pushId = button.getAttribute('data-push-id');
                    if (pushId) {
                        undoPushByQuizId(quizId, pushId);
                    }
                    break;
            }
        }

        // Push quiz to students
        async function pushQuiz(quizId) {
            if (!selectedCourseId) {
                showNotification('Select a course before pushing quizzes.', 'error');
                return;
            }
            try {
                const response = await fetch('/api/pushes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        quiz_id: quizId,
                        target_scope: 'all',
                        course_id: selectedCourseId
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Track this active push
                    const quiz = quizzes.find(q => String(q.id) === String(quizId));
                    const pushedMeta = {
                        push_id: data.push.id,
                        quiz_id: String(quizId),
                        course_id: selectedCourseId,
                        started_at: new Date().toISOString(),
                        title: quiz ? quiz.title : 'Unknown'
                    };
                    const mapKey = String(quizId || '').trim();
                    if (mapKey) {
                        activePushesByQuiz.set(mapKey, pushedMeta);
                    }
                    
                    // Re-render to show sent badge
                    renderQuizzes();
                    
                    // Initialize responses section
                    activeResponses.set(data.push.id, []);
                    updateQueueStatus();

                    // Note: Use the Multi-Quiz Monitor button to view all active quizzes
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Push quiz error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Undo quiz push by quiz ID
        async function undoPushByQuizId(quizId, pushId = '') {
            try {
                const normalizedQuizId = (quizId && typeof quizId === 'string') ? quizId.trim() : String(quizId || '').trim();
                const quizKey = normalizedQuizId || String(quizId || '').trim();
                const activePush = activePushesByQuiz.get(quizKey);
                const candidatePushId = pushId && pushId.trim() ? pushId.trim() : '';
                const fallbackIdentifier = candidatePushId || (activePush ? (activePush.push_id || activePush.id || '') : '');
                const identifier = normalizedQuizId || fallbackIdentifier;

                if (!identifier) {
                    showNotification('Unable to determine which push to undo', 'error');
                    return;
                }

                const response = await fetch(`/api/pushes/${encodeURIComponent(identifier)}/undo`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Remove from active pushes
                    activePushesByQuiz.delete(quizKey);
                    const resolvedPushId = activePush ? (activePush.push_id || activePush.id || '') : fallbackIdentifier;
                    if (resolvedPushId) {
                        activeResponses.delete(resolvedPushId);
                    }
                    
                    // Re-render to remove sent badge
                    renderQuizzes();
                    
                    showNotification('Quiz undone successfully', 'success');
                    updateQueueStatus();
                } else {
                    showNotification(data.error || 'Failed to undo quiz', 'error');
                }
            } catch (error) {
                console.error('Undo push error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Undo quiz push
        async function undoPush(quizId) {
            await undoPushByQuizId(quizId);
        }

        // Update quiz buttons after undo
        function updateQuizButtons() {
            document.querySelectorAll('.quiz-item').forEach(item => {
                const pushBtn = item.querySelector('.push-btn');
                const undoBtn = item.querySelector('.undo-btn');
                
                pushBtn.disabled = false;
                pushBtn.textContent = 'Push to Students';
                undoBtn.classList.add('hidden');
                undoBtn.disabled = true;
            });
        }

        // Handle quiz response
        function handleQuizResponse(data) {
            if (!activeResponses.has(data.push_id)) {
                activeResponses.set(data.push_id, []);
            }
            
            const responses = activeResponses.get(data.push_id);
            responses.push(data);
            
            // Find the quiz and update responses display
            const quiz = quizzes.find(q => q.id === data.quiz_id);
            if (quiz) {
                updateResponsesDisplay(quiz.id, data.push_id, responses);
            }
        }

        // Update responses display
        function updateResponsesDisplay(quizId, pushId, responses) {
            const responsesContainer = document.getElementById(`responses-${quizId}`);
            
            if (responses.length === 0) {
                responsesContainer.innerHTML = '';
                return;
            }

            responsesContainer.innerHTML = `
                <h5>Responses (${responses.length})</h5>
                ${responses.map(response => `
                    <div class="response-item response-${response.status}">
                        <strong>${response.display_name}</strong>: 
                        ${response.status === 'answered' 
                            ? `${JSON.stringify(response.answer)} (${(response.elapsed_ms/1000).toFixed(1)}s)`
                            : response.status
                        }
                    </div>
                `).join('')}
            `;
        }

        // Update online students list
        function updateOnlineStudentsList() {
            const studentsContainer = document.getElementById('onlineStudents');
            const countElement = document.getElementById('studentCount');

            if (!studentsContainer || !countElement) {
                return;
            }

            const visibleStudents = selectedCourseId
                ? onlineStudents.filter(student => Array.isArray(student.enrolled_course_ids) && student.enrolled_course_ids.includes(selectedCourseId))
                : onlineStudents;

            countElement.textContent = visibleStudents.length;

            if (visibleStudents.length === 0) {
                const message = selectedCourseId
                    ? 'No enrolled students are currently online for this course'
                    : 'No students online';
                studentsContainer.innerHTML = `<div class="student-item">${message}</div>`;
                if (activeStudentDetailId) {
                    closeStudentDetail();
                }
                return;
            }

            studentsContainer.innerHTML = visibleStudents.map(student => {
                const displayNameValue = student.display_name ? escapeHtml(student.display_name) : 'Not set';
                const usernameValue = escapeHtml(student.username || 'Unknown');
                const displayLine = `<strong>Display Name:</strong> ${displayNameValue}`;
                const usernameLine = `<strong>Username:</strong> ${usernameValue}`;
                const connectedAt = formatTimeOfDay(student.connected_at);
                const courseTitle = getCourseTitle(student.active_course_id);
                const courseLine = `<strong>Course:</strong> ${courseTitle ? escapeHtml(courseTitle) : 'None'}`;
                const attendanceStatus = student.attendance_status ? escapeHtml(student.attendance_status) : null;
                const attendanceDuration = formatDuration(student.attendance_duration_seconds);
                const showDuration = attendanceStatus && attendanceDuration !== 'Not available';
                const attendanceLine = attendanceStatus
                    ? `<strong>Attendance:</strong> ${attendanceStatus}${showDuration ? ` | ${attendanceDuration}` : ''}`
                    : `<strong>Online since:</strong> ${connectedAt}`;
                const tabState = `<strong>Tab state:</strong> ${escapeHtml(describeTabState(student))}`;

                const queueLengthValue = Number(student.queue_length);
                const queueLength = Number.isFinite(queueLengthValue) ? queueLengthValue : 0;
                const pendingCountValue = Number(student.pending_count);
                const pendingCount = Number.isFinite(pendingCountValue) ? pendingCountValue : 0;

                let queueInfo = '';
                if (queueLength > 0) {
                    if (student.current_quiz && student.current_quiz.title) {
                        queueInfo += `<div class="queue-info viewing">📝 Viewing: ${escapeHtml(student.current_quiz.title)}</div>`;
                    }
                    if (pendingCount > 0) {
                        queueInfo += `<div class="queue-info pending">⏳ ${pendingCount} pending</div>`;
                    }
                    if (!queueInfo) {
                        queueInfo = `<div class="queue-info pending">⏳ ${queueLength} queued</div>`;
                    }
                } else {
                    queueInfo = '<div class="queue-info">✅ No pending quizzes</div>';
                }

                return `
                    <div class="student-item interactive" role="button" tabindex="0" data-student-id="${escapeHtml(String(student.user_id))}">
                        <div class="name">
                            <span class="status-indicator status-online"></span>
                            <span class="label-text">${displayLine}</span>
                        </div>
                        <div class="meta-line">${usernameLine}</div>
                        <div class="status">${attendanceLine}</div>
                        <div class="meta-line">${courseLine}</div>
                        <div class="meta-line">${tabState}</div>
                        ${queueInfo}
                    </div>
                `;
            }).join('');

            studentsContainer.querySelectorAll('.student-item.interactive').forEach(item => {
                const studentId = item.getAttribute('data-student-id');
                item.addEventListener('click', () => openStudentDetail(studentId));
                item.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openStudentDetail(studentId);
                    }
                });
            });

            if (activeStudentDetailId) {
                const activeStudent = onlineStudents.find(student => String(student.user_id) === String(activeStudentDetailId));
                if (activeStudent) {
                    const modal = document.getElementById('studentDetailModal');
                    const body = document.getElementById('studentDetailBody');
                    if (modal && body && !modal.classList.contains('hidden')) {
                        body.innerHTML = renderStudentDetailHtml(activeStudent);
                    }
                } else {
                    closeStudentDetail();
                }
            }
        }

        // Show notification
        function showNotification(message, type, duration = 3000) {
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            
            // Create notification content
            const textSpan = document.createElement('span');
            textSpan.className = 'notification-text';
            textSpan.textContent = message;
            notification.appendChild(textSpan);
            
            // Add progress bar if duration is 0 (manual control)
            if (duration === 0) {
                const progressBarContainer = document.createElement('div');
                progressBarContainer.className = 'progress-bar-container';
                progressBarContainer.style.cssText = 'width: 100%; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px; margin-top: 8px; overflow: hidden;';
                
                const progressBar = document.createElement('div');
                progressBar.className = 'progress-bar';
                progressBar.style.cssText = 'width: 0%; height: 100%; background: #4CAF50; transition: width 0.3s ease;';
                
                progressBarContainer.appendChild(progressBar);
                notification.appendChild(progressBarContainer);
            }
            
            document.body.appendChild(notification);
            
            if (duration > 0) {
                setTimeout(() => {
                    notification.remove();
                }, duration);
            }
            
            return notification;
        }

        // Load categories
        async function loadCategories() {
            if (!selectedCourseId) {
                categories = [];
                renderCategoryOptions();
                return;
            }

            try {
                const response = await fetch(`/api/categories?courseId=${encodeURIComponent(selectedCourseId)}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    categories = data.categories;
                    renderCategoryOptions();
                }
            } catch (error) {
                console.error('Load categories error:', error);
            }
        }

        // Render category options in dropdown
        function renderCategoryOptions() {
            const select = document.getElementById('quizCategory');
            const currentValue = select.value;
            
            select.innerHTML = '<option value="">No Category</option>';
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name;
                select.appendChild(option);
            });
            
            // Restore selected value if it exists
            if (currentValue) {
                select.value = currentValue;
            }
        }

        // Show category manager modal
        function showCategoryManager() {
            const modal = document.createElement('div');
            modal.id = 'categoryModal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.5); z-index: 1000; 
                display: flex; align-items: center; justify-content: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white; padding: 20px; border-radius: 8px; 
                max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
            `;

            content.innerHTML = `
                <h3>Manage Categories</h3>
                <div style="margin-bottom: 20px; border: 1px solid #ddd; padding: 15px; border-radius: 4px;">
                    <h4 style="margin-top: 0;">Add New Category</h4>
                    <input type="text" id="newCategoryName" placeholder="Category name" style="width: 200px; padding: 8px; margin-right: 10px;">
                    <input type="text" id="newCategoryDesc" placeholder="Description" style="width: 200px; padding: 8px; margin-right: 10px;">
                    <button data-action="create-category" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Add Category</button>
                </div>
                <div id="categoryList" style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
                    ${renderCategoryListHTML()}
                </div>
                <button data-action="close-modal" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Close</button>
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Setup event listeners
            content.addEventListener('click', handleCategoryModalClick);

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeCategoryModal();
                }
            });
        }

        function handleCategoryModalClick(event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const action = button.getAttribute('data-action');
            const categoryId = button.getAttribute('data-category-id');

            switch (action) {
                case 'create-category':
                    createCategory();
                    break;
                case 'close-modal':
                    closeCategoryModal();
                    break;
                case 'edit-category':
                    editCategoryInline(categoryId);
                    break;
                case 'delete-category':
                    deleteCategory(categoryId);
                    break;
                case 'update-category':
                    updateCategory(categoryId);
                    break;
                case 'cancel-edit':
                    cancelEditCategory(categoryId);
                    break;
            }
        }

        // Render category list HTML
        function renderCategoryListHTML() {
            return categories.map(cat => `
                <div id="category-${cat.id}" style="padding: 10px; border: 1px solid #ddd; margin: 5px 0; border-radius: 4px;">
                    <div id="view-${cat.id}" style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${cat.name}</strong>
                            <br><small style="color: #666;">${cat.description || 'No description'}</small>
                        </div>
                        <div>
                            <button data-action="edit-category" data-category-id="${cat.id}" style="background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Edit</button>
                            <button data-action="delete-category" data-category-id="${cat.id}" style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Delete</button>
                        </div>
                    </div>
                    <div id="edit-${cat.id}" style="display: none;">
                        <input type="text" id="editName-${cat.id}" value="${cat.name}" style="width: 200px; padding: 8px; margin-right: 10px;">
                        <input type="text" id="editDesc-${cat.id}" value="${cat.description || ''}" style="width: 200px; padding: 8px; margin-right: 10px;">
                        <button data-action="update-category" data-category-id="${cat.id}" style="background: #007bff; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-right: 5px;">Save</button>
                        <button data-action="cancel-edit" data-category-id="${cat.id}" style="background: #6c757d; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Cancel</button>
                    </div>
                </div>
            `).join('');
        }

        // Close category modal
        function closeCategoryModal() {
            const modal = document.getElementById('categoryModal');
            if (modal) {
                modal.remove();
            }
            // No need to reload categories since we manage them in memory
            // loadCategories(); // This was causing potential duplication
        }

        // Edit category inline
        function editCategoryInline(categoryId) {
            document.getElementById(`view-${categoryId}`).style.display = 'none';
            document.getElementById(`edit-${categoryId}`).style.display = 'block';
        }

        // Cancel edit category
        function cancelEditCategory(categoryId) {
            document.getElementById(`view-${categoryId}`).style.display = 'flex';
            document.getElementById(`edit-${categoryId}`).style.display = 'none';
        }

        // Update category
        async function updateCategory(categoryId) {
            const name = document.getElementById(`editName-${categoryId}`).value.trim();
            const description = document.getElementById(`editDesc-${categoryId}`).value.trim();
            
            if (!name) {
                showNotification('Category name is required', 'error');
                return;
            }

            try {
                const response = await fetch(`/api/categories/${categoryId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ name, description })
                });

                const data = await response.json();
                
                if (response.ok) {
                    showNotification('Category updated successfully', 'success');
                    
                    // Update the category in the local array
                    const categoryIndex = categories.findIndex(cat => cat.id === categoryId);
                    if (categoryIndex !== -1) {
                        categories[categoryIndex].name = name;
                        categories[categoryIndex].description = description;
                    }
                    
                    // Refresh the modal content
                    const categoryList = document.getElementById('categoryList');
                    if (categoryList) {
                        categoryList.innerHTML = renderCategoryListHTML();
                    }
                    
                    // Refresh the dropdown
                    renderCategoryOptions();
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Update category error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Create category
        async function createCategory() {
            const name = document.getElementById('newCategoryName').value.trim();
            const description = document.getElementById('newCategoryDesc').value.trim();
            
            if (!name) {
                showNotification('Category name is required', 'error');
                return;
            }

            if (!selectedCourseId) {
                showNotification('Select a course before creating categories.', 'error');
                return;
            }

            try {
                const response = await fetch('/api/categories', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ name, description, course_id: selectedCourseId })
                });

                const data = await response.json();
                
                if (response.ok) {
                    document.getElementById('newCategoryName').value = '';
                    document.getElementById('newCategoryDesc').value = '';
                    showNotification('Category created successfully', 'success');
                    
                    // Add the new category to the local array
                    categories.push(data.category);
                    
                    // Refresh category list in modal
                    const categoryList = document.getElementById('categoryList');
                    if (categoryList) {
                        categoryList.innerHTML = renderCategoryListHTML();
                    }
                    
                    // Refresh the dropdown
                    renderCategoryOptions();
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Create category error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Delete category
        async function deleteCategory(categoryId) {
            if (!confirm('Are you sure you want to delete this category?')) {
                return;
            }

            try {
                const response = await fetch(`/api/categories/${categoryId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    showNotification('Category deleted successfully', 'success');
                    
                    // Remove the category from the local array
                    categories = categories.filter(cat => cat.id !== categoryId);
                    
                    // Refresh category list in modal
                    const categoryList = document.getElementById('categoryList');
                    if (categoryList) {
                        categoryList.innerHTML = renderCategoryListHTML();
                    }
                    
                    // Refresh the dropdown
                    renderCategoryOptions();
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Delete category error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Delete quiz
        async function deleteQuiz(quizId) {
            if (!confirm('Are you sure you want to delete this quiz?')) {
                return;
            }

            try {
                const response = await fetch(`/api/quizzes/${quizId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    showNotification('Quiz deleted successfully', 'success');
                    loadQuizzes();
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Delete quiz error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Export/Import Functions
        function showExportQuizzesModal() {
            const modal = document.getElementById('exportQuizzesModal');
            const listEl = document.getElementById('exportQuizList');
            
            if (quizzes.length === 0) {
                listEl.innerHTML = '<p style="color: #6b7280;">No quizzes to export</p>';
            } else {
                listEl.innerHTML = quizzes.map(quiz => `
                    <label style="display: flex; align-items: center; padding: 8px; cursor: pointer; border-bottom: 1px solid #e5e7eb;">
                        <input type="checkbox" class="export-quiz-checkbox" value="${quiz.id}" style="margin-right: 10px;">
                        <span><strong>${escapeHtml(quiz.title)}</strong> - ${quiz.question_type}</span>
                    </label>
                `).join('');
            }
            
            modal.classList.remove('hidden');
            
            // Close on background click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    closeExportQuizzesModal();
                }
            };
        }

        function closeExportQuizzesModal() {
            document.getElementById('exportQuizzesModal').classList.add('hidden');
        }

        function selectAllQuizzes(select) {
            const checkboxes = document.querySelectorAll('.export-quiz-checkbox');
            checkboxes.forEach(cb => cb.checked = select);
        }

        async function exportSelectedQuizzes() {
            const checkboxes = document.querySelectorAll('.export-quiz-checkbox:checked');
            const quizIds = Array.from(checkboxes).map(cb => cb.value);
            
            if (quizIds.length === 0) {
                showNotification('Please select at least one quiz to export', 'error');
                return;
            }
            
            await exportQuizzes(quizIds);
        }

        async function exportAllQuizzes() {
            if (quizzes.length === 0) {
                showNotification('No quizzes to export', 'error');
                return;
            }
            
            await exportQuizzes(null);
        }

        async function exportQuizzes(quizIds) {
            try {
                const format = document.querySelector('input[name="exportFormat"]:checked').value;
                
                const response = await fetch('/api/quizzes/export', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        quizIds: quizIds,
                        courseId: selectedCourseId
                    })
                });

                if (!response.ok) {
                    throw new Error('Export failed');
                }

                const data = await response.json();
                
                let blob, filename;
                
                if (format === 'markdown') {
                    // Convert to Markdown
                    const markdown = convertQuizzesToMarkdown(data.quizzes);
                    blob = new Blob([markdown], { type: 'text/markdown' });
                    filename = `quizzes_export_${new Date().toISOString().split('T')[0]}.md`;
                } else {
                    // Export as JSON
                    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    filename = `quizzes_export_${new Date().toISOString().split('T')[0]}.json`;
                }
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showNotification(`Exported ${data.count} quiz(es)`, 'success');
                closeExportQuizzesModal();
            } catch (error) {
                console.error('Export error:', error);
                showNotification('Export failed', 'error');
            }
        }

        function convertQuizzesToMarkdown(quizzes) {
            let markdown = `# Quiz Export\n\n`;
            markdown += `Exported on: ${new Date().toLocaleString()}\n`;
            markdown += `Total Quizzes: ${quizzes.length}\n\n`;
            markdown += `---\n\n`;

            quizzes.forEach((quiz, index) => {
                markdown += `## Quiz ${index + 1}: ${quiz.title}\n\n`;
                
                // Question content
                if (quiz.content_text) {
                    markdown += `**Question:**\n\n${quiz.content_text}\n\n`;
                }
                
                // Question type
                markdown += `**Type:** ${quiz.question_type}\n\n`;
                
                // Timeout
                if (quiz.timeout_seconds) {
                    markdown += `**Time Limit:** ${quiz.timeout_seconds} seconds\n\n`;
                }
                
                // Scoring
                if (quiz.is_scored) {
                    markdown += `**Points:** ${quiz.points || 1}\n\n`;
                }
                
                // Options for select/checkbox questions
                if (quiz.question_type === 'select' || quiz.question_type === 'checkbox') {
                    markdown += `**Options:**\n\n`;
                    const options = quiz.options || [];
                    options.forEach((option, idx) => {
                        const letter = String.fromCharCode(97 + idx); // a, b, c, d...
                        markdown += `${letter}. ${option}\n`;
                    });
                    markdown += `\n`;
                    
                    // Correct answer(s)
                    if (quiz.correct_answer) {
                        markdown += `**Correct Answer:**\n\n`;
                        
                        if (quiz.question_type === 'select') {
                            try {
                                const answer = JSON.parse(quiz.correct_answer);
                                if (answer.selected_index !== undefined) {
                                    const letter = String.fromCharCode(97 + answer.selected_index);
                                    markdown += `${letter}. ${answer.selected_text || options[answer.selected_index]}\n\n`;
                                }
                            } catch (e) {
                                markdown += `${quiz.correct_answer}\n\n`;
                            }
                        } else if (quiz.question_type === 'checkbox') {
                            try {
                                const answers = JSON.parse(quiz.correct_answer);
                                if (Array.isArray(answers)) {
                                    answers.forEach(ans => {
                                        const idx = options.indexOf(ans);
                                        if (idx !== -1) {
                                            const letter = String.fromCharCode(97 + idx);
                                            markdown += `${letter}. ${ans}\n`;
                                        }
                                    });
                                    markdown += `\n`;
                                }
                            } catch (e) {
                                markdown += `${quiz.correct_answer}\n\n`;
                            }
                        }
                    }
                } else if (quiz.question_type === 'text') {
                    // Text answer
                    if (quiz.correct_answer) {
                        markdown += `**Expected Answer:**\n\n${quiz.correct_answer}\n\n`;
                    }
                }
                
                markdown += `---\n\n`;
            });
            
            markdown += `## End of Quiz Export\n\n`;
            markdown += `*Generated by Tutoriaz Quiz System*\n`;
            
            return markdown;
        }

        function showImportQuizzesModal() {
            const modal = document.getElementById('importQuizzesModal');
            document.getElementById('importFileInput').value = '';
            document.getElementById('importPreview').style.display = 'none';
            document.getElementById('importBtn').disabled = true;
            modal.classList.remove('hidden');
            
            // Close on background click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    closeImportQuizzesModal();
                }
            };
        }

        function closeImportQuizzesModal() {
            document.getElementById('importQuizzesModal').classList.add('hidden');
        }

        // File input change handler
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('importFileInput').addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    
                    if (!data.quizzes || !Array.isArray(data.quizzes)) {
                        throw new Error('Invalid format: quizzes array not found');
                    }

                    // Show preview
                    const preview = document.getElementById('importPreview');
                    const content = document.getElementById('importPreviewContent');
                    content.innerHTML = `
                        <p><strong>Version:</strong> ${data.version || 'Unknown'}</p>
                        <p><strong>Exported:</strong> ${data.exported_at ? new Date(data.exported_at).toLocaleString() : 'Unknown'}</p>
                        <p><strong>Quiz Count:</strong> ${data.quizzes.length}</p>
                        <div style="margin-top: 10px;">
                            <strong>Quizzes:</strong>
                            <ul style="margin: 5px 0; padding-left: 20px;">
                                ${data.quizzes.slice(0, 5).map(q => `<li>${escapeHtml(q.title)} (${q.question_type})</li>`).join('')}
                                ${data.quizzes.length > 5 ? `<li><em>...and ${data.quizzes.length - 5} more</em></li>` : ''}
                            </ul>
                        </div>
                    `;
                    preview.style.display = 'block';
                    document.getElementById('importBtn').disabled = false;
                    
                    // Store data for import
                    window.importData = data;
                } catch (error) {
                    console.error('Parse error:', error);
                    showNotification('Invalid JSON file: ' + error.message, 'error');
                    document.getElementById('importBtn').disabled = true;
                }
            });
        });

        async function importQuizzes() {
            if (!window.importData) {
                showNotification('No data to import', 'error');
                return;
            }

            if (!selectedCourseId) {
                showNotification('Please select a course before importing', 'error');
                return;
            }

            try {
                const response = await fetch('/api/quizzes/import', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        quizzes: window.importData.quizzes,
                        targetCourseId: selectedCourseId
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    showNotification(`Imported ${data.imported} quiz(es). Failed: ${data.failed}`, 'success');
                    closeImportQuizzesModal();
                    loadQuizzes();
                    window.importData = null;
                } else {
                    showNotification(data.error || 'Import failed', 'error');
                }
            } catch (error) {
                console.error('Import error:', error);
                showNotification('Import failed', 'error');
            }
        }

        // Edit quiz
        function editQuiz(quizId) {
            const quiz = quizzes.find(q => q.id === quizId);
            if (!quiz) return;

            // Reset form first to clear any previous edits
            const form = document.getElementById('createQuizForm');
            form.reset();
            
            // Clear options and preview
            document.getElementById('quizOptions').value = '';
            document.getElementById('optionsPreview').innerHTML = '';

            // Populate form with existing data
            document.getElementById('quizTitle').value = quiz.title;
            document.getElementById('quizContent').value = quiz.content_text || '';
            document.getElementById('questionType').value = quiz.question_type;
            document.getElementById('correctAnswer').value = quiz.correct_answer || '';
            document.getElementById('quizCategory').value = quiz.category_id || '';
            document.getElementById('timeoutSeconds').value = quiz.timeout_seconds;
            
            // Populate scoring fields
            const isScored = quiz.is_scored !== undefined ? Boolean(quiz.is_scored) : true;
            document.getElementById('isScored').checked = isScored;
            document.getElementById('quizPoints').value = quiz.points !== undefined ? quiz.points : 1;
            document.getElementById('pointsGroup').style.display = isScored ? 'block' : 'none';

            // Handle options for select/checkbox question types
            if (quiz.question_type === 'select' || quiz.question_type === 'checkbox') {
                document.getElementById('optionsGroup').classList.remove('hidden');
                document.getElementById('optionsPreviewGroup').classList.remove('hidden');
                document.getElementById('textAnswerGroup').classList.add('hidden');
                document.getElementById('quizOptions').value = (quiz.options || []).join('\n');
                updateOptionsPreview(); // Update the preview with existing options
            } else {
                document.getElementById('optionsGroup').classList.add('hidden');
                document.getElementById('optionsPreviewGroup').classList.add('hidden');
                document.getElementById('textAnswerGroup').classList.remove('hidden');
            }

            // Change form to edit mode
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.textContent = 'Update Quiz';
            
            // Set edit mode flags
            isEditMode = true;
            currentEditQuizId = quizId;

            showNotification('Edit mode: Update the quiz details and click "Update Quiz"', 'info');
        }

        // Update quiz
        async function updateQuiz(quizId) {
            console.log('updateQuiz called for quizId:', quizId);
            
            if (!selectedCourseId) {
                showNotification('Select a course before updating quizzes.', 'error');
                return;
            }

            const formData = {
                title: document.getElementById('quizTitle').value,
                content_text: document.getElementById('quizContent').value,
                question_type: document.getElementById('questionType').value,
                correct_answer: document.getElementById('correctAnswer').value,
                category_id: document.getElementById('quizCategory').value || null,
                course_id: selectedCourseId
            };

            const timeoutValue = parseInt(document.getElementById('timeoutSeconds').value, 10);
            formData.timeout_seconds = Number.isFinite(timeoutValue) ? timeoutValue : 60;

            // Add scoring fields
            const isScored = document.getElementById('isScored').checked;
            formData.is_scored = isScored;
            if (isScored) {
                const pointsValue = parseInt(document.getElementById('quizPoints').value, 10);
                formData.points = Number.isFinite(pointsValue) && pointsValue >= 0 ? pointsValue : 1;
            } else {
                formData.points = 0;
            }

            console.log('Update formData:', formData);

            if (formData.question_type === 'select' || formData.question_type === 'checkbox') {
                const optionsText = document.getElementById('quizOptions').value;
                formData.options = optionsText.split('\n').filter(option => option.trim());
                
                if (formData.options.length < 2) {
                    showNotification('Please provide at least 2 options for multiple choice', 'error');
                    return;
                }
            }

            try {
                const response = await fetch(`/api/quizzes/${quizId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Reset form to create mode
                    resetFormToCreateMode();
                    showNotification('Quiz updated successfully', 'success');
                    loadQuizzes();
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Update quiz error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Reset form to create mode
        function resetFormToCreateMode() {
            const form = document.getElementById('createQuizForm');
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.textContent = 'Create Quiz';
            
            // Reset edit mode flags
            isEditMode = false;
            currentEditQuizId = null;
            
            form.reset();
            document.getElementById('optionsGroup').classList.add('hidden');
        }

        // Extract original create quiz handler
        async function createQuizHandler(e) {
            if (!selectedCourseId) {
                showNotification('Select a course before creating quizzes.', 'error');
                return;
            }

            const formData = {
                title: document.getElementById('quizTitle').value,
                content_text: document.getElementById('quizContent').value,
                question_type: document.getElementById('questionType').value,
                correct_answer: document.getElementById('correctAnswer').value,
                category_id: document.getElementById('quizCategory').value || null,
                course_id: selectedCourseId
            };

            const timeoutValue = parseInt(document.getElementById('timeoutSeconds').value, 10);
            formData.timeout_seconds = Number.isFinite(timeoutValue) ? timeoutValue : 60;

            // Add scoring fields
            const isScored = document.getElementById('isScored').checked;
            formData.is_scored = isScored;
            if (isScored) {
                const pointsValue = parseInt(document.getElementById('quizPoints').value, 10);
                formData.points = Number.isFinite(pointsValue) && pointsValue >= 0 ? pointsValue : 1;
            } else {
                formData.points = 0;
            }

            if (formData.question_type === 'select' || formData.question_type === 'checkbox') {
                const optionsText = document.getElementById('quizOptions').value;
                formData.options = optionsText.split('\n').filter(option => option.trim());
                
                if (formData.options.length < 2) {
                    const questionTypeLabel = formData.question_type === 'checkbox' ? 'checkbox' : 'multiple choice';
                    showNotification(`Please provide at least 2 options for ${questionTypeLabel}`, 'error');
                    return;
                }
            }

            try {
                const response = await fetch('/api/quizzes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();
                
                if (response.ok) {
                    document.getElementById('createQuizForm').reset();
                    document.getElementById('optionsGroup').classList.add('hidden');
                    showNotification('Quiz created successfully', 'success');
                    loadQuizzes(); // Only reload quizzes, not categories
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('Create quiz error:', error);
                showNotification('Network error', 'error');
            }
        }

        // View responses
        async function viewResponses(quizId) {
            try {
                const response = await fetch(`/api/quizzes/${quizId}/responses`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    displayResponsesOverview(data.quiz, data.responses);
                } else {
                    showNotification(data.error, 'error');
                }
            } catch (error) {
                console.error('View responses error:', error);
                showNotification('Network error', 'error');
            }
        }

        // Format answer display for better readability
        function formatAnswerDisplay(answerText, questionType) {
            if (!answerText) {
                return '<em>No answer</em>';
            }

            // If it's a text question, return as is
            if (questionType === 'text') {
                return answerText;
            }

            // For select questions, try to parse JSON format
            if (questionType === 'select') {
                try {
                    const parsed = JSON.parse(answerText);
                    if (parsed.selected_index !== undefined && parsed.selected_text) {
                        // Convert to (a), (b), (c) format
                        const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
                        const letter = letters[parsed.selected_index] || parsed.selected_index;
                        return `(${letter}) ${parsed.selected_text}`;
                    }
                } catch (e) {
                    // If parsing fails, return original text
                    return answerText;
                }
            }

            return answerText;
        }

        // Display responses overview
        function displayResponsesOverview(quiz, responses) {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.5); z-index: 1000; 
                display: flex; align-items: center; justify-content: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white; padding: 20px; border-radius: 8px; 
                max-width: 95%; max-height: 90%; overflow-y: auto; width: 1000px;
            `;

            const correctCount = responses.filter(r => r.is_correct === true).length;
            const incorrectCount = responses.filter(r => r.is_correct === false).length;
            const gradingAvailable = quiz.correct_answer ? true : false;

            content.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0;">Quiz Responses: ${quiz.title}</h3>
                    <button data-action="close-responses" 
                            style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                        Close
                    </button>
                </div>
                
                <div style="margin-bottom: 15px; padding: 15px; background: #f8f9fa; border-radius: 4px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                        <div><strong>Question Type:</strong> ${quiz.question_type}</div>
                        ${quiz.correct_answer ? `<div><strong>Correct Answer:</strong> <span style="color: #28a745;">${quiz.correct_answer}</span></div>` : ''}
                        <div><strong>Total Responses:</strong> ${responses.length}</div>
                        ${gradingAvailable ? `
                            <div><strong>Correct:</strong> <span style="color: #28a745;">${correctCount}</span></div>
                            <div><strong>Incorrect:</strong> <span style="color: #dc3545;">${incorrectCount}</span></div>
                            <div><strong>Success Rate:</strong> ${responses.length > 0 ? Math.round((correctCount / responses.length) * 100) : 0}%</div>
                        ` : ''}
                    </div>
                </div>

                ${responses.length === 0 ? 
                    '<div style="text-align: center; padding: 40px; color: #666;"><p>No responses yet</p></div>' : 
                    `<div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <thead>
                                <tr style="background: #007bff; color: white;">
                                    <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Student</th>
                                    <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Answer</th>
                                    ${gradingAvailable ? '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Correct</th>' : ''}
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Time Taken</th>
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Answered At</th>
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${responses.map((response, index) => `
                                    <tr style="background: ${index % 2 === 0 ? '#f8f9fa' : 'white'};">
                                        <td style="padding: 10px; border: 1px solid #ddd;">
                                            <div style="font-weight: bold;">${response.display_name}</div>
                                            <div style="font-size: 12px; color: #666;">${response.username}</div>
                                        </td>
                                        <td style="padding: 10px; border: 1px solid #ddd; max-width: 200px; word-wrap: break-word;">
                                            ${formatAnswerDisplay(response.answer_text, quiz.question_type)}
                                        </td>
                                        ${gradingAvailable ? `
                                            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                                                <span style="color: ${response.is_correct ? '#28a745' : '#dc3545'}; font-weight: bold; font-size: 16px;">
                                                    ${response.is_correct ? '✓' : '✗'}
                                                </span>
                                            </td>
                                        ` : ''}
                                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                                            ${response.elapsed_ms ? Math.round(response.elapsed_ms / 1000) + 's' : 'N/A'}
                                        </td>
                                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-size: 12px;">
                                            ${response.answered_at ? new Date(response.answered_at).toLocaleString() : 'N/A'}
                                        </td>
                                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                                            <span style="
                                                padding: 4px 8px; 
                                                border-radius: 12px; 
                                                font-size: 11px; 
                                                font-weight: bold;
                                                background: ${response.status === 'answered' ? '#d4edda' : response.status === 'timeout' ? '#f8d7da' : '#e2e3e5'};
                                                color: ${response.status === 'answered' ? '#155724' : response.status === 'timeout' ? '#721c24' : '#383d41'};
                                            ">
                                                ${response.status.toUpperCase()}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>`
                }
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Setup event listeners for modal buttons
            content.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-action]');
                if (button?.getAttribute('data-action') === 'close-responses') {
                    modal.remove();
                }
            });

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        // Show student scores and rankings
        async function showStudentScores() {
            if (!selectedCourseId) {
                showNotification('Please select a course first', 'error');
                return;
            }

            try {
                const response = await fetch(`/api/courses/${selectedCourseId}/scores`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to load scores');
                }

                const data = await response.json();
                displayScoresModal(data);
            } catch (error) {
                console.error('Error loading scores:', error);
                showNotification('Failed to load student scores', 'error');
            }
        }

        // Display scores in a modal
        function displayScoresModal(data) {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.5); z-index: 1000; 
                display: flex; align-items: center; justify-content: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white; padding: 30px; border-radius: 8px; 
                max-width: 900px; max-height: 90%; overflow-y: auto; width: 90%;
            `;

            const scoresHtml = data.scores.length > 0 ? `
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <thead>
                        <tr style="background: #007bff; color: white;">
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Rank</th>
                            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Student</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Score</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Correct</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Wrong</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Timeout</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.scores.map((student, index) => `
                            <tr style="background: ${index % 2 === 0 ? '#f8f9fa' : 'white'};">
                                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
                                    <span style="font-weight: bold; font-size: 18px; color: ${student.rank === 1 ? '#ffd700' : student.rank === 2 ? '#c0c0c0' : student.rank === 3 ? '#cd7f32' : '#666'};">
                                        ${student.rank === 1 ? '🥇' : student.rank === 2 ? '🥈' : student.rank === 3 ? '🥉' : student.rank}
                                    </span>
                                </td>
                                <td style="padding: 10px; border: 1px solid #ddd;">
                                    <div style="font-weight: bold;">${student.display_name}</div>
                                    <div style="font-size: 12px; color: #666;">${student.username}</div>
                                </td>
                                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
                                    <span style="font-size: 20px; font-weight: bold; color: #28a745;">${student.total_score}</span>
                                </td>
                                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
                                    <span style="color: #28a745; font-weight: bold;">${student.correct_count || 0} ✓</span>
                                </td>
                                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
                                    <span style="color: #dc3545; font-weight: bold;">${student.incorrect_count || 0} ✗</span>
                                </td>
                                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">
                                    <span style="color: #ffc107;">${student.timeout_count || 0} ⏱</span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<p style="text-align: center; color: #666; padding: 40px;">No student scores available yet</p>';

            content.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin: 0;">📊 Student Scores & Rankings</h2>
                    <button data-action="close-modal" 
                            style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                        Close
                    </button>
                </div>
                
                <div style="padding: 15px; background: #f8f9fa; border-radius: 4px; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0;">Course: ${data.course.title}</h3>
                    <p style="margin: 0; color: #666;">${data.course.description || ''}</p>
                </div>

                ${scoresHtml}
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Setup event listeners for modal buttons
            content.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-action]');
                if (button?.getAttribute('data-action') === 'close-modal') {
                    modal.remove();
                }
            });

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        // Update queue status display
        function updateQueueStatus(data) {
            // Request current queue status from server
            fetch('/api/queue-status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            .then(response => response.json())
            .then(status => {
                const queueDiv = document.getElementById('queueItems');
                
                if (status.active_pushes && status.active_pushes.length > 0) {
                    queueDiv.innerHTML = status.active_pushes.map((push, index) => `
                        <div class="queue-item active">
                            ${index + 1}. ${push.title}
                            <small style="display: block; color: #666; font-size: 11px;">
                                Started: ${new Date(push.started_at).toLocaleTimeString()}
                            </small>
                        </div>
                    `).join('');
                } else {
                    queueDiv.innerHTML = '<div style="color: #999; font-style: italic;">No quizzes in queue</div>';
                }
            })
            .catch(err => {
                console.error('Error fetching queue status:', err);
                document.getElementById('queueItems').innerHTML = '<div style="color: #dc3545;">Error loading queue status</div>';
            });
        }

        // Open multi-quiz monitor window (shows all active quizzes)
        function openMultiQuizMonitor() {
            if (!selectedCourseId) {
                showNotification('Please select a course first', 'error');
                return;
            }

            const width = 1400;
            const height = 900;
            const left = (screen.width - width) / 2;
            const top = (screen.height - height) / 2;
            
            const monitorUrl = `/quiz-multi-monitor.html?token=${encodeURIComponent(token)}&courseId=${encodeURIComponent(selectedCourseId)}`;
            
            // Open a new monitor window
            const multiMonitorWindow = window.open(
                monitorUrl,
                'MultiQuizMonitor', // Use consistent name to reuse window
                `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
            );

            if (multiMonitorWindow) {
                multiMonitorWindow.focus();
            } else {
                showNotification('Please allow popups to view the multi-quiz monitor', 'error');
            }
        }

        // Open course progress dashboard
        function openCourseProgress() {
            if (!selectedCourseId) {
                showNotification('Please select a course first', 'error');
                return;
            }

            // Open progress dashboard in new tab/window
            const progressUrl = `/course-progress.html?courseId=${encodeURIComponent(selectedCourseId)}`;
            window.open(progressUrl, '_blank');
        }

        // ===========================
        // IMAGE UPLOAD FUNCTIONS
        // ===========================

        function setupImageUpload() {
            const fileInput = document.getElementById('assignmentImageFile');
            if (fileInput) {
                fileInput.addEventListener('change', handleImageSelect);
            }
        }

        async function handleImageSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
                showNotification('Please select an image file', 'error');
                return;
            }

            // Validate file size (10MB limit)
            if (file.size > 10 * 1024 * 1024) {
                showNotification('Image file must be smaller than 10MB', 'error');
                return;
            }

            try {
                // Show upload progress
                document.getElementById('uploadProgress').style.display = 'block';
                document.getElementById('uploadStatus').textContent = 'Uploading...';
                document.getElementById('progressBar').style.width = '10%';

                // Create FormData for upload
                const formData = new FormData();
                formData.append('image', file);
                formData.append('type', 'assignment');
                
                // If editing existing assignment, include assignmentId
                const assignmentId = document.getElementById('assignmentId').value;
                if (assignmentId) {
                    formData.append('assignmentId', assignmentId);
                }

                // Upload image
                const response = await fetch('/api/upload/assignment-image', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: formData
                });

                document.getElementById('progressBar').style.width = '90%';

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Upload failed');
                }

                const result = await response.json();
                document.getElementById('progressBar').style.width = '100%';
                
                // Set the image URL in hidden input
                document.getElementById('assignmentImage').value = result.imageUrl;
                
                // Show preview
                document.getElementById('previewImage').src = result.imageUrl;
                document.getElementById('imagePreview').style.display = 'block';
                
                // Hide upload progress
                setTimeout(() => {
                    document.getElementById('uploadProgress').style.display = 'none';
                }, 500);

                // Show compression info
                if (result.compressionRatio > 0) {
                    showNotification(`Image uploaded and compressed by ${result.compressionRatio}%`, 'success');
                } else {
                    showNotification('Image uploaded successfully', 'success');
                }

            } catch (error) {
                console.error('Image upload error:', error);
                showNotification(error.message, 'error');
                document.getElementById('uploadProgress').style.display = 'none';
            }
        }

        function removeImage() {
            // Clear the file input
            document.getElementById('assignmentImageFile').value = '';
            // Clear the hidden URL input
            document.getElementById('assignmentImage').value = '';
            // Hide preview
            document.getElementById('imagePreview').style.display = 'none';
            // Reset progress
            document.getElementById('uploadProgress').style.display = 'none';
        }

        // Make removeImage available globally
        window.removeImage = removeImage;

        // ===========================
        // ASSIGNMENT MANAGEMENT
        // ===========================

        // Load assignments for current course
        async function loadAssignments() {
            if (!currentCourse) return;

            try {
                const response = await fetch(`/api/courses/${currentCourse.id}/assignments`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log('Assignments response:', data);
                    displayAssignments(data.assignments || []);
                } else {
                    console.error('Failed to load assignments');
                    showNotification('Failed to load assignments', 'error');
                }
            } catch (error) {
                console.error('Error loading assignments:', error);
                showNotification('Error loading assignments', 'error');
            }
        }

        // Display assignments in the list
        function displayAssignments(assignments) {
            const assignmentsList = document.getElementById('assignmentsList');
            
            if (!assignments || assignments.length === 0) {
                assignmentsList.innerHTML = '<p>No assignments created yet</p>';
                return;
            }

            assignmentsList.innerHTML = assignments.map(assignment => {
                const statusBadge = assignment.status === 'open' 
                    ? '<span class="badge badge-open">Open</span>'
                    : '<span class="badge badge-closed">Closed</span>';
                
                let deadlineText = '';
                if (assignment.deadline_type === 'specific' && assignment.deadline_datetime) {
                    const deadlineDate = new Date(assignment.deadline_datetime);
                    deadlineText = `Deadline: ${deadlineDate.toLocaleString()}`;
                } else if (assignment.deadline_type === 'duration') {
                    const hours = assignment.deadline_duration_hours || 0;
                    const minutes = assignment.deadline_duration_minutes || 0;
                    deadlineText = `Deadline: ${hours}h ${minutes}m after opening`;
                }

                const submissionCount = assignment.total_submissions || 0;
                const createdDate = new Date(assignment.created_at).toLocaleDateString();

                return `
                    <div class="assignment-card" data-assignment-id="${assignment.id}">
                        <div class="assignment-header">
                            <h4 class="assignment-title">${assignment.title}</h4>
                            <div class="assignment-badges">
                                ${statusBadge}
                            </div>
                        </div>
                        <div class="assignment-meta">
                            <div>${deadlineText}</div>
                            <div>Created: ${createdDate} | Submissions: ${submissionCount}</div>
                        </div>
                        <div class="assignment-actions">
                            ${assignment.status === 'closed' 
                                ? `<button class="btn btn-success" data-action="open">📂 Open</button>`
                                : `<button class="btn btn-warning" data-action="close">🔒 Close</button>`
                            }
                            <button class="btn btn-primary" data-action="view-submissions">📋 View Submissions (${submissionCount})</button>
                            <button class="btn btn-secondary" data-action="edit">✏️ Edit</button>
                            <button class="btn btn-danger" data-action="delete">🗑️ Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Add event delegation for assignment actions
            setupAssignmentEventListeners();
        }

        // Setup event listeners for assignment actions using event delegation
        function setupAssignmentEventListeners() {
            const assignmentsList = document.getElementById('assignmentsList');
            if (!assignmentsList) return;

            // Remove old listener if exists
            assignmentsList.removeEventListener('click', handleAssignmentClick);
            // Add new listener
            assignmentsList.addEventListener('click', handleAssignmentClick);
        }

        function handleAssignmentClick(event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const action = button.getAttribute('data-action');
            const card = button.closest('.assignment-card');
            const assignmentId = card?.getAttribute('data-assignment-id');
            
            if (!assignmentId) return;

            switch (action) {
                case 'open':
                    openAssignment(assignmentId);
                    break;
                case 'close':
                    closeAssignment(assignmentId);
                    break;
                case 'view-submissions':
                    viewSubmissions(assignmentId);
                    break;
                case 'edit':
                    editAssignment(assignmentId);
                    break;
                case 'delete':
                    deleteAssignment(assignmentId);
                    break;
            }
        }

        // Show create assignment modal
        function showCreateAssignmentModal() {
            document.getElementById('assignmentModalTitle').textContent = 'Create Assignment';
            document.getElementById('assignmentForm').reset();
            document.getElementById('assignmentId').value = '';
            document.getElementById('deadlineType').value = 'specific';
            removeImage(); // Clear any previous image
            toggleDeadlineFields();
            setupImageUpload(); // Setup file upload handlers
            document.getElementById('assignmentModal').classList.remove('hidden');
        }

        // Close assignment modal
        function closeAssignmentModal() {
            document.getElementById('assignmentModal').classList.add('hidden');
        }

        // Toggle deadline fields based on type
        function toggleDeadlineFields() {
            const deadlineType = document.getElementById('deadlineType').value;
            const specificGroup = document.getElementById('specificDeadlineGroup');
            const durationGroup = document.getElementById('durationDeadlineGroup');

            if (deadlineType === 'specific') {
                specificGroup.style.display = 'block';
                durationGroup.style.display = 'none';
            } else {
                specificGroup.style.display = 'none';
                durationGroup.style.display = 'block';
            }
        }

        // Save assignment (create or update)
        async function saveAssignment(event) {
            event.preventDefault();

            const assignmentId = document.getElementById('assignmentId').value;
            const deadlineType = document.getElementById('deadlineType').value;

            const assignmentData = {
                title: document.getElementById('assignmentTitle').value,
                description: document.getElementById('assignmentDescription').value,
                deadline_type: deadlineType,
                image_path: document.getElementById('assignmentImage').value || null,
                auto_close: document.getElementById('autoClose').checked
            };

            if (deadlineType === 'specific') {
                assignmentData.deadline_datetime = document.getElementById('deadlineDatetime').value || null;
            } else {
                assignmentData.deadline_duration_hours = parseInt(document.getElementById('deadlineHours').value) || 0;
                assignmentData.deadline_duration_minutes = parseInt(document.getElementById('deadlineMinutes').value) || 0;
            }

            try {
                let response;
                if (assignmentId) {
                    // Update existing assignment
                    response = await fetch(`/api/assignments/${assignmentId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify(assignmentData)
                    });
                } else {
                    // Create new assignment
                    response = await fetch('/api/assignments', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify({
                            ...assignmentData,
                            course_id: currentCourse.id
                        })
                    });
                }

                if (response.ok) {
                    showNotification(assignmentId ? 'Assignment updated successfully' : 'Assignment created successfully', 'success');
                    closeAssignmentModal();
                    loadAssignments();
                } else {
                    const error = await response.json();
                    showNotification(error.error || 'Failed to save assignment', 'error');
                }
            } catch (error) {
                console.error('Error saving assignment:', error);
                showNotification('Error saving assignment', 'error');
            }
        }

        // Open assignment
        async function openAssignment(assignmentId) {
            if (!confirm('Open this assignment for students?')) return;

            try {
                const response = await fetch(`/api/assignments/${assignmentId}/status`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({ status: 'open' })
                });

                if (response.ok) {
                    showNotification('Assignment opened', 'success');
                    loadAssignments();
                } else {
                    const error = await response.json();
                    showNotification(error.error || 'Failed to open assignment', 'error');
                }
            } catch (error) {
                console.error('Error opening assignment:', error);
                showNotification('Error opening assignment', 'error');
            }
        }

        // Close assignment
        async function closeAssignment(assignmentId) {
            if (!confirm('Close this assignment? Students will no longer be able to submit.')) return;

            try {
                const response = await fetch(`/api/assignments/${assignmentId}/status`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({ status: 'closed' })
                });

                if (response.ok) {
                    showNotification('Assignment closed', 'success');
                    loadAssignments();
                } else {
                    const error = await response.json();
                    showNotification(error.error || 'Failed to close assignment', 'error');
                }
            } catch (error) {
                console.error('Error closing assignment:', error);
                showNotification('Error closing assignment', 'error');
            }
        }

        // Edit assignment
        async function editAssignment(assignmentId) {
            try {
                const response = await fetch(`/api/courses/${currentCourse.id}/assignments`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const assignment = data.assignments.find(a => a.id === assignmentId);
                    
                    if (assignment) {
                        document.getElementById('assignmentModalTitle').textContent = 'Edit Assignment';
                        document.getElementById('assignmentId').value = assignment.id;
                        document.getElementById('assignmentTitle').value = assignment.title;
                        document.getElementById('assignmentDescription').value = assignment.description || '';
                        document.getElementById('deadlineType').value = assignment.deadline_type;
                        document.getElementById('assignmentImage').value = assignment.image_path || '';
                        document.getElementById('autoClose').checked = assignment.auto_close === 1;

                        // Handle existing image
                        if (assignment.image_path) {
                            document.getElementById('previewImage').src = assignment.image_path;
                            document.getElementById('imagePreview').style.display = 'block';
                        } else {
                            removeImage();
                        }

                        if (assignment.deadline_type === 'specific') {
                            document.getElementById('deadlineDatetime').value = assignment.deadline_datetime || '';
                        } else {
                            document.getElementById('deadlineHours').value = assignment.deadline_duration_hours || 0;
                            document.getElementById('deadlineMinutes').value = assignment.deadline_duration_minutes || 0;
                        }

                        toggleDeadlineFields();
                        setupImageUpload();
                        document.getElementById('assignmentModal').classList.remove('hidden');
                    }
                }
            } catch (error) {
                console.error('Error loading assignment:', error);
                showNotification('Error loading assignment', 'error');
            }
        }

        // Delete assignment
        async function deleteAssignment(assignmentId) {
            if (!confirm('Delete this assignment? This will also delete all submissions.')) return;

            try {
                const response = await fetch(`/api/assignments/${assignmentId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (response.ok) {
                    showNotification('Assignment deleted', 'success');
                    loadAssignments();
                } else {
                    const error = await response.json();
                    showNotification(error.error || 'Failed to delete assignment', 'error');
                }
            } catch (error) {
                console.error('Error deleting assignment:', error);
                showNotification('Error deleting assignment', 'error');
            }
        }

        // View submissions for an assignment
        async function viewSubmissions(assignmentId) {
            try {
                const response = await fetch(`/api/assignments/${assignmentId}/submissions`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    
                    // Get assignment title from the loaded assignments
                    const assignment = document.querySelector(`[onclick*="${assignmentId}"]`)?.closest('.assignment-card')?.querySelector('.assignment-title')?.textContent || 'Assignment';
                    
                    displaySubmissions(data.submissions, assignment);
                    document.getElementById('submissionsModal').classList.remove('hidden');
                } else {
                    showNotification('Failed to load submissions', 'error');
                }
            } catch (error) {
                console.error('Error loading submissions:', error);
                showNotification('Error loading submissions', 'error');
            }
        }

        // Display submissions in modal
        function displaySubmissions(submissions, assignmentTitle) {
            document.getElementById('submissionsModalTitle').textContent = `Submissions: ${assignmentTitle}`;
            const submissionsList = document.getElementById('submissionsList');

            if (!submissions || submissions.length === 0) {
                submissionsList.innerHTML = '<p>No submissions yet</p>';
                return;
            }

            submissionsList.innerHTML = submissions.map(submission => {
                const submittedDate = new Date(submission.submitted_at).toLocaleString();
                const lateBadge = submission.is_late ? '<span class="badge" style="background: #fef3c7; color: #f59e0b;">Late</span>' : '';
                
                // Render markdown content with syntax highlighting
                const renderedContent = marked.parse(submission.content || 'No content provided');

                return `
                    <div class="submission-card">
                        <div class="submission-header">
                            <div>
                                <div class="submission-student">${submission.display_name || submission.username} (${submission.username})</div>
                                <div style="color: #6b7280; font-size: 14px;">Submitted: ${submittedDate} ${lateBadge}</div>
                            </div>
                        </div>
                        <div class="submission-content markdown-content">
                            ${renderedContent}
                        </div>
                        ${submission.image_path ? `<img src="${submission.image_path}" class="submission-image" alt="Submission attachment">` : ''}
                    </div>
                `;
            }).join('');
        }

        // Close submissions modal
        function closeSubmissionsModal() {
            document.getElementById('submissionsModal').classList.add('hidden');
        }

        // Make assignment functions globally available
        window.showCreateAssignmentModal = showCreateAssignmentModal;
        window.closeAssignmentModal = closeAssignmentModal;
        window.toggleDeadlineFields = toggleDeadlineFields;
        window.saveAssignment = saveAssignment;
        window.openAssignment = openAssignment;
        window.closeAssignment = closeAssignment;
        window.editAssignment = editAssignment;
        window.deleteAssignment = deleteAssignment;
        window.viewSubmissions = viewSubmissions;
        window.closeSubmissionsModal = closeSubmissionsModal;

        // Logout
        function logout() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (socket) {
                socket.disconnect();
            }
            window.location.href = '/';
        }

        // Initialize configuration on page load
        fetchAppConfig();
