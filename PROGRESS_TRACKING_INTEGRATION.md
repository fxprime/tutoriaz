# 🔗 Integration Guide - Adding Progress Tracking to Existing UI

## Quick Integration Steps

### 1. Add Progress Button to Teacher Dashboard

**File:** `public/teacher.html`

Find the course list rendering section and add a "View Progress" button:

```html
<!-- Example: In the course card/row -->
<div class="course-item">
    <h3>${course.title}</h3>
    <div class="course-actions">
        <button onclick="openCourse('${course.id}')">Open</button>
        <button onclick="viewQuizzes('${course.id}')">Quizzes</button>
        
        <!-- ADD THIS -->
        <button class="btn-progress" onclick="viewProgress('${course.id}')">
            📊 View Progress
        </button>
    </div>
</div>

<!-- Add this JavaScript function -->
<script>
function viewProgress(courseId) {
    window.location.href = `/course-progress.html?courseId=${courseId}`;
}
</script>

<!-- Add this CSS -->
<style>
.btn-progress {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: transform 0.2s;
}

.btn-progress:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}
</style>
```

### 2. Add Progress Link to Student Dashboard

**File:** `public/student.html`

Add navigation link:

```html
<!-- In the navigation menu -->
<nav class="student-nav">
    <a href="/student.html" class="nav-link">
        🏠 Dashboard
    </a>
    <a href="/quiz-monitor.html" class="nav-link">
        📝 Quizzes
    </a>
    
    <!-- ADD THIS -->
    <a href="/my-progress.html" class="nav-link">
        📈 My Progress
    </a>
    
    <a href="#" onclick="logout()" class="nav-link">
        🚪 Logout
    </a>
</nav>

<!-- Add CSS styling -->
<style>
.nav-link {
    display: inline-block;
    padding: 10px 20px;
    margin: 0 5px;
    background: white;
    color: #667eea;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    transition: all 0.3s;
}

.nav-link:hover {
    background: #667eea;
    color: white;
    transform: translateY(-2px);
}
</style>
```

### 3. Add Progress Widget to Course View

**Optional:** Show progress inline when viewing course documentation

```html
<!-- Add this to the course/docs iframe page -->
<div class="progress-widget">
    <div class="progress-header">
        <span>📚 Your Progress</span>
        <span id="progress-percentage">0%</span>
    </div>
    <div class="progress-bar-container">
        <div class="progress-bar" id="progress-bar"></div>
    </div>
    <div class="progress-details">
        <span id="sections-completed">0</span> / 
        <span id="sections-total">0</span> sections completed
    </div>
</div>

<script>
async function loadProgressWidget() {
    const token = localStorage.getItem('token');
    const courseId = getCurrentCourseId(); // Your function to get current course
    const userId = getCurrentUserId(); // Your function to get user ID
    
    try {
        const response = await fetch(`/api/progress/${courseId}/${userId}`);
        const data = await response.json();
        
        if (data.success) {
            const percentage = data.summary.progress_percentage || 0;
            document.getElementById('progress-percentage').textContent = 
                Math.round(percentage) + '%';
            document.getElementById('progress-bar').style.width = percentage + '%';
            document.getElementById('sections-completed').textContent = 
                data.summary.completed_sections;
            document.getElementById('sections-total').textContent = 
                data.summary.total_sections;
        }
    } catch (error) {
        console.error('Failed to load progress:', error);
    }
}

// Load widget when page loads
document.addEventListener('DOMContentLoaded', loadProgressWidget);

// Refresh every 30 seconds
setInterval(loadProgressWidget, 30000);
</script>

<style>
.progress-widget {
    background: white;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.progress-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    font-weight: 600;
}

.progress-bar-container {
    width: 100%;
    height: 8px;
    background: #f0f0f0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    transition: width 0.5s ease;
}

.progress-details {
    font-size: 14px;
    color: #666;
}
</style>
```

## Complete Example: Enhanced Teacher.html

Here's a complete example of integrating progress tracking:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Teacher Dashboard</title>
    <!-- Your existing styles -->
</head>
<body>
    <div class="teacher-dashboard">
        <h1>Teacher Dashboard</h1>
        
        <!-- Course List -->
        <div id="courses-container"></div>
    </div>

    <script>
    async function loadCourses() {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/courses', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const courses = await response.json();
        
        const container = document.getElementById('courses-container');
        container.innerHTML = courses.map(course => `
            <div class="course-card">
                <h3>${course.title}</h3>
                <p>${course.description || ''}</p>
                
                <div class="course-actions">
                    <button onclick="openCourse('${course.id}')">
                        📖 Open
                    </button>
                    <button onclick="manageQuizzes('${course.id}')">
                        📝 Quizzes
                    </button>
                    <button class="btn-progress" onclick="viewProgress('${course.id}')">
                        📊 View Progress
                    </button>
                    <button onclick="viewStudents('${course.id}')">
                        👥 Students
                    </button>
                </div>
                
                <!-- Quick Progress Summary -->
                <div class="quick-progress" id="progress-${course.id}">
                    <small>Loading progress...</small>
                </div>
            </div>
        `).join('');
        
        // Load quick progress summaries
        courses.forEach(course => loadQuickProgress(course.id));
    }
    
    async function loadQuickProgress(courseId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/courses/${courseId}/progress`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (data.success && data.students.length > 0) {
                const avgProgress = data.students.reduce((sum, s) => 
                    sum + s.progress.percentage, 0) / data.students.length;
                
                const completed = data.students.filter(s => 
                    s.progress.percentage >= 100).length;
                
                document.getElementById(`progress-${courseId}`).innerHTML = `
                    <small>
                        ${data.students.length} students • 
                        Avg: ${Math.round(avgProgress)}% • 
                        ${completed} completed
                    </small>
                `;
            } else {
                document.getElementById(`progress-${courseId}`).innerHTML = `
                    <small>No progress data yet</small>
                `;
            }
        } catch (error) {
            console.error('Failed to load quick progress:', error);
        }
    }
    
    function viewProgress(courseId) {
        window.location.href = `/course-progress.html?courseId=${courseId}`;
    }
    
    // Load courses on page load
    document.addEventListener('DOMContentLoaded', loadCourses);
    </script>
</body>
</html>
```

## Complete Example: Enhanced Student.html

```html
<!DOCTYPE html>
<html>
<head>
    <title>Student Dashboard</title>
    <!-- Your existing styles -->
</head>
<body>
    <nav class="student-nav">
        <a href="/student.html" class="nav-link active">
            🏠 Dashboard
        </a>
        <a href="/my-progress.html" class="nav-link">
            📈 My Progress
        </a>
        <a href="#" onclick="logout()" class="nav-link">
            🚪 Logout
        </a>
    </nav>
    
    <div class="student-dashboard">
        <h1>My Courses</h1>
        
        <!-- Progress Summary Widget -->
        <div class="progress-summary-widget">
            <h3>📊 Overall Progress</h3>
            <div id="overall-progress">
                <div class="stat">
                    <div class="stat-label">Enrolled Courses</div>
                    <div class="stat-value" id="enrolled-count">0</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Completed</div>
                    <div class="stat-value" id="completed-count">0</div>
                </div>
                <div class="stat">
                    <div class="stat-label">In Progress</div>
                    <div class="stat-value" id="progress-count">0</div>
                </div>
            </div>
            <button class="btn-view-details" onclick="viewMyProgress()">
                View Detailed Progress →
            </button>
        </div>
        
        <!-- Course List -->
        <div id="courses-container"></div>
    </div>

    <script>
    async function loadOverallProgress() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/my-progress', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (data.success) {
                const enrolled = data.courses.length;
                const completed = data.courses.filter(c => 
                    c.progress.percentage >= 100).length;
                const inProgress = data.courses.filter(c => 
                    c.progress.percentage > 0 && c.progress.percentage < 100).length;
                
                document.getElementById('enrolled-count').textContent = enrolled;
                document.getElementById('completed-count').textContent = completed;
                document.getElementById('progress-count').textContent = inProgress;
            }
        } catch (error) {
            console.error('Failed to load progress:', error);
        }
    }
    
    function viewMyProgress() {
        window.location.href = '/my-progress.html';
    }
    
    // Load on page load
    document.addEventListener('DOMContentLoaded', () => {
        loadOverallProgress();
        // Your existing course loading code...
    });
    </script>
    
    <style>
    .progress-summary-widget {
        background: white;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    #overall-progress {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin: 20px 0;
    }
    
    .stat {
        text-align: center;
        padding: 16px;
        background: #f9f9f9;
        border-radius: 8px;
    }
    
    .stat-label {
        font-size: 14px;
        color: #666;
        margin-bottom: 8px;
    }
    
    .stat-value {
        font-size: 32px;
        font-weight: bold;
        color: #667eea;
    }
    
    .btn-view-details {
        width: 100%;
        padding: 12px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s;
    }
    
    .btn-view-details:hover {
        transform: translateY(-2px);
    }
    </style>
</body>
</html>
```

## Testing Integration

After adding the UI elements, test:

1. **Teacher View:**
   ```
   - Login as teacher
   - See "View Progress" button on each course
   - Click button → Should open progress dashboard
   - See quick progress summary under each course
   ```

2. **Student View:**
   ```
   - Login as student
   - See "My Progress" in navigation
   - See progress summary widget on dashboard
   - Click "View Detailed Progress" → Opens progress page
   ```

## Next Steps After Integration

1. ✅ Add UI elements to teacher.html
2. ✅ Add UI elements to student.html
3. ✅ Test with real courses
4. ✅ Register course sections via API
5. ✅ Have students read documentation
6. ✅ Monitor progress in dashboard

## Need Help?

- Full documentation: `PROGRESS_TRACKING_IMPLEMENTATION.md`
- Quick start: `PROGRESS_TRACKING_QUICKSTART.md`
- Summary: `PROGRESS_TRACKING_SUMMARY.md`

---

**Ready to integrate!** Simply copy the code snippets above into your existing HTML files.
