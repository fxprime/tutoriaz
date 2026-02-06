// Tag Management JavaScript
// Authentication and course setup
const urlParams = new URLSearchParams(window.location.search);
const courseId = urlParams.get('courseId');

let availableQuizzes = [];
let tagsData = {};

const authToken = localStorage.getItem('token'); // Teacher.js stores token as 'token', not 'authToken'

// DEBUG: Log authentication status
console.log('[Tag Management] Course ID:', courseId);
console.log('[Tag Management] Auth Token exists:', !!authToken);
console.log('[Tag Management] Auth Token value:', authToken ? authToken.substring(0, 20) + '...' : 'null');
console.log('[Tag Management] LocalStorage keys:', Object.keys(localStorage));
console.log('[Tag Management] LocalStorage contents:');
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    console.log(`  - ${key}: ${localStorage.getItem(key)?.substring(0, 30)}...`);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    console.log('[Tag Management] DOMContentLoaded fired');

    if (!authToken) {
        console.error('[Tag Management] No auth token found in localStorage');
        document.getElementById('content').innerHTML = '<div class="error">Not authenticated. Please login first.</div>';
    } else if (!courseId) {
        console.error('[Tag Management] No courseId in URL');
        document.getElementById('content').innerHTML = '<div class="error">No course ID specified. Add ?courseId=YOUR_COURSE_ID to the URL.</div>';
    } else {
        console.log('[Tag Management] Initializing with courseId:', courseId);
        loadExisting();
    }

    // Attach button event listeners
    const scanBtn = document.getElementById('scanDocsBtn');
    const loadBtn = document.getElementById('loadSettingsBtn');

    if (scanBtn) {
        scanBtn.addEventListener('click', scanAndLoad);
    }
    if (loadBtn) {
        loadBtn.addEventListener('click', loadExisting);
    }
});

async function scanAndLoad() {
    console.log('[Tag Management] scanAndLoad() called');
    try {
        document.getElementById('content').innerHTML = '<div class="loading">Scanning course documentation...</div>';
        document.getElementById('errorContainer').innerHTML = '';

        console.log('[Tag Management] Making API call to scan tags...');
        console.log('[Tag Management] API URL:', `/api/courses/${courseId}/tags/scan`);

        // Scan docs to get all available tags
        const scanResponse = await fetch(`/api/courses/${courseId}/tags/scan`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        console.log('[Tag Management] Scan response status:', scanResponse.status);
        console.log('[Tag Management] Scan response ok:', scanResponse.ok);

        if (!scanResponse.ok) {
            const errorText = await scanResponse.text();
            console.error('[Tag Management] Scan error response:', errorText);
            throw new Error(`Scan failed: ${scanResponse.status} - ${errorText}`);
        }

        const scanData = await scanResponse.json();
        console.log('[Tag Management] Scan data received:', scanData);
        console.log('[Tag Management] Total tags found:', scanData.totalTags);
        console.log('[Tag Management] Chapters found:', scanData.chapters?.length);

        // Load existing assignments
        const tagsResponse = await fetch(`/api/courses/${courseId}/tags`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!tagsResponse.ok) {
            throw new Error(`Load tags failed: ${tagsResponse.status}`);
        }

        const tagsData = await tagsResponse.json();

        // Load available quizzes
        await loadQuizzes();

        // Merge scan data with existing assignments
        renderTags(scanData.chapters, tagsData.chapters);

    } catch (error) {
        console.error('[Tag Management] Scan error:', error);
        console.error('[Tag Management] Error stack:', error.stack);
        document.getElementById('errorContainer').innerHTML = `<div class="error">Error: ${error.message}<br><small>${error.stack}</small></div>`;
    }
}

async function loadExisting() {
    console.log('[Tag Management] loadExisting() called');
    try {
        document.getElementById('content').innerHTML = '<div class="loading">Loading current settings...</div>';
        document.getElementById('errorContainer').innerHTML = '';

        console.log('[Tag Management] Making API call to load tags...');
        console.log('[Tag Management] Using auth token:', authToken ? 'present' : 'missing');
        // Load existing tag assignments
        const tagsResponse = await fetch(`/api/courses/${courseId}/tags`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!tagsResponse.ok) {
            throw new Error(`Load failed: ${tagsResponse.status}`);
        }

        const tagsData = await tagsResponse.json();

        // Load available quizzes
        await loadQuizzes();

        renderTags(tagsData.chapters, tagsData.chapters);

    } catch (error) {
        console.error('Load error:', error);
        document.getElementById('errorContainer').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

async function loadQuizzes() {
    const quizzesResponse = await fetch(`/api/quizzes?courseId=${courseId}`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    });

    if (!quizzesResponse.ok) {
        throw new Error('Failed to load quizzes');
    }

    const quizzesData = await quizzesResponse.json();
    availableQuizzes = quizzesData.quizzes || [];
}

function renderTags(scannedChapters, existingChapters) {
    if (!scannedChapters || scannedChapters.length === 0) {
        document.getElementById('content').innerHTML = '<div class="empty-state">No tags found. Make sure the course has data-progress-section attributes in the documentation.</div>';
        return;
    }

    // Create a map of existing assignments
    const existingMap = new Map();
    if (existingChapters) {
        existingChapters.forEach(chapter => {
            chapter.tags.forEach(tag => {
                existingMap.set(tag.sectionId, tag);
            });
        });
    }

    let html = '';
    scannedChapters.forEach(chapter => {
        html += `
            <div class="chapter">
                <div class="chapter-header">Chapter ${chapter.chapterId}: ${chapter.chapterName || 'Chapter ' + chapter.chapterId}</div>
                <div class="tag-list">
        `;

        (chapter.tags || []).forEach(tag => {
            const existing = existingMap.get(tag.sectionId);
            const isEnabled = existing && existing.isQuizTrigger;
            const currentQuizId = existing && existing.quizId || '';

            html += `
                <div class="tag-item">
                    <div class="tag-info">
                        <div class="tag-name">${escapeHtml(tag.sectionTitle)}</div>
                        <div class="tag-id">${escapeHtml(tag.sectionId)}</div>
                    </div>
                    <select class="quiz-select" data-section-id="${escapeHtml(tag.sectionId)}">
                        <option value="">No Quiz</option>
                        ${availableQuizzes.map(quiz => `
                            <option value="${quiz.id}" ${quiz.id === currentQuizId ? 'selected' : ''}>
                                ${escapeHtml(quiz.title)}
                            </option>
                        `).join('')}
                    </select>
                    <div class="quiz-status">
                        <span class="status-badge ${isEnabled ? 'status-enabled' : 'status-disabled'}">
                            ${isEnabled ? '✓ Enabled' : 'Disabled'}
                        </span>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    document.getElementById('content').innerHTML = html;

    // Attach event listeners to all select elements
    document.querySelectorAll('.quiz-select').forEach(select => {
        select.addEventListener('change', function () {
            const sectionId = this.getAttribute('data-section-id');
            const quizId = this.value;
            updateQuizAssignment(sectionId, quizId);
        });
    });
}

async function updateQuizAssignment(sectionId, quizId) {
    try {
        const enabled = quizId && quizId !== '';

        const response = await fetch(`/api/courses/${courseId}/tags/${encodeURIComponent(sectionId)}/quiz`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                quizId: enabled ? quizId : null,
                enabled: enabled
            })
        });

        if (!response.ok) {
            throw new Error('Failed to update quiz assignment');
        }

        // Show save indicator
        const indicator = document.getElementById('saveIndicator');
        indicator.classList.add('show');
        setTimeout(() => indicator.classList.remove('show'), 2000);

        // Update status badge
        const tagItem = document.querySelector(`[data-section-id="${sectionId}"]`).closest('.tag-item');
        const badge = tagItem.querySelector('.status-badge');
        if (enabled) {
            badge.className = 'status-badge status-enabled';
            badge.textContent = '✓ Enabled';
        } else {
            badge.className = 'status-badge status-disabled';
            badge.textContent = 'Disabled';
        }

    } catch (error) {
        console.error('Update error:', error);
        alert('Failed to save changes: ' + error.message);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
