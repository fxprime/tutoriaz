let courseId = null;
let allStudents = [];
let token = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Get course ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    courseId = urlParams.get('courseId');
    
    if (!courseId) {
        alert('No course ID provided');
        window.location.href = '/teacher.html';
        return;
    }

    // Get token from localStorage
    token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    // Load course info and progress
    await loadCourseInfo();
    await loadProgress();

    // Set up filters
    document.getElementById('search-input').addEventListener('input', filterStudents);
    document.getElementById('progress-filter').addEventListener('change', filterStudents);
    
    // Set up button event listeners
    document.getElementById('backBtn').addEventListener('click', goBack);
    document.getElementById('exportBtn').addEventListener('click', exportProgress);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
});

async function loadCourseInfo() {
    try {
        const response = await fetch('/api/courses', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        const courses = data.courses || [];
        const course = courses.find(c => c.id === courseId);
        if (course) {
            document.getElementById('course-title').textContent = course.title;
        }
    } catch (error) {
        console.error('Error loading course info:', error);
    }
}

async function loadProgress() {
    try {
        console.log('Loading progress for course:', courseId);
        console.log('Token exists:', !!token);
        
        const response = await fetch(`/api/courses/${courseId}/progress`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error:', errorData);
            throw new Error(errorData.error || 'Failed to load progress');
        }

        const data = await response.json();
        console.log('Progress data loaded:', data);
        allStudents = data.students || [];
        
        updateStats(allStudents);
        renderTable(allStudents);
        
        // Show helpful tip if no students or no progress data
        if (allStudents.length === 0) {
            showInfoBanner('No students enrolled yet. Students need to enroll in this course first.', 'info');
        } else if (allStudents.every(s => s.progress.completedSections === 0)) {
            showInfoBanner('💡 Students need to access the course through the <strong>Student Portal</strong> for progress tracking. Direct documentation access without login won\'t track progress.', 'tip');
        }
    } catch (error) {
        console.error('Error loading progress:', error);
        document.getElementById('table-container').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>Error loading progress data</p>
                <button class="btn btn-primary retry-progress-btn" style="margin-top: 16px;">
                    🔄 Retry
                </button>
            </div>
        `;
        // Attach event listener to retry button
        const retryBtn = document.querySelector('.retry-progress-btn');
        if (retryBtn) retryBtn.addEventListener('click', loadProgress);
    }
}

function showInfoBanner(message, type = 'info') {
    const colors = {
        info: { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0' },
        tip: { bg: '#fff3e0', border: '#ff9800', text: '#e65100' },
        warning: { bg: '#ffebee', border: '#f44336', text: '#c62828' }
    };
    const style = colors[type] || colors.info;
    
    const banner = document.createElement('div');
    banner.style.cssText = `
        background: ${style.bg};
        border-left: 4px solid ${style.border};
        color: ${style.text};
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
        font-size: 14px;
    `;
    banner.innerHTML = message;
    
    const container = document.querySelector('.progress-table');
    container.insertBefore(banner, container.firstChild);
}

function updateStats(students) {
    const totalStudents = students.length;
    const avgProgress = totalStudents > 0 
        ? students.reduce((sum, s) => sum + s.progress.percentage, 0) / totalStudents 
        : 0;
    const completed = students.filter(s => s.progress.percentage >= 100).length;
    
    // Active this week (accessed in last 7 days)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const active = students.filter(s => {
        if (!s.progress.lastAccessedAt) return false;
        const lastAccess = new Date(s.progress.lastAccessedAt);
        return lastAccess >= oneWeekAgo;
    }).length;

    document.getElementById('total-students').textContent = totalStudents;
    document.getElementById('avg-progress').textContent = Math.round(avgProgress) + '%';
    document.getElementById('completed-students').textContent = completed;
    document.getElementById('active-students').textContent = active;
}

function renderTable(students) {
    if (students.length === 0) {
        document.getElementById('table-container').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <p>No students enrolled yet</p>
            </div>
        `;
        return;
    }

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Student</th>
                    <th>Progress</th>
                    <th>Completed Sections</th>
                    <th>Time Spent</th>
                    <th>Last Accessed</th>
                </tr>
            </thead>
            <tbody>
                ${students.map(student => `
                    <tr class="student-row" data-user-id="${student.userId}">
                        <td>
                            <div class="student-name">${escapeHtml(student.displayName)}</div>
                            <span class="student-username">@${escapeHtml(student.username)}</span>
                        </td>
                        <td>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${student.progress.percentage}%">
                                    ${student.progress.percentage >= 20 ? Math.round(student.progress.percentage) + '%' : ''}
                                </div>
                                ${student.progress.percentage < 20 ? `<div class="progress-text">${Math.round(student.progress.percentage)}%</div>` : ''}
                            </div>
                        </td>
                        <td>
                            ${student.progress.completedSections} / ${student.progress.totalSections}
                        </td>
                        <td>
                            <span class="time-badge">${formatTime(student.progress.totalTimeSpent)}</span>
                        </td>
                        <td class="date-text">
                            ${student.progress.lastAccessedAt ? formatDate(student.progress.lastAccessedAt) : 'Never'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    document.getElementById('table-container').innerHTML = html;
    
    // Add event delegation for student rows
    document.querySelectorAll('.student-row').forEach(row => {
        row.addEventListener('click', () => {
            const userId = row.dataset.userId;
            if (userId) showStudentDetails(userId);
        });
    });
}

function filterStudents() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const progressFilter = document.getElementById('progress-filter').value;

    let filtered = allStudents.filter(student => {
        const matchesSearch = student.displayName.toLowerCase().includes(searchTerm) ||
                            student.username.toLowerCase().includes(searchTerm);
        
        let matchesProgress = true;
        if (progressFilter === 'completed') {
            matchesProgress = student.progress.percentage >= 100;
        } else if (progressFilter === 'in-progress') {
            matchesProgress = student.progress.percentage > 0 && student.progress.percentage < 100;
        } else if (progressFilter === 'not-started') {
            matchesProgress = student.progress.percentage === 0;
        }

        return matchesSearch && matchesProgress;
    });

    renderTable(filtered);
}

async function showStudentDetails(userId) {
    const modal = document.getElementById('student-modal');
    const student = allStudents.find(s => s.userId === userId);
    
    document.getElementById('modal-student-name').textContent = `${student.displayName} (@${student.username})`;
    document.getElementById('modal-content').innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading details...</p>
        </div>
    `;
    
    modal.style.display = 'block';

    try {
        const response = await fetch(`/api/courses/${courseId}/progress/${userId}/details`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load details: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Calculate completion rate and estimated completion
        const completedCount = data.sections.filter(s => s.is_completed).length;
        const totalSections = data.sections.length;
        const completionRate = totalSections > 0 ? (completedCount / totalSections * 100) : 0;
        
        // Group sections by completion status
        const completedSections = data.sections.filter(s => s.is_completed);
        const incompleteSections = data.sections.filter(s => !s.is_completed);
        
        // Calculate total time spent
        const totalTimeSeconds = completedSections.reduce((sum, s) => sum + (s.time_spent_seconds || 0), 0);
        
        // Generate sections HTML with grouping
        const sectionsHtml = `
            ${completedSections.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="color: #4caf50; margin-bottom: 12px;">
                        ✓ Completed (${completedSections.length})
                    </h4>
                    ${completedSections.map(section => `
                        <div class="section-item">
                            <div class="section-status completed">✓</div>
                            <div class="section-info">
                                <div class="section-title">${escapeHtml(section.section_title || section.section_id)}</div>
                                <div class="section-meta">
                                    Completed: ${formatDate(section.completed_at)} • 
                                    Time: ${formatTime(section.time_spent_seconds || 0)}
                                    ${section.page_url ? ` • <a href="${section.page_url}" target="_blank" style="color: #667eea;">View Section</a>` : ''}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${incompleteSections.length > 0 ? `
                <div>
                    <h4 style="color: #ff9800; margin-bottom: 12px;">
                        ⏳ Not Completed Yet (${incompleteSections.length})
                    </h4>
                    ${incompleteSections.map(section => `
                        <div class="section-item">
                            <div class="section-status incomplete"></div>
                            <div class="section-info">
                                <div class="section-title">${escapeHtml(section.section_title || section.section_id)}</div>
                                <div class="section-meta">
                                    Not started
                                    ${section.page_url ? ` • <a href="${section.page_url}" target="_blank" style="color: #667eea;">View Section</a>` : ''}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;

        document.getElementById('modal-content').innerHTML = `
            <!-- Student Overview Stats -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px;">
                <div style="background: #f0f7ff; padding: 16px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Progress</div>
                    <div style="font-size: 24px; font-weight: bold; color: #2196f3;">${Math.round(completionRate)}%</div>
                </div>
                <div style="background: #f1f8e9; padding: 16px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Completed</div>
                    <div style="font-size: 24px; font-weight: bold; color: #4caf50;">${completedCount}/${totalSections}</div>
                </div>
                <div style="background: #fff3e0; padding: 16px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Time Spent</div>
                    <div style="font-size: 24px; font-weight: bold; color: #ff9800;">${formatTime(totalTimeSeconds)}</div>
                </div>
                <div style="background: #fce4ec; padding: 16px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Last Active</div>
                    <div style="font-size: 14px; font-weight: bold; color: #e91e63;">${data.summary.last_accessed_at ? formatDate(data.summary.last_accessed_at) : 'Never'}</div>
                </div>
            </div>

            <!-- Progress Bar -->
            <div style="margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: #333;">Overall Progress</span>
                    <span style="font-weight: 600; color: #667eea;">${Math.round(completionRate)}%</span>
                </div>
                <div class="progress-bar-container" style="height: 32px;">
                    <div class="progress-bar" style="width: ${completionRate}%">
                        ${completionRate >= 20 ? Math.round(completionRate) + '%' : ''}
                    </div>
                </div>
            </div>

            <!-- Recent Activity -->
            ${data.recentSessions && data.recentSessions.length > 0 ? `
                <div style="margin-bottom: 24px; padding: 16px; background: #f9f9f9; border-radius: 8px;">
                    <h4 style="margin-bottom: 12px;">📊 Recent Sessions</h4>
                    <div style="font-size: 14px; color: #666;">
                        ${data.recentSessions.slice(0, 3).map(session => `
                            <div style="margin-bottom: 8px; padding: 8px; background: white; border-radius: 4px;">
                                <strong>${formatDate(session.started_at)}</strong> • 
                                Duration: ${formatTime(session.total_time_seconds || 0)} •
                                ${JSON.parse(session.sections_viewed || '[]').length} sections viewed
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Section Details -->
            <h3 style="margin: 20px 0 12px 0;">📚 Section Details</h3>
            <div class="section-list">
                ${totalSections > 0 ? sectionsHtml : '<p style="color: #999; text-align: center; padding: 20px;">No sections defined yet. Add sections to track progress.</p>'}
            </div>
            
            ${totalSections === 0 ? `
                <div style="margin-top: 20px; padding: 16px; background: #fff3e0; border-radius: 8px; border-left: 4px solid #ff9800;">
                    <strong>💡 Tip:</strong> To track section progress, you need to:
                    <ol style="margin: 8px 0 0 20px; font-size: 14px;">
                        <li>Add <code>data-progress-section</code> attributes to your documentation</li>
                        <li>Register sections using the API: <code>POST /api/courses/${courseId}/sections</code></li>
                    </ol>
                </div>
            ` : ''}
        `;
    } catch (error) {
        console.error('Error loading student details:', error);
        document.getElementById('modal-content').innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <p style="color: #f44336; font-weight: 600; margin-bottom: 8px;">Error Loading Details</p>
                <p style="color: #666; font-size: 14px;">${error.message}</p>
                <button class="btn btn-primary retry-details-btn" data-user-id="${userId}" style="margin-top: 16px;">
                    🔄 Retry
                </button>
            </div>
        `;
        // Attach event listener to retry button
        const retryBtn = document.querySelector('.retry-details-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => showStudentDetails(retryBtn.dataset.userId));
        }
    }
}

function closeModal() {
    document.getElementById('student-modal').style.display = 'none';
}

function goBack() {
    window.location.href = '/teacher.html';
}

function exportProgress() {
    // Create CSV content
    let csv = 'Student,Username,Progress %,Completed Sections,Total Sections,Time Spent (mins),Last Accessed\n';
    
    allStudents.forEach(student => {
        csv += `"${student.displayName}","${student.username}",${student.progress.percentage},${student.progress.completedSections},${student.progress.totalSections},${Math.round(student.progress.totalTimeSpent / 60)},"${student.progress.lastAccessedAt || 'Never'}"\n`;
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progress_${courseId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function formatTime(seconds) {
    if (!seconds || seconds === 0) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('student-modal');
    if (event.target === modal) {
        closeModal();
    }
}
