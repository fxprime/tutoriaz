        const urlParams = new URLSearchParams(window.location.search);
        const pushId = urlParams.get('pushId');
        const quizId = urlParams.get('quizId');
        const token = urlParams.get('token');

        let socket;
        let responses = [];
        let isRevealed = false;
        let targetStudentsCount = 0;
        let quizData = null;

        // Connect to socket
        function connectSocket() {
            socket = io();

            socket.on('connect', () => {
                console.log('Connected to server - authenticating...');
                socket.emit('auth', { token });
            });

            socket.on('auth_ok', (data) => {
                console.log('✓ Authenticated as teacher for monitor');
                updateConnectionStatus(true);
                console.log('Monitor watching for pushId:', pushId, 'quizId:', quizId);
                
                // Request initial data after successful auth
                if (pushId) {
                    fetchQuizData();
                    fetchExistingResponses();
                }
            });

            socket.on('auth_error', (data) => {
                console.error('✗ Authentication failed:', data.message);
                updateConnectionStatus(false);
                document.getElementById('quizTitle').textContent = 'Authentication Error';
            });

            socket.on('auth_error', (data) => {
                console.error('✗ Authentication failed:', data.message);
                updateConnectionStatus(false);
                document.getElementById('quizTitle').textContent = 'Authentication Error';
            });

            socket.on('disconnect', () => {
                console.log('Disconnected from server');
                updateConnectionStatus(false);
            });

            socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                updateConnectionStatus(false);
            });

            socket.on('quiz_response', (data) => {
                console.log('=== QUIZ RESPONSE EVENT ===');
                console.log('Received data:', data);
                console.log('Monitor pushId:', pushId);
                console.log('Monitor quizId:', quizId);
                
                // Normalize IDs for comparison
                const dataPushId = data.push_id ? String(data.push_id).trim() : '';
                const dataQuizId = data.quiz_id ? String(data.quiz_id).trim() : '';
                const monitorPushId = pushId ? String(pushId).trim() : '';
                const monitorQuizId = quizId ? String(quizId).trim() : '';
                
                console.log('Normalized - data.push_id:', dataPushId);
                console.log('Normalized - data.quiz_id:', dataQuizId);
                console.log('Normalized - monitor.pushId:', monitorPushId);
                console.log('Normalized - monitor.quizId:', monitorQuizId);
                
                const pushIdMatch = dataPushId && monitorPushId && dataPushId === monitorPushId;
                const quizIdMatch = dataQuizId && monitorQuizId && dataQuizId === monitorQuizId;
                
                console.log('Match pushId?', pushIdMatch);
                console.log('Match quizId?', quizIdMatch);
                
                if (pushIdMatch || quizIdMatch) {
                    console.log('✓ Response matches - handling');
                    handleResponse(data);
                } else {
                    console.log('✗ Response does not match - ignoring');
                }
            });
        }

        async function fetchExistingResponses() {
            try {
                // Fetch responses that may already exist for this push
                const response = await fetch(`/api/pushes/${pushId}/responses`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('Existing responses loaded:', data);
                    if (data.responses && Array.isArray(data.responses)) {
                        data.responses.forEach(resp => {
                            handleResponse({
                                push_id: pushId,
                                quiz_id: resp.quiz_id,
                                user_id: resp.user_id,
                                username: resp.username,
                                display_name: resp.display_name,
                                elapsed_ms: resp.elapsed_ms,
                                answered_at: resp.answered_at,
                                status: resp.status,
                                is_correct: resp.is_correct
                            });
                        });
                    }
                }
            } catch (error) {
                console.error('Error fetching existing responses:', error);
            }
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

        async function fetchQuizData() {
            try {
                const response = await fetch(`/api/pushes/${pushId}/details`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    quizData = data;
                    document.getElementById('quizTitle').textContent = data.quiz_title || 'Quiz Monitor';
                    document.getElementById('quizIdDisplay').textContent = `Push ID: ${pushId.substring(0, 8)}...`;
                    targetStudentsCount = data.target_students_count || 0;
                    updateStats();
                }
            } catch (error) {
                console.error('Error fetching quiz data:', error);
            }
        }

        function handleResponse(data) {
            console.log('handleResponse called with:', data);
            
            // Check if response already exists
            const existingIndex = responses.findIndex(r => r.user_id === data.user_id);
            
            const responseData = {
                user_id: data.user_id,
                display_name: data.display_name || data.username,
                elapsed_ms: data.elapsed_ms,
                status: data.status,
                is_correct: data.is_correct,
                answered_at: data.answered_at || new Date().toISOString(),
                _updated: Date.now() // Add timestamp to force update
            };

            if (existingIndex >= 0) {
                console.log('Updating existing response for:', responseData.display_name);
                responses[existingIndex] = responseData;
            } else {
                console.log('Adding new response for:', responseData.display_name);
                responses.push(responseData);
            }

            console.log('Total responses now:', responses.length);
            renderResponses();
            updateStats();
        }

        function renderResponses() {
            const container = document.getElementById('responsesContainer');
            
            console.log('renderResponses called, total responses:', responses.length);
            
            if (responses.length === 0) {
                container.innerHTML = `
                    <div class="no-responses">
                        Waiting for student responses<span class="waiting-indicator"></span>
                    </div>
                `;
                return;
            }

            // Sort by answered_at (most recent first), then by _updated for tie-breaking
            const sortedResponses = [...responses].sort((a, b) => {
                const timeA = new Date(a.answered_at).getTime();
                const timeB = new Date(b.answered_at).getTime();
                
                if (timeB !== timeA) {
                    return timeB - timeA; // Most recent first
                }
                // If same time, use update timestamp
                return (b._updated || 0) - (a._updated || 0);
            });

            console.log('Sorted responses (newest first):', sortedResponses.map(r => r.display_name));

            container.innerHTML = sortedResponses.map(response => {
                const timeTaken = response.elapsed_ms ? Math.round(response.elapsed_ms / 1000) : 0;
                const correctnessClass = response.is_correct ? 'correct' : 'incorrect';
                const correctnessSymbol = response.is_correct ? '✓' : '✗';
                const revealedClass = isRevealed ? 'revealed' : '';
                const itemClass = isRevealed ? correctnessClass : '';

                return `
                    <div class="response-item ${itemClass}">
                        <div class="response-info">
                            <div class="student-name">${response.display_name}</div>
                            <div class="response-meta">
                                <div class="time-taken">
                                    ⏱️ ${timeTaken}s
                                </div>
                                <div>${new Date(response.answered_at).toLocaleTimeString()}</div>
                            </div>
                        </div>
                        <div class="correctness ${correctnessClass} ${revealedClass}">
                            ${correctnessSymbol}
                        </div>
                    </div>
                `;
            }).join('');
        }

        function updateStats() {
            const correctCount = responses.filter(r => r.is_correct === true).length;
            const incorrectCount = responses.filter(r => r.is_correct === false).length;
            const waitingCount = Math.max(0, targetStudentsCount - responses.length);

            document.getElementById('correctCount').textContent = correctCount;
            document.getElementById('incorrectCount').textContent = incorrectCount;
            document.getElementById('waitingCount').textContent = waitingCount;
        }

        function revealCorrectness() {
            isRevealed = true;
            document.getElementById('revealBtn').style.display = 'none';
            document.getElementById('hideBtn').style.display = 'inline-block';
            renderResponses();
        }

        function hideCorrectness() {
            isRevealed = false;
            document.getElementById('revealBtn').style.display = 'inline-block';
            document.getElementById('hideBtn').style.display = 'none';
            renderResponses();
        }

        function clearResponses() {
            if (confirm('Clear all responses from this monitor?')) {
                responses = [];
                renderResponses();
                updateStats();
            }
        }

        async function showRankings() {
            const modal = document.getElementById('rankingsModal');
            const content = document.getElementById('rankingsContent');
            
            modal.style.display = 'block';
            content.innerHTML = '<div style="text-align: center; padding: 40px; color: #718096;">Loading rankings...</div>';
            
            try {
                const courseId = quizData?.course_id;
                if (!courseId) {
                    content.innerHTML = '<div style="text-align: center; padding: 40px; color: #e53e3e;">⚠️ This quiz is not associated with a course</div>';
                    return;
                }
                
                const response = await fetch(`/api/courses/${courseId}/scores`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (!response.ok) {
                    throw new Error('Failed to fetch rankings');
                }
                
                const data = await response.json();
                const rankings = data.scores || [];
                
                if (rankings.length === 0) {
                    content.innerHTML = '<div style="text-align: center; padding: 40px; color: #718096;">No scores available yet</div>';
                    return;
                }
                
                // Render rankings table
                content.innerHTML = `
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f7fafc; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 12px; text-align: left; font-weight: 600; color: #4a5568;">Rank</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600; color: #4a5568;">Student</th>
                                <th style="padding: 12px; text-align: center; font-weight: 600; color: #4a5568;">Total Score</th>
                                <th style="padding: 12px; text-align: center; font-weight: 600; color: #4a5568;">Answered</th>
                                <th style="padding: 12px; text-align: center; font-weight: 600; color: #4a5568;">Correct</th>
                                <th style="padding: 12px; text-align: center; font-weight: 600; color: #4a5568;">Incorrect</th>
                                <th style="padding: 12px; text-align: center; font-weight: 600; color: #4a5568;">Accuracy</th>
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
                                    <tr style="${rowStyle} border-bottom: 1px solid #e2e8f0;">
                                        <td style="padding: 12px; font-size: 18px; font-weight: bold;">${rankBadge}</td>
                                        <td style="padding: 12px; font-weight: 500; color: #2d3748;">${student.display_name || student.username}</td>
                                        <td style="padding: 12px; text-align: center; font-size: 20px; font-weight: bold; color: #667eea;">${student.total_score}</td>
                                        <td style="padding: 12px; text-align: center; color: #718096;">${student.answered_count}</td>
                                        <td style="padding: 12px; text-align: center; color: #38a169;">${student.correct_count}</td>
                                        <td style="padding: 12px; text-align: center; color: #e53e3e;">${student.incorrect_count}</td>
                                        <td style="padding: 12px; text-align: center; font-weight: 600; color: ${accuracy >= 80 ? '#38a169' : accuracy >= 60 ? '#d69e2e' : '#e53e3e'};">${accuracy}%</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            } catch (error) {
                console.error('Error loading rankings:', error);
                content.innerHTML = '<div style="text-align: center; padding: 40px; color: #e53e3e;">⚠️ Failed to load rankings</div>';
            }
        }

        function closeRankings() {
            document.getElementById('rankingsModal').style.display = 'none';
        }

        // Setup event listeners
        document.getElementById('revealBtn')?.addEventListener('click', revealCorrectness);
        document.getElementById('hideBtn')?.addEventListener('click', hideCorrectness);
        document.getElementById('showRankingsBtn')?.addEventListener('click', showRankings);
        document.getElementById('clearResponsesBtn')?.addEventListener('click', clearResponses);
        document.getElementById('closeRankingsBtn')?.addEventListener('click', closeRankings);

        // Initialize
        if (token && (pushId || quizId)) {
            connectSocket();
        } else {
            document.getElementById('quizTitle').textContent = 'Invalid URL parameters';
            document.querySelector('.no-responses').textContent = 'Missing required parameters (token, pushId)';
        }
