        // Configure marked.js to use Highlight.js for syntax highlighting
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (err) {
                        console.error('Highlight.js error:', err);
                    }
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });
        
        const tabId = (() => {
            const storageKey = 'studentTabId';
            try {
                const existing = sessionStorage.getItem(storageKey);
                if (existing && existing.trim()) {
                    return existing;
                }
            } catch (error) {
                console.warn('Unable to read sessionStorage tab id:', error);
            }

            const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
                ? window.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            try {
                sessionStorage.setItem(storageKey, generated);
            } catch (error) {
                console.warn('Unable to persist tab id:', error);
            }

            return generated;
        })();

        let socket;
        let user;
        let token;
        let currentQuiz = null;
        let quizTimer = null;
        let remainingTime = 0;
        let queueSnapshot = { currentQuiz: null, pending: [], total: 0 };
        let hasRunAutoCleanup = false;
        let quizCloseTimer = null;
        let socketAuthenticated = false;
        let lastSentActiveCourseId = null;
        let activeQueueCourseId = null;

        let studentCourses = [];
        let selectedCourseId = null;
        let autoOpenCourseAttempted = false;
        let activeAttendanceSession = null;
        let courseTransitionLock = false;
        let isControlTab = true;
        let passiveModalVisible = false;
        let passiveModalSession = null;
        let latestAttendanceSession = null;
        let baseUrl = window.location.origin; // Default fallback

        // Fetch app configuration
        async function fetchAppConfig() {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    baseUrl = config.baseUrl;
                    console.log('Base URL configured:', baseUrl);
                    
                    // Update build info (version + build date)
                    const buildInfoEl = document.getElementById('buildInfo');
                    if (buildInfoEl) {
                        const version = config.version || '';
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
                        if (version && formatted) {
                            buildInfoEl.textContent = `${version} • ${formatted}`;
                        } else if (version) {
                            buildInfoEl.textContent = version;
                        } else if (formatted) {
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

        function normalizeCourseId(value) {
            if (value === null || value === undefined || value === '') {
                return null;
            }
            return String(value);
        }

        function matchesActiveCourse(courseId, { allowMissing = false } = {}) {
            if (courseId === undefined) {
                return allowMissing;
            }
            const normalizedIncoming = normalizeCourseId(courseId);
            const normalizedSelected = normalizeCourseId(selectedCourseId);
            if (normalizedIncoming === null && normalizedSelected === null) {
                return true;
            }
            return normalizedIncoming === normalizedSelected;
        }

        function resetQueueForCourse(targetCourseId = null) {
            queueSnapshot = { currentQuiz: null, pending: [], total: 0 };
            activeQueueCourseId = normalizeCourseId(targetCourseId);
            currentQuiz = null;
            hasRunAutoCleanup = false;
            clearQuizCloseTimer();
            if (quizTimer) {
                clearInterval(quizTimer);
                quizTimer = null;
            }
            const overlay = document.getElementById('quizOverlay');
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.style.display = 'none';
            }
            updateDebugQueue();
        }

        function syncActiveCourseWithServer(force = false) {
            const normalized = normalizeCourseId(selectedCourseId);
            if (!socket || !socket.connected || !socketAuthenticated) {
                return;
            }
            if (!force && !isControlTab) {
                return;
            }
            if (!force && lastSentActiveCourseId === normalized && isControlTab) {
                return;
            }
            const payload = {};
            if (normalized !== null) {
                payload.course_id = normalized;
            }
            payload.tab_id = tabId;
            socket.emit('student_active_course', payload);
            lastSentActiveCourseId = normalized;
        }

        function getLocalCourse(courseId) {
            if (!courseId) {
                return null;
            }
            return studentCourses.find(course => normalizeCourseId(course.id) === normalizeCourseId(courseId)) || null;
        }

        function enterPassiveLobbyView() {
            const lobbySection = document.getElementById('lobbySection');
            const courseExperience = document.getElementById('courseExperience');
            if (courseExperience) {
                courseExperience.classList.add('hidden');
            }
            if (lobbySection) {
                lobbySection.classList.remove('hidden');
            }

            resetQueueForCourse(null);
            selectedCourseId = null;
            activeQueueCourseId = null;
            autoOpenCourseAttempted = true;
            lastSentActiveCourseId = null;
            localStorage.removeItem('selectedCourseId');

            renderCourseLobby();
            if (token) {
                refreshDebugHistory();
            }
        }

        function hideInactiveTabModal() {
            passiveModalVisible = false;
            passiveModalSession = null;
            const overlay = document.getElementById('inactiveTabModal');
            if (overlay) {
                overlay.classList.add('hidden');
            }
        }

        function showInactiveTabModal(session = null) {
            passiveModalVisible = true;
            passiveModalSession = session;
            isControlTab = false;
            if (session) {
                latestAttendanceSession = session;
            }

            const overlay = document.getElementById('inactiveTabModal');
            if (overlay) {
                overlay.classList.remove('hidden');
            }

            const courseNameEl = document.getElementById('inactiveModalCourse');
            if (courseNameEl) {
                const sessionCourseId = session ? normalizeCourseId(session.course_id) : null;
                const localCourse = getLocalCourse(sessionCourseId);
                const fallback = sessionCourseId ? `course ${sessionCourseId}` : 'this course';
                courseNameEl.textContent = localCourse ? localCourse.title : fallback;
            }

            enterPassiveLobbyView();
        }

        async function handleInactiveModalTakeover() {
            const session = passiveModalSession || latestAttendanceSession;
            if (!session || !session.course_id) {
                hideInactiveTabModal();
                showNotification('No active course to take over.', 'info');
                return;
            }

            hideInactiveTabModal();
            isControlTab = true;
            passiveModalSession = null;

            try {
                await enterCourse(session.course_id, {
                    forceTakeover: true,
                    silent: false
                });
            } catch (error) {
                console.error('Takeover failed:', error);
                showNotification('Could not take over the course from this tab.', 'error');
                if (latestAttendanceSession) {
                    showInactiveTabModal(latestAttendanceSession);
                }
            }
        }

        function handleInactiveModalLobby() {
            hideInactiveTabModal();
            isControlTab = false;
            enterPassiveLobbyView();
        }

        function handleInactiveModalClose() {
            hideInactiveTabModal();
            isControlTab = false;
            window.close();
            setTimeout(() => {
                if (!document.hidden) {
                    logout();
                }
            }, 200);
        }

        function emitVisibilityState(state = !document.hidden) {
            if (!socket || !socket.connected) {
                return;
            }

            socket.emit('student_visibility_change', {
                visible: Boolean(state),
                tab_id: tabId,
                reported_at: new Date().toISOString()
            });
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

        async function loadStudentCourses() {
            try {
                const response = await fetch('/api/courses', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to load courses');
                }

                const data = await response.json();
                studentCourses = Array.isArray(data.courses) ? data.courses : [];
            } catch (error) {
                console.error('Load courses error:', error);
                showNotification('Could not load courses. Please try again.', 'error');
            } finally {
                renderCourseLobby();
            }
        }

        function renderCourseLobby() {
            const enrolledContainer = document.getElementById('enrolledCoursesList');
            const availableContainer = document.getElementById('availableCoursesList');

            if (!enrolledContainer || !availableContainer) {
                return;
            }

            const enrolled = studentCourses.filter(course => course.is_enrolled);
            const available = studentCourses.filter(course => !course.is_enrolled);

            if (enrolled.length === 0) {
                enrolledContainer.innerHTML = '<div class="empty-state">You are not enrolled in any courses yet.</div>';
            } else {
                enrolledContainer.innerHTML = enrolled.map(course => {
                    const teacherName = escapeHtml(course.teacher_display_name || course.teacher_username || 'Teacher');
                    const description = course.description ? escapeHtml(course.description) : 'No description provided yet.';
                    return `
                        <div class="course-card enrolled">
                            <h4>${escapeHtml(course.title)}</h4>
                            <p>${description}</p>
                            <span class="course-meta">Teacher: ${teacherName}</span>
                            <button data-course-action="enter" data-course-id="${escapeHtml(course.id)}">Enter Course</button>
                        </div>
                    `;
                }).join('');
            }

            if (available.length === 0) {
                availableContainer.innerHTML = '<div class="empty-state">No open courses to join. Ask your teacher for a passkey.</div>';
            } else {
                availableContainer.innerHTML = available.map(course => {
                    const teacherName = escapeHtml(course.teacher_display_name || course.teacher_username || 'Teacher');
                    const description = course.description ? escapeHtml(course.description) : 'No description provided yet.';
                    const requiresCode = course.requires_access_code !== false;
                    const buttonMarkup = requiresCode
                        ? `<button data-course-action="enroll" data-course-id="${escapeHtml(course.id)}">Enter Passkey &amp; Enroll</button>`
                        : `<button class="secondary" disabled>Enrollment closed</button>`;
                    return `
                        <div class="course-card ${requiresCode ? 'requires-passkey' : ''}">
                            <h4>${escapeHtml(course.title)}</h4>
                            <p>${description}</p>
                            <span class="course-meta">Teacher: ${teacherName}</span>
                            ${buttonMarkup}
                        </div>
                    `;
                }).join('');
            }

            enrolledContainer.querySelectorAll('[data-course-action="enter"]').forEach(button => {
                button.addEventListener('click', () => {
                    enterCourse(button.getAttribute('data-course-id'));
                });
            });

            availableContainer.querySelectorAll('[data-course-action="enroll"]').forEach(button => {
                button.addEventListener('click', () => {
                    promptCourseEnrollment(button.getAttribute('data-course-id'));
                });
            });

            if (!autoOpenCourseAttempted && selectedCourseId && studentCourses.length) {
                const enrolledCourse = enrolled.find(course => course.id === selectedCourseId);
                if (enrolledCourse) {
                    autoOpenCourseAttempted = true;
                    enterCourse(selectedCourseId, { skipStore: true, silent: true });
                } else {
                    selectedCourseId = null;
                    localStorage.removeItem('selectedCourseId');
                    resetQueueForCourse(null);
                    syncActiveCourseWithServer(true);
                }
            }
        }

        async function leaveCourse(courseId, { silent = false, course = null, allowPassive = false } = {}) {
            if (!token || !courseId) {
                return { success: false };
            }

            if (!isControlTab && !allowPassive) {
                if (!silent) {
                    showNotification('This tab is not controlling attendance for that course.', 'error');
                }
                return { success: false, inactive: true };
            }

            try {
                const response = await fetch(`/api/courses/${courseId}/unattend`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ tab_id: tabId })
                });

                let data = {};
                try {
                    data = await response.json();
                } catch (parseError) {
                    data = {};
                }

                if (response.ok) {
                    activeAttendanceSession = null;
                    latestAttendanceSession = null;
                    isControlTab = true;
                    if (!silent) {
                        const label = course?.title ? course.title : 'course';
                        showNotification(`Left ${label}`, 'info');
                    }
                    return { success: true, session: data.session || null };
                }

                if (response.status === 400) {
                    activeAttendanceSession = null;
                    return { success: true, session: null };
                }

                if (!silent) {
                    showNotification(data.message || 'Unable to leave the course.', 'error');
                }
                return { success: false, error: data };
            } catch (error) {
                console.error('Leave course error:', error);
                if (!silent) {
                    showNotification('Failed to leave the course. Please try again.', 'error');
                }
                return { success: false, error };
            }
        }

        async function attendCourse(courseId, { course = null, silent = false } = {}) {
            if (!token || !courseId) {
                return { success: false };
            }

            try {
                const response = await fetch(`/api/courses/${courseId}/attend`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ status: 'viewing', tab_id: tabId })
                });

                let data = {};
                try {
                    data = await response.json();
                } catch (parseError) {
                    data = {};
                }

                if (response.ok) {
                    activeAttendanceSession = data.session || null;
                    latestAttendanceSession = data.session || null;
                    const sessionActiveTab = activeAttendanceSession && activeAttendanceSession.active_tab_id
                        ? String(activeAttendanceSession.active_tab_id)
                        : null;
                    if (sessionActiveTab && sessionActiveTab !== tabId) {
                        isControlTab = false;
                    } else {
                        isControlTab = true;
                    }
                    if (!silent && course?.title) {
                        showNotification(`Joined ${course.title}`, 'success');
                    }
                    return { success: true, session: data.session || null };
                }

                if (response.status === 409 && data.error === 'active_session_exists' && data.active_course) {
                    latestAttendanceSession = {
                        course_id: data.active_course.course_id,
                        status: data.active_course.status || 'viewing',
                        active_tab_id: data.active_course.active_tab_id || null
                    };
                    if (!silent) {
                        const existingCourse = studentCourses.find(item => item.id === data.active_course.course_id);
                        const existingTitle = existingCourse?.title || 'another course';
                        const confirmSwitch = window.confirm(`You are currently attending ${existingTitle}. Leave it and switch to this course?`);
                        if (confirmSwitch) {
                            const leaveResult = await leaveCourse(data.active_course.course_id, { silent: true, course: existingCourse });
                            if (leaveResult.success) {
                                return attendCourse(courseId, { course, silent });
                            }
                        }
                    }

                    if (!silent) {
                        showNotification(data.message || 'Please leave your current course before switching.', 'error');
                    }
                } else if (!silent) {
                    showNotification(data.message || 'Could not join the course.', 'error');
                }

                return { success: false, error: data };
            } catch (error) {
                console.error('Attend course error:', error);
                if (!silent) {
                    showNotification('Failed to join the course. Please try again.', 'error');
                }
                return { success: false, error };
            }
        }

        async function enterCourse(courseId, options = {}) {
            const forceTakeover = options.forceTakeover === true;
            if (courseTransitionLock) {
                return;
            }

            if (!isControlTab && !forceTakeover) {
                showInactiveTabModal(latestAttendanceSession);
                showNotification('This tab is inactive. Use the takeover option to control attendance.', 'error');
                return;
            }

            if (forceTakeover) {
                isControlTab = true;
            }

            courseTransitionLock = true;
            try {
                const course = studentCourses.find(item => item.id === courseId);
                if (!course || !course.is_enrolled) {
                    showNotification('Enroll in the course before accessing it.', 'error');
                    return;
                }

                const attendanceResult = await attendCourse(courseId, { course, silent: options.silent });
                if (!attendanceResult.success) {
                    if (latestAttendanceSession && latestAttendanceSession.course_id) {
                        showInactiveTabModal(latestAttendanceSession);
                    }
                    return;
                }

                hideInactiveTabModal();

                selectedCourseId = courseId;
                autoOpenCourseAttempted = true;
                if (!options.skipStore) {
                    localStorage.setItem('selectedCourseId', courseId);
                }

                updateActiveCourseDisplay(course);

                const lobbySection = document.getElementById('lobbySection');
                const courseExperience = document.getElementById('courseExperience');
                if (lobbySection) {
                    lobbySection.classList.add('hidden');
                }
                if (courseExperience) {
                    courseExperience.classList.remove('hidden');
                }

                if (!options.silent) {
                    showNotification(`Now viewing ${course.title}`, 'success');
                }

                resetQueueForCourse(courseId);
                refreshDebugHistory();
                syncActiveCourseWithServer(true);
            } catch (error) {
                console.error('enterCourse error:', error);
                showNotification('Could not open the course. Please try again.', 'error');
            } finally {
                courseTransitionLock = false;
            }
        }

        function updateActiveCourseDisplay(course) {
            // Update course title in the header
            const headingEl = document.getElementById('courseTitleHeading');
            if (headingEl) {
                headingEl.textContent = course.title || 'Course Materials';
            }

            // Update teacher name
            const courseTeacherEl = document.getElementById('activeCourseTeacher');
            if (courseTeacherEl) {
                const teacherName = course.teacher_display_name || course.teacher_username || '';
                courseTeacherEl.textContent = teacherName ? `Teacher: ${teacherName}` : '';
                courseTeacherEl.style.display = teacherName ? '' : 'none';
            }

            // Update course description
            const descriptionEl = document.getElementById('courseDescriptionText');
            if (descriptionEl) {
                descriptionEl.textContent = course.description ? course.description : 'Your teacher has not added a description yet.';
            }

            // Load course documentation if available
            loadCourseDocumentation(course);
        }

        function loadCourseDocumentation(courseData) {
            console.log('Loading course documentation for:', courseData);
            
            if (courseData.docs_repo_url) {
                console.log('Documentation URL found:', courseData.docs_repo_url);
                const docsContainer = document.getElementById('courseDocsContainer');
                const docsFrame = document.getElementById('courseDocsFrame');
                const docsControls = document.querySelector('.docs-controls');
                
                if (docsContainer && docsFrame) {
                    docsContainer.classList.remove('hidden');
                    if (docsControls) docsControls.style.display = 'flex';
                    
                    // Construct documentation URL
                    let docsUrl = courseData.docs_repo_url;
                    
                    // Convert localhost URLs to use current host/baseUrl
                    if (docsUrl.includes('localhost:3030') || docsUrl.includes('localhost') || docsUrl.includes('127.0.0.1')) {
                        docsUrl = docsUrl.replace(/http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, baseUrl);
                    }
                    
                    // If it's a GitHub repo URL (not GitHub Pages), convert to GitHub Pages URL
                    if (docsUrl.includes('github.com') && !docsUrl.includes('github.io')) {
                        const repoPath = docsUrl.replace('https://github.com/', '').replace('.git', '');
                        const [owner, repo] = repoPath.split('/');
                        if (owner && repo) {
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
                    
                    docsFrame.src = docsUrl;
                    console.log('Loading docs from:', docsUrl);
                }
            } else {
                // No documentation available, hide docs container
                const docsContainer = document.getElementById('courseDocsContainer');
                if (docsContainer) {
                    docsContainer.classList.add('hidden');
                }
            }
        }

        function toggleDocsView() {
            const docsFrame = document.getElementById('courseDocsFrame');
            const toggleBtn = document.querySelector('.docs-btn');
            
            if (docsFrame.style.display === 'none') {
                docsFrame.style.display = 'block';
                toggleBtn.textContent = 'Hide Docs';
            } else {
                docsFrame.style.display = 'none';
                toggleBtn.textContent = 'Show Docs';
            }
        }

        function openDocsNewTab() {
            const docsFrame = document.getElementById('courseDocsFrame');
            if (docsFrame.src) {
                window.open(docsFrame.src, '_blank');
            }
        }

        async function returnToLobby(clearSelection = false) {
            if (courseTransitionLock) {
                return;
            }

            if (!isControlTab) {
                hideInactiveTabModal();
                enterPassiveLobbyView();
                return;
            }

            courseTransitionLock = true;
            try {
                const previousCourseId = selectedCourseId;
                if (previousCourseId) {
                    const previousCourse = studentCourses.find(item => item.id === previousCourseId) || null;
                    await leaveCourse(previousCourseId, { silent: true, course: previousCourse });
                }

                const lobbySection = document.getElementById('lobbySection');
                const courseExperience = document.getElementById('courseExperience');
                if (courseExperience) {
                    courseExperience.classList.add('hidden');
                }
                if (lobbySection) {
                    lobbySection.classList.remove('hidden');
                }

                selectedCourseId = null;
                if (clearSelection) {
                    localStorage.removeItem('selectedCourseId');
                }

                resetQueueForCourse(null);
                refreshDebugHistory();
                syncActiveCourseWithServer(true);
            } catch (error) {
                console.error('returnToLobby error:', error);
                showNotification('Could not leave the course. Please try again.', 'error');
            } finally {
                courseTransitionLock = false;
            }
        }

        async function promptCourseEnrollment(courseId) {
            const course = studentCourses.find(item => item.id === courseId);
            if (!course) {
                showNotification('Course unavailable. Refresh and try again.', 'error');
                return;
            }

            const passkey = window.prompt(`Enter the passkey for "${course.title}"`);
            if (passkey === null) {
                return;
            }

            const trimmed = passkey.trim();
            if (!trimmed) {
                showNotification('Passkey is required to enroll.', 'error');
                return;
            }

            try {
                const response = await fetch(`/api/courses/${courseId}/enroll`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ access_code: trimmed })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Enrollment failed');
                }

                showNotification(`Enrolled in ${course.title}!`, 'success');
                selectedCourseId = courseId;
                localStorage.setItem('selectedCourseId', courseId);
                autoOpenCourseAttempted = false;
                await loadStudentCourses();
            } catch (error) {
                console.error('Enroll course error:', error);
                showNotification(error.message || 'Failed to enroll in course.', 'error');
            }
        }

        function ensureNotificationContainer() {
            let container = document.getElementById('studentNotificationTray');
            if (!container) {
                container = document.createElement('div');
                container.id = 'studentNotificationTray';
                container.style.position = 'fixed';
                container.style.top = '20px';
                container.style.right = '20px';
                container.style.zIndex = '2000';
                container.style.maxWidth = '320px';
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '10px';
                document.body.appendChild(container);
            }
            return container;
        }

        function showNotification(message, type = 'info') {
            const container = ensureNotificationContainer();
            const note = document.createElement('div');
            note.className = `notification ${type}`;
            note.textContent = message;
            note.style.transition = 'opacity 0.3s ease';
            container.appendChild(note);

            setTimeout(() => {
                note.style.opacity = '0';
                setTimeout(() => {
                    if (note.parentElement) {
                        note.parentElement.removeChild(note);
                    }
                }, 300);
            }, 2500);
        }

        document.addEventListener('visibilitychange', () => {
            emitVisibilityState(!document.hidden);
        });
        window.addEventListener('focus', () => emitVisibilityState(true));
        window.addEventListener('blur', () => emitVisibilityState(!document.hidden));
        window.addEventListener('beforeunload', () => emitVisibilityState(false));

        window.enterCourse = enterCourse;
        window.promptCourseEnrollment = promptCourseEnrollment;
        window.returnToLobby = returnToLobby;

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
                if (user.role !== 'student') {
                    window.location.href = '/';
                    return;
                }

                const displayName = user.display_name || user.username || 'Student';
                document.getElementById('studentName').textContent = displayName;

                const takeoverButton = document.getElementById('inactiveTakeoverButton');
                const lobbyButton = document.getElementById('inactiveLobbyButton');
                const closeButton = document.getElementById('inactiveCloseButton');
                if (takeoverButton) {
                    takeoverButton.addEventListener('click', handleInactiveModalTakeover);
                }
                if (lobbyButton) {
                    lobbyButton.addEventListener('click', handleInactiveModalLobby);
                }
                if (closeButton) {
                    closeButton.addEventListener('click', handleInactiveModalClose);
                }

                selectedCourseId = normalizeCourseId(localStorage.getItem('selectedCourseId'));
                activeQueueCourseId = selectedCourseId;
                autoOpenCourseAttempted = false;
                renderCourseLobby();

                initializeSocket();
                loadStudentCourses();
                emitVisibilityState(!document.hidden);
            } catch (error) {
                console.error('Error parsing user data:', error);
                window.location.href = '/';
            }
        });

        // Socket initialization
        function initializeSocket() {
            socket = io();
            
            socket.on('connect', () => {
                updateConnectionStatus(true);
                socket.emit('auth', { token, tab_id: tabId });
                emitVisibilityState(!document.hidden);
            });

            socket.on('disconnect', () => {
                updateConnectionStatus(false);
                socketAuthenticated = false;
                lastSentActiveCourseId = null;
                isControlTab = true;
            });

            socket.on('auth_ok', (data) => {
                console.log('Authenticated as student');
                socketAuthenticated = true;
                emitVisibilityState(!document.hidden);
                syncActiveCourseWithServer(true);
            });

            socket.on('auth_error', (data) => {
                console.error('Authentication failed:', data.message);
                logout();
            });

            socket.on('reconnect', () => {
                socketAuthenticated = false;
                lastSentActiveCourseId = null;
                emitVisibilityState(!document.hidden);
            });

            socket.on('attendance_session_updated', (payload = {}) => {
                const session = payload.session || null;
                latestAttendanceSession = session;

                if (!session) {
                    return;
                }

                const normalizedCourseId = normalizeCourseId(session.course_id);
                const sessionActiveTab = session.active_tab_id ? String(session.active_tab_id) : null;

                if (session.status === 'ended') {
                    activeAttendanceSession = null;
                    latestAttendanceSession = null;
                    isControlTab = true;
                    hideInactiveTabModal();
                    enterPassiveLobbyView();
                    showNotification('Attendance session ended.', 'info');
                    return;
                }

                activeAttendanceSession = session;

                if (!sessionActiveTab || sessionActiveTab !== tabId) {
                    showInactiveTabModal(session);
                    return;
                }

                hideInactiveTabModal();
                isControlTab = true;

                if (normalizedCourseId && selectedCourseId !== normalizedCourseId) {
                    selectedCourseId = normalizedCourseId;
                    localStorage.setItem('selectedCourseId', normalizedCourseId);
                    autoOpenCourseAttempted = false;
                    renderCourseLobby();
                }

                if (normalizedCourseId) {
                    activeQueueCourseId = normalizedCourseId;
                    lastSentActiveCourseId = normalizedCourseId;
                }
            });

            socket.on('course_activation_error', (payload = {}) => {
                const message = payload.message || 'Could not change course. Please try again.';
                showNotification(message, 'error');
                isControlTab = false;

                if (payload.active_course && payload.active_course.course_id && selectedCourseId !== payload.active_course.course_id) {
                    selectedCourseId = payload.active_course.course_id;
                    localStorage.setItem('selectedCourseId', payload.active_course.course_id);
                    autoOpenCourseAttempted = false;
                    renderCourseLobby();
                    if (payload.active_course.active_tab_id && payload.active_course.active_tab_id !== tabId) {
                        showInactiveTabModal({
                            course_id: payload.active_course.course_id,
                            active_tab_id: payload.active_course.active_tab_id,
                            status: payload.active_course.status || 'viewing'
                        });
                    }
                }
            });

            // New queue-based events
            socket.on('quiz_queue_updated', async (data) => {
                console.log('Quiz queue updated:', data);

                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring queue update for mismatched course', data.course_id, selectedCourseId);
                    return;
                }

                activeQueueCourseId = normalizeCourseId(data.course_id);
                const normalizedCurrent = data.currentQuiz ? (() => {
                    const timeout = normalizeTimeoutSeconds(data.currentQuiz.timeout_seconds);
                    const remaining = normalizeRemainingSeconds(data.currentQuiz.remaining_seconds, timeout);
                    return {
                        ...data.currentQuiz,
                        timeout_seconds: timeout,
                        remaining_seconds: remaining,
                        position: data.currentQuiz.position || 1,
                        total: data.currentQuiz.total || (Array.isArray(data.pending) ? data.pending.length + 1 : 1)
                    };
                })() : null;

                const rawPending = Array.isArray(data.pending) ? data.pending : [];
                const normalizedPending = rawPending.map((item) => {
                    const timeout = normalizeTimeoutSeconds(item.timeout_seconds);
                    const remaining = normalizeRemainingSeconds(item.remaining_seconds, timeout);
                    return {
                        ...item,
                        timeout_seconds: timeout,
                        remaining_seconds: remaining
                    };
                });

                const inferredTotal = typeof data.total === 'number'
                    ? data.total
                    : ((normalizedCurrent ? 1 : 0) + normalizedPending.length);

                const totalCount = Math.max(
                    inferredTotal,
                    normalizedPending.length + (normalizedCurrent ? 1 : 0)
                );

                const basePosition = normalizedCurrent ? (normalizedCurrent.position || 1) : 0;

                queueSnapshot = {
                    currentQuiz: normalizedCurrent ? {
                        ...normalizedCurrent,
                        position: normalizedCurrent.position || 1,
                        total: totalCount
                    } : null,
                    pending: normalizedPending.map((item, idx) => ({
                        ...item,
                        position: item.position || (basePosition + idx + (normalizedCurrent ? 1 : 1)),
                        total: totalCount
                    })),
                    total: totalCount
                };
                updateDebugQueue(); // Update debug display

                if (queueSnapshot.currentQuiz) {
                    const active = queueSnapshot.currentQuiz;
                    if (!matchesActiveCourse(active.course_id, { allowMissing: true })) {
                        console.log('Dropping stale current quiz for mismatched course', active.course_id, selectedCourseId);
                        queueSnapshot.currentQuiz = null;
                    } else if (currentQuiz && currentQuiz.push_id === active.push_id) {
                        currentQuiz.position = active.position || currentQuiz.position;
                        currentQuiz.total = active.total || currentQuiz.total;
                        const normalizedTimeout = normalizeTimeoutSeconds(active.timeout_seconds, currentQuiz.timeout_seconds);
                        const normalizedRemaining = normalizeRemainingSeconds(active.remaining_seconds, normalizedTimeout);
                        currentQuiz.timeout_seconds = normalizedTimeout;
                        currentQuiz.remaining_seconds = normalizedRemaining;
                        currentQuiz.endTime = Date.now() + normalizedRemaining * 1000;
                        updateQuizOverlayHeader();
                    }
                    clearQuizCloseTimer();
                } else if (isQuizOverlayVisible()) {
                    scheduleQuizClose(3000);
                }

                if (!hasRunAutoCleanup && queueSnapshot.total > 0) {
                    hasRunAutoCleanup = true;
                    try {
                        const response = await fetch('/api/my-quiz-history', {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                            const historyData = await response.json();
                            if (historyData.orphaned > 0) {
                                console.log(`🧹 Auto-cleanup: ${historyData.orphaned} orphaned records detected`);
                                await fetch('/api/cleanup-orphaned-quizzes', {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });
                                console.log('✅ Auto-cleanup completed');
                            }
                        }
                    } catch (error) {
                        console.error('Auto-cleanup error:', error);
                    }
                }

                // Keep debug history table in sync
                refreshDebugHistory();

                // Show queue status to user
                if (queueSnapshot.total > 0) {
                    showNotification(`You have ${queueSnapshot.total} quiz(es) in your queue`, 'info');
                }
            });

            socket.on('show_next_quiz', (data) => {
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring show_next_quiz for mismatched course', data.course_id, selectedCourseId);
                    return;
                }

                console.log('Show next quiz:', data);
                showQuiz(data);
                updateDebugQueue(); // Update debug display
            });

            socket.on('queue_empty', (data) => {
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring queue_empty for mismatched course', data.course_id, selectedCourseId);
                    return;
                }

                console.log('Queue is empty');
                queueSnapshot = { currentQuiz: null, pending: [], total: 0 };
                hasRunAutoCleanup = false;
                updateDebugQueue(); // Update debug display
                showNotification(data.message || 'All quizzes completed!', 'success');
                refreshDebugHistory();
                if (isQuizOverlayVisible()) {
                    scheduleQuizClose(3000);
                }
            });

            // Legacy quiz_push for backward compatibility (now handled by quiz_queue_updated + show_next_quiz)
            socket.on('quiz_push', async (data) => {
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring legacy quiz_push for mismatched course', data.course_id, selectedCourseId);
                    return;
                }
                console.log('Legacy quiz_push received:', data.push_id);
                showQuiz(data);
            });

            socket.on('quiz_undo', (data) => {
                queueSnapshot.pending = queueSnapshot.pending.filter(item => matchesActiveCourse(item.course_id, { allowMissing: true }));
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring quiz_undo for mismatched course', data.course_id, selectedCourseId);
                    return;
                }

                console.log('Quiz undo received for quiz_id:', data.quiz_id);
                console.log('Current quiz quiz_id:', currentQuiz ? currentQuiz.quiz_id : 'none');

                // Remove from local snapshot until server resend
                const undoQuizId = (data.quiz_id && typeof data.quiz_id === 'string') ? data.quiz_id : null;
                const undoPushId = (data.push_id && typeof data.push_id === 'string') ? data.push_id : null;

                if (undoQuizId && queueSnapshot.currentQuiz && queueSnapshot.currentQuiz.quiz_id === undoQuizId) {
                    queueSnapshot.currentQuiz = null;
                }
                queueSnapshot.pending = queueSnapshot.pending
                    .filter(item => matchesActiveCourse(item.course_id, { allowMissing: true }))
                    .filter(item => {
                        if (undoQuizId && item.quiz_id) {
                            return item.quiz_id !== undoQuizId;
                        }
                        if (undoPushId && item.push_id) {
                            return item.push_id !== undoPushId;
                        }
                        return true;
                    });
                queueSnapshot.total = (queueSnapshot.currentQuiz ? 1 : 0) + queueSnapshot.pending.length;
                updateDebugQueue();
                refreshDebugHistory();

                // Show debug message on screen
                let lastUndoEl = document.getElementById('lastUndoDebug');
                if (!lastUndoEl) {
                    lastUndoEl = document.createElement('div');
                    lastUndoEl.id = 'lastUndoDebug';
                    lastUndoEl.style.cssText = `position: fixed; top: 10px; right: 10px; z-index: 10000; background: #ff6b6b; color: white; padding: 8px 12px; border-radius: 4px; font-weight: bold; box-shadow: 0 4px 8px rgba(0,0,0,0.3);`;
                    document.body.appendChild(lastUndoEl);
                }
                const label = undoQuizId
                    ? `Quiz ${undoQuizId.substring(0, 8)}...`
                    : (undoPushId ? `Push ${undoPushId.substring(0, 8)}...` : 'UNDO received');

                lastUndoEl.textContent = `UNDO: ${label}`;
                lastUndoEl.style.display = 'block';
                setTimeout(() => { lastUndoEl.style.display = 'none'; }, 3000);

                // Only hide quiz if the undo matches the currently displayed quiz's push_id
                if ((undoQuizId && currentQuiz && currentQuiz.quiz_id === undoQuizId) ||
                    (!undoQuizId && undoPushId && currentQuiz && currentQuiz.push_id === undoPushId)) {
                    console.log('✓ Match! Hiding quiz with quiz_id:', undoQuizId || currentQuiz.quiz_id);
                    try {
                        hideQuiz();
                        showNotification('Quiz was cancelled by teacher', 'info');
                        // Server will send next quiz or queue update
                    } catch (e) {
                        console.error('Error hiding quiz on undo:', e);
                    }
                } else {
                    console.log('✗ No match. Quiz removed from queue but not currently viewing.');
                    showNotification('A quiz was removed from your queue', 'info');
                }
            });

            socket.on('quiz_timeout', (data) => {
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring quiz_timeout for mismatched course', data.course_id, selectedCourseId);
                    return;
                }

                if (currentQuiz && currentQuiz.push_id === data.push_id) {
                    showQuizMessage('Quiz timed out!', 'error');
                    disableQuizSubmission();
                    scheduleQuizClose(3000);
                }
            });

            socket.on('answer_submitted', (data) => {
                if (!matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring answer_submitted for mismatched course', data.course_id, selectedCourseId);
                    return;
                }
                showQuizMessage('Answer submitted successfully!', 'success');
                disableQuizSubmission();
                
                // Auto-hide after 3 seconds; server will provide next quiz if available
                scheduleQuizClose(3000);
            });

            socket.on('error', (data) => {
                if (data && !matchesActiveCourse(data.course_id, { allowMissing: true })) {
                    console.log('Ignoring error for mismatched course', data.course_id, selectedCourseId);
                    return;
                }
                showQuizMessage(data.message, 'error');
                // If already answered, disable submission
                if (data.message && data.message.includes('Already answered')) {
                    disableQuizSubmission();
                    scheduleQuizClose(3000);
                }
            });

            socket.on('active_pushes', (data) => {
                // Handle active pushes on reconnect - request current queue instead
                console.log('Reconnected, requesting current queue');
                socket.emit('get_my_queue');
            });

            socket.on('show_answers', (data) => {
                console.log('Received show_answers:', data);
                showAnswersModal(data);
            });
        }

        // Show Answers Modal
        function showAnswersModal(data) {
            const modal = document.getElementById('answersModal');
            const body = document.getElementById('answersModalBody');
            
            if (!modal || !body) return;

            const results = data.results || [];
            const courseTitle = data.course_title || 'Course';

            if (results.length === 0) {
                body.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: #6b7280;">
                        <p style="font-size: 16px;">No quiz results available for ${escapeHtml(courseTitle)}</p>
                    </div>
                `;
            } else {
                let correctCount = 0;
                let totalScored = 0;

                results.forEach(item => {
                    if (item.is_scored) {
                        totalScored++;
                        if (item.is_correct) correctCount++;
                    }
                });

                let summaryHtml = '';
                if (totalScored > 0) {
                    const percentage = Math.round((correctCount / totalScored) * 100);
                    summaryHtml = `
                        <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                            <div style="font-size: 18px; font-weight: 600; color: #1e40af; margin-bottom: 8px;">
                                📊 Your Score: ${correctCount}/${totalScored} (${percentage}%)
                            </div>
                            <div style="font-size: 14px; color: #3b82f6;">
                                Course: ${escapeHtml(courseTitle)}
                            </div>
                        </div>
                    `;
                }

                const itemsHtml = results.map(item => {
                    let statusClass = 'timeout';
                    let badgeText = 'Timeout';
                    let badgeClass = 'timeout';

                    if (item.status === 'answered') {
                        if (item.is_correct) {
                            statusClass = 'correct';
                            badgeText = item.is_scored ? `✓ Correct (+${item.points} pts)` : '✓ Correct';
                            badgeClass = 'correct';
                        } else {
                            statusClass = 'incorrect';
                            badgeText = item.is_scored ? '✗ Incorrect' : '— Not Graded';
                            badgeClass = 'incorrect';
                        }
                    }

                    let contentHtml = '';
                    if (item.quiz_content) {
                        try {
                            // Render markdown for quiz content
                            contentHtml = `<div class="answer-item-content">${marked.parse(item.quiz_content)}</div>`;
                        } catch (e) {
                            // Fallback to escaped HTML if markdown parsing fails
                            contentHtml = `<div class="answer-item-content">${escapeHtml(item.quiz_content)}</div>`;
                        }
                    }

                    return `
                        <div class="answer-item ${statusClass}">
                            <div class="answer-item-header">
                                <div class="answer-item-title">${escapeHtml(item.quiz_title)}</div>
                                <span class="answer-item-badge ${badgeClass}">${badgeText}</span>
                            </div>
                            ${contentHtml}
                            <div class="answer-row">
                                <div class="answer-label">Your Answer:</div>
                                <div class="answer-value">${escapeHtml(item.your_answer)}</div>
                            </div>
                            <div class="answer-row">
                                <div class="answer-label">Correct Answer:</div>
                                <div class="answer-value">${escapeHtml(item.correct_answer)}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                body.innerHTML = summaryHtml + itemsHtml;
                
                // Apply syntax highlighting to code blocks in the modal
                body.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }

            modal.classList.remove('hidden');
        }

        function closeAnswersModal() {
            const modal = document.getElementById('answersModal');
            if (modal) {
                modal.classList.add('hidden');
            }
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Update connection status
        function updateConnectionStatus(connected) {
            const statusElement = document.getElementById('connectionStatus');
            if (connected) {
                statusElement.textContent = 'Connected';
                statusElement.classList.remove('disconnected');
            } else {
                statusElement.textContent = 'Disconnected';
                statusElement.classList.add('disconnected');
            }
        }

        // Show quiz overlay
        function showQuiz(quizData) {
            clearQuizCloseTimer();

            const fallbackTimeout = normalizeTimeoutSeconds(quizData.timeout_seconds);
            const remaining = normalizeRemainingSeconds(quizData.remaining_seconds, fallbackTimeout);

            currentQuiz = {
                ...quizData,
                timeout_seconds: fallbackTimeout,
                remaining_seconds: remaining
            };

            if (queueSnapshot.currentQuiz && queueSnapshot.currentQuiz.push_id === currentQuiz.push_id) {
                currentQuiz.position = queueSnapshot.currentQuiz.position || currentQuiz.position;
                currentQuiz.total = queueSnapshot.currentQuiz.total || currentQuiz.total;
            } else {
                currentQuiz.position = currentQuiz.position || 1;
                currentQuiz.total = currentQuiz.total || Math.max(1, queueSnapshot.total || 1);
                queueSnapshot.currentQuiz = {
                    push_id: currentQuiz.push_id,
                    quiz_id: currentQuiz.quiz.id,
                    quiz: currentQuiz.quiz,
                    position: currentQuiz.position,
                    total: currentQuiz.total,
                    remaining_seconds: remaining,
                    timeout_seconds: fallbackTimeout,
                    status: 'viewing',
                    added_at: currentQuiz.pushed_at || new Date().toISOString()
                };
            }

            queueSnapshot.total = Math.max(
                currentQuiz.total || 1,
                queueSnapshot.pending.length + (queueSnapshot.currentQuiz ? 1 : 0)
            );

            queueSnapshot.pending = queueSnapshot.pending.map((item, index) => ({
                ...item,
                total: queueSnapshot.total,
                position: item.position || ((currentQuiz.position || 1) + index + 1),
                timeout_seconds: normalizeTimeoutSeconds(item.timeout_seconds),
                remaining_seconds: normalizeRemainingSeconds(item.remaining_seconds, item.timeout_seconds)
            }));
            
            // Calculate end time from server's remaining time
            // This ensures timer is based on server timestamp, not client countdown
            currentQuiz.endTime = Date.now() + (remaining * 1000);
            
            // Update quiz title with queue position if available
            updateQuizOverlayHeader();
            
            // Render question content with markdown support
            const questionContent = quizData.quiz.content_text || '';
            const questionElement = document.getElementById('quizQuestion');
            try {
                questionElement.innerHTML = marked.parse(questionContent);
                // Apply syntax highlighting to code blocks
                questionElement.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            } catch (e) {
                // Fallback if markdown parsing fails
                questionElement.textContent = questionContent;
            }

            if (queueSnapshot.currentQuiz && queueSnapshot.currentQuiz.push_id === quizData.push_id) {
                queueSnapshot.currentQuiz = {
                    ...queueSnapshot.currentQuiz,
                    position: quizData.position || queueSnapshot.currentQuiz.position,
                    total: quizData.total || queueSnapshot.currentQuiz.total,
                    remaining_seconds: remaining,
                    timeout_seconds: fallbackTimeout
                };
                updateDebugQueue();
            }
            
            // Handle images
            const imagesContainer = document.getElementById('quizImages');
            if (quizData.quiz.images && quizData.quiz.images.length > 0) {
                imagesContainer.innerHTML = quizData.quiz.images.map(imgUrl => 
                    `<img src="${imgUrl}" alt="Quiz image">`
                ).join('');
            } else {
                imagesContainer.innerHTML = '';
            }
            
            // Setup answer interface
            setupAnswerInterface(quizData.quiz);
            resetAnswerState();
            
            // Clear any previous messages
            document.getElementById('quizMessages').innerHTML = '';
            
            // Show overlay - force remove both hidden class and display style
            const overlay = document.getElementById('quizOverlay');
            overlay.classList.remove('hidden');
            overlay.style.display = ''; // Remove any inline display:none from previous hide
            
            console.log('Quiz overlay shown for push_id:', quizData.push_id);
            console.log('Timeout seconds from server:', quizData.timeout_seconds);
            console.log('End time calculated:', new Date(currentQuiz.endTime).toLocaleTimeString());
            
            // Start timer (calculates from endTime)
            startQuizTimer();
            
            // Ensure submission button is enabled after reset
            document.getElementById('submitAnswer').disabled = false;
        }

        // Setup answer interface based on question type
        function setupAnswerInterface(quiz) {
            const textAnswer = document.getElementById('textAnswer');
            const selectAnswers = document.getElementById('selectAnswers');
            const answerLabel = document.getElementById('answerLabel');
            
            // Parse options if they come as a string
            let options = quiz.options;
            if (typeof options === 'string') {
                try {
                    options = JSON.parse(options);
                } catch (e) {
                    console.error('Failed to parse options:', e);
                    options = [];
                }
            }
            if (!Array.isArray(options)) {
                options = [];
            }
            
            console.log('setupAnswerInterface called with:', {
                question_type: quiz.question_type,
                options: options,
                optionsLength: options.length
            });
            
            // Always re-enable inputs before configuring
            textAnswer.disabled = false;
            textAnswer.style.opacity = '';
            textAnswer.style.pointerEvents = '';

            if (quiz.question_type === 'text') {
                textAnswer.classList.remove('hidden');
                selectAnswers.classList.add('hidden');
                answerLabel.textContent = 'Your Answer:';
                textAnswer.value = '';
            } else if (quiz.question_type === 'select') {
                textAnswer.classList.add('hidden');
                selectAnswers.classList.remove('hidden');
                answerLabel.textContent = 'Choose your answer:';
                
                // Create radio options with markdown rendering
                selectAnswers.innerHTML = options.map((option, index) => {
                    let renderedOption;
                    try {
                        renderedOption = marked.parse(option);
                    } catch (e) {
                        renderedOption = escapeHtml(option);
                    }
                    return `
                        <div class="option-item" onclick="selectOption(${index})">
                            <input type="radio" name="quizOption" value="${index}" id="option${index}">
                            <label for="option${index}">${renderedOption}</label>
                        </div>
                    `;
                }).join('');
                
                // Apply syntax highlighting to code blocks in options
                selectAnswers.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            } else if (quiz.question_type === 'checkbox') {
                textAnswer.classList.add('hidden');
                selectAnswers.classList.remove('hidden');
                answerLabel.textContent = 'Select all that apply:';
                
                // Create checkbox options with markdown rendering
                selectAnswers.innerHTML = options.map((option, index) => {
                    let renderedOption;
                    try {
                        renderedOption = marked.parse(option);
                    } catch (e) {
                        renderedOption = escapeHtml(option);
                    }
                    return `
                        <div class="option-item" onclick="toggleCheckboxOption(${index})">
                            <input type="checkbox" name="quizOption" value="${index}" id="option${index}">
                            <label for="option${index}">${renderedOption}</label>
                        </div>
                    `;
                }).join('');
                
                // Apply syntax highlighting to code blocks in options
                selectAnswers.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function toggleCheckboxOption(index) {
            const checkbox = document.getElementById(`option${index}`);
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = !checkbox.checked;
                checkbox.parentElement.classList.toggle('selected', checkbox.checked);
            }
        }

        // Reset state for all answer inputs and submission button
        function resetAnswerState() {
            const submitBtn = document.getElementById('submitAnswer');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Answer';
            submitBtn.style.opacity = '';
            submitBtn.style.pointerEvents = '';

            const textAnswer = document.getElementById('textAnswer');
            textAnswer.disabled = false;
            textAnswer.value = '';
            textAnswer.style.opacity = '';
            textAnswer.style.pointerEvents = '';

            document.querySelectorAll('.option-item').forEach(item => {
                item.style.pointerEvents = '';
                item.style.opacity = '';
                item.classList.remove('selected');
            });

            document.querySelectorAll('input[name="quizOption"]').forEach(input => {
                input.disabled = false;
                input.checked = false;
            });
        }

        function disableAnswerInputs() {
            const textAnswer = document.getElementById('textAnswer');
            textAnswer.disabled = true;
            textAnswer.style.opacity = '0.6';
            textAnswer.style.pointerEvents = 'none';

            document.querySelectorAll('.option-item').forEach(item => {
                item.style.pointerEvents = 'none';
                item.style.opacity = '0.6';
            });

            document.querySelectorAll('input[name="quizOption"]').forEach(radio => {
                radio.disabled = true;
            });
        }

        function clearQuizCloseTimer() {
            if (quizCloseTimer) {
                clearTimeout(quizCloseTimer);
                quizCloseTimer = null;
            }
        }

        function scheduleQuizClose(delayMs = 3000) {
            clearQuizCloseTimer();
            quizCloseTimer = setTimeout(() => {
                if (isQuizOverlayVisible()) {
                    hideQuiz();
                } else {
                    clearQuizCloseTimer();
                }
            }, delayMs);
        }

        function updateQuizOverlayHeader() {
            if (!currentQuiz || !currentQuiz.quiz) return;
            const titleElement = document.getElementById('quizTitle');
            const queueInfo = (currentQuiz.position && currentQuiz.total)
                ? ` (${currentQuiz.position}/${currentQuiz.total})`
                : '';
            titleElement.textContent = currentQuiz.quiz.title + queueInfo;
        }

        function isQuizOverlayVisible() {
            const overlay = document.getElementById('quizOverlay');
            return overlay && !overlay.classList.contains('hidden');
        }

        function normalizeTimeoutSeconds(value, fallback = 60) {
            const num = Number(value);
            if (!Number.isFinite(num) || num <= 0) {
                const fallbackNum = Number(fallback);
                return Number.isFinite(fallbackNum) && fallbackNum > 0 ? fallbackNum : 60;
            }
            return Math.floor(num);
        }

        function normalizeRemainingSeconds(value, fallback = 60) {
            const num = Number(value);
            if (!Number.isFinite(num) || num <= 0) {
                return normalizeTimeoutSeconds(fallback, fallback);
            }
            return Math.floor(num);
        }

        // Select option for multiple choice
        function selectOption(index) {
            // Remove previous selection
            document.querySelectorAll('.option-item').forEach(item => {
                item.classList.remove('selected');
            });
            
            // Select current option
            const selectedItem = document.querySelectorAll('.option-item')[index];
            selectedItem.classList.add('selected');
            
            // Check radio button
            document.getElementById(`option${index}`).checked = true;
        }

        // Start quiz timer (calculates from endTime, not countdown)
        function startQuizTimer() {
            const timerElement = document.getElementById('quizTimer');
            
            // Clear any existing timer
            if (quizTimer) {
                clearInterval(quizTimer);
            }
            
            // Update timer display every 100ms for accuracy
            quizTimer = setInterval(() => {
                if (!currentQuiz || !Number.isFinite(currentQuiz.endTime)) {
                    clearInterval(quizTimer);
                    return;
                }
                
                // Calculate remaining time from endTime
                const now = Date.now();
                const remainingMs = currentQuiz.endTime - now;
                remainingTime = Math.max(0, Math.floor(remainingMs / 1000));
                
                const minutes = Math.floor(remainingTime / 60);
                const seconds = remainingTime % 60;
                const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                
                if (remainingTime <= 10) {
                    timerElement.innerHTML = `<span class="timeout-warning">Time remaining: ${timeString}</span>`;
                } else {
                    timerElement.textContent = `Time remaining: ${timeString}`;
                }
                
                if (remainingTime <= 0) {
                    clearInterval(quizTimer);
                    showQuizMessage('Time\'s up!', 'error');
                    disableQuizSubmission();
                }
            }, 100); // Update every 100ms for smoother countdown
        }

        // Submit answer
        function submitAnswer() {
            if (!currentQuiz) return;
            
            let answer;
            
            if (currentQuiz.quiz.question_type === 'text') {
                answer = document.getElementById('textAnswer').value.trim();
                if (!answer) {
                    showQuizMessage('Please enter an answer', 'error');
                    return;
                }
            } else if (currentQuiz.quiz.question_type === 'select') {
                const selectedOption = document.querySelector('input[name="quizOption"]:checked');
                if (!selectedOption) {
                    showQuizMessage('Please select an option', 'error');
                    return;
                }
                const optionIndex = parseInt(selectedOption.value);
                answer = {
                    selected_index: optionIndex,
                    selected_text: currentQuiz.quiz.options[optionIndex]
                };
            } else if (currentQuiz.quiz.question_type === 'checkbox') {
                const selectedOptions = Array.from(document.querySelectorAll('input[name="quizOption"]:checked'));
                if (selectedOptions.length === 0) {
                    showQuizMessage('Please select at least one option', 'error');
                    return;
                }
                answer = selectedOptions.map(checkbox => {
                    const optionIndex = parseInt(checkbox.value);
                    return currentQuiz.quiz.options[optionIndex];
                });
            }
            
            // Send answer to server
            socket.emit('quiz_answer', {
                push_id: currentQuiz.push_id,
                answer: answer,
                answered_at: new Date().toISOString()
            });
            
            // Disable submission to prevent double submission
            document.getElementById('submitAnswer').disabled = true;
            document.getElementById('submitAnswer').textContent = 'Submitting...';
            disableAnswerInputs();
        }

        // Show quiz message
        function showQuizMessage(message, type) {
            const messagesContainer = document.getElementById('quizMessages');
            const messageClass = type === 'error' ? 'error-message' : 'success-message';
            messagesContainer.innerHTML = `<div class="${messageClass}">${message}</div>`;
        }

        // Disable quiz submission
        function disableQuizSubmission() {
            document.getElementById('submitAnswer').disabled = true;
            document.getElementById('submitAnswer').textContent = 'Submitted';
            disableAnswerInputs();
            
            if (quizTimer) {
                clearInterval(quizTimer);
                quizTimer = null;
            }
        }

        // Hide quiz overlay
        function hideQuiz() {
            console.log('hideQuiz() called');
            clearQuizCloseTimer();
            
            const overlay = document.getElementById('quizOverlay');
            console.log('Quiz overlay element:', overlay);
            console.log('Overlay classes before:', overlay.className);
            
            overlay.classList.add('hidden');
            console.log('Overlay classes after adding hidden:', overlay.className);
            
            // Force hide with display none as backup
            overlay.style.display = 'none';
            console.log('Force set display:none on overlay');
            console.log('Final computed display style:', window.getComputedStyle(overlay).display);
            
            // Show debug message on screen
            const debugMsg = document.createElement('div');
            debugMsg.style.cssText = `
                position: fixed; top: 50px; right: 10px; z-index: 10000;
                background: #28a745; color: white; padding: 10px; border-radius: 5px;
                font-weight: bold; box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            `;
            debugMsg.textContent = 'QUIZ HIDDEN SUCCESSFULLY';
            document.body.appendChild(debugMsg);
            
            // Remove debug message after 2 seconds
            setTimeout(() => {
                if (debugMsg.parentNode) {
                    debugMsg.parentNode.removeChild(debugMsg);
                }
            }, 2000);
            
            currentQuiz = null;
            
            if (quizTimer) {
                clearInterval(quizTimer);
                quizTimer = null;
                console.log('Quiz timer cleared');
            }
        }

        // Logout
        async function logout() {
            try {
                if (selectedCourseId && isControlTab) {
                    const currentCourse = studentCourses.find(item => item.id === selectedCourseId) || null;
                    await leaveCourse(selectedCourseId, { silent: true, course: currentCourse });
                }
            } catch (error) {
                console.error('Logout attendance cleanup error:', error);
            }

            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (socket) {
                if (socket.connected) {
                    emitVisibilityState(false);
                }
                socket.disconnect();
            }
            window.location.href = '/';
        }

        // Update debug queue display
        function updateDebugQueue() {
            const container = document.getElementById('queueDebugContent');
            if (!container) return;

            const items = [];

            if (queueSnapshot.currentQuiz) {
                items.push({ ...queueSnapshot.currentQuiz, label: 'Now' });
            }

            queueSnapshot.pending.forEach((pendingItem, idx) => {
                items.push({ ...pendingItem, label: `Next ${idx + 1}` });
            });

            if (items.length === 0) {
                container.innerHTML = '<div class="debug-queue-empty">Queue is empty</div>';
                return;
            }

            container.innerHTML = items.map((item, index) => {
                const isCurrent = index === 0 && !!queueSnapshot.currentQuiz;
                const statusEmoji = isCurrent ? '▶️' : '⏳';
                const statusText = (item.status || (isCurrent ? 'viewing' : 'pending')).toUpperCase();
                const remaining = typeof item.remaining_seconds === 'number' ? `${item.remaining_seconds}s left` : '';
                const positionText = item.position && item.total ? `${item.position}/${item.total}` : item.label;

                return `
                    <div class="debug-queue-item">
                        ${statusEmoji} ${positionText} — ${item.quiz ? item.quiz.title : 'Quiz #' + item.quiz_id}
                        <br><small style="color: #aaa;">${statusText}${remaining ? ' • ' + remaining : ''} • Push ${item.push_id.substring(0, 8)}...</small>
                    </div>
                `;
            }).join('');
        }

        // Toggle debug history visibility
        function toggleDebugHistory() {
            const debugHistory = document.getElementById('debugHistory');
            const btn = debugHistory.querySelector('.debug-toggle-btn');
            
            if (debugHistory.classList.contains('hidden')) {
                debugHistory.classList.remove('hidden');
                btn.textContent = 'Hide';
                refreshDebugHistory(); // Load data when showing
            } else {
                debugHistory.classList.add('hidden');
                btn.textContent = 'Show';
            }
        }

        // Refresh debug history data
        async function refreshDebugHistory() {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/my-quiz-history', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch quiz history');
                }

                const data = await response.json();
                displayDebugHistory(data);
            } catch (error) {
                console.error('Error fetching quiz history:', error);
                showNotification('Failed to load quiz history', 'error');
            }
        }

        // Display debug history in table
        function displayDebugHistory(data) {
            const container = document.getElementById('debugHistoryContent');
            
            // Update stats
            const statsHtml = `
                <div class="debug-stats">
                    📊 Total Records: <strong>${data.total}</strong> | 
                    ⚠️ Orphaned (Deleted): <strong>${data.orphaned}</strong>
                    ${data.orphaned > 0 ? ' | <small>Use Cleanup to remove orphaned records</small>' : ''}
                </div>
            `;

            // Build table
            if (data.history.length === 0) {
                container.innerHTML = statsHtml + '<p style="text-align: center; color: #888;">No quiz history found</p>';
                return;
            }

            const tableRows = data.history.map(record => {
                const isOrphaned = !record.quiz_exists;
                const rowClass = isOrphaned ? 'orphaned-quiz' : '';
                
                // Determine status
                let status, statusClass;
                if (isOrphaned) {
                    status = 'DELETED';
                    statusClass = 'status-removed';
                } else if (record.answered_at) {
                    status = 'Answered';
                    statusClass = 'status-answered';
                } else if (record.first_viewed_at) {
                    status = 'Viewing';
                    statusClass = 'status-viewing';
                } else {
                    status = 'Pending';
                    statusClass = 'status-pending';
                }

                // Format dates
                const formatDate = (dateStr) => {
                    if (!dateStr) return '-';
                    const date = new Date(dateStr);
                    return date.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                };

                const quizTitle = isOrphaned ? 
                    `<span style="color: #721c24; text-decoration: line-through;">Quiz #${record.quiz_id} (Deleted)</span>` :
                    (record.title || `Quiz #${record.quiz_id}`);

                return `
                    <tr class="${rowClass}">
                        <td>${quizTitle}</td>
                        <td><span class="status-badge ${statusClass}">${status}</span></td>
                        <td>${formatDate(record.added_at)}</td>
                        <td>${formatDate(record.first_viewed_at)}</td>
                        <td>${formatDate(record.answered_at)}</td>
                        <td><small>${record.push_id.substring(0, 8)}...</small></td>
                    </tr>
                `;
            }).join('');

            const tableHtml = `
                <table class="debug-history-table">
                    <thead>
                        <tr>
                            <th>Quiz Title</th>
                            <th>Status</th>
                            <th>Added At</th>
                            <th>First Viewed</th>
                            <th>Answered At</th>
                            <th>Push ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            `;

            container.innerHTML = statsHtml + tableHtml;
        }

        // Cleanup orphaned quizzes
        async function cleanupOrphanedQuizzes() {
            const cleanupAll = confirm('Choose cleanup option:\n\nOK = Remove ALL quiz history\nCancel = Remove only orphaned records (deleted quizzes)');
            
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/cleanup-orphaned-quizzes', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ all: cleanupAll })
                });

                if (!response.ok) {
                    throw new Error('Failed to cleanup orphaned quizzes');
                }

                const data = await response.json();
                const cleanupType = cleanupAll ? 'ALL history' : 'orphaned records';
                showNotification(`Cleanup completed: ${data.removed} ${cleanupType} removed`, 'success');

                if (data.queue) {
                    queueSnapshot = {
                        currentQuiz: data.queue.currentQuiz || null,
                        pending: Array.isArray(data.queue.pending) ? data.queue.pending : [],
                        total: typeof data.queue.total === 'number' ? data.queue.total : ((data.queue.currentQuiz ? 1 : 0) + (Array.isArray(data.queue.pending) ? data.queue.pending.length : 0))
                    };
                    if (queueSnapshot.total === 0) {
                        hasRunAutoCleanup = false;
                    }
                    updateDebugQueue();
                    if (queueSnapshot.total === 0 && isQuizOverlayVisible()) {
                        scheduleQuizClose(3000);
                    }
                }
                
                // Refresh the display
                refreshDebugHistory();
            } catch (error) {
                console.error('Error cleaning up orphaned quizzes:', error);
                showNotification('Failed to cleanup orphaned quizzes', 'error');
            }
        }

        // Initialize configuration on page load
        fetchAppConfig();
