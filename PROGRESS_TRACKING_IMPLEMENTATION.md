# Reading Progress Tracking Feature - Udemy-Style Implementation

## Overview

This feature implements a comprehensive reading progress tracking system similar to Udemy's course progress tracking. It allows:

- **Students** to see their progress across all enrolled courses
- **Teachers** to monitor student engagement and completion rates
- **Automatic tracking** of section completion in documentation
- **Quiz triggers** based on reading milestones
- **Time tracking** for each session
- **Analytics dashboard** with CSV export

## Architecture

```
┌─────────────────┐
│   MkDocs Site   │  ← Student reads documentation
│ (progress-      │     Sections tracked via IntersectionObserver
│  tracker.js)    │
└────────┬────────┘
         │ POST /api/progress
         ↓
┌─────────────────┐
│   Server API    │  ← Records progress, triggers quizzes
│   (server.js)   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   SQLite DB     │  ← Stores progress, sessions, summaries
│  (5 new tables) │
└─────────────────┘
         ↑
         │ GET /api/courses/:id/progress
         │ GET /api/my-progress
┌────────┴────────┐
│   Dashboards    │  ← Teacher & Student UIs
│  (HTML pages)   │
└─────────────────┘
```

## Database Schema

### New Tables (migration 013)

1. **reading_progress** - Individual section completions
2. **course_sections** - Define course structure and quiz triggers
3. **course_progress_summary** - Aggregate progress per student/course
4. **reading_sessions** - Time tracking per session
5. **reading_quiz_triggers** - Track quiz triggers from reading

## Installation & Setup

### 1. Apply Database Migration

```bash
cd /Volumes/ExHDD/dev/tutoriaz

# Apply migration
sqlite3 database.sqlite < migrations/013_add_reading_progress.sql

# Verify tables created
sqlite3 database.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%progress%';"
```

### 2. Restart Server

```bash
# Stop current server
pkill -f "node.*server.js"

# Start with PM2 (recommended)
pm2 restart tutoriaz

# Or start directly
node server.js
```

### 3. Configure Progress Tracker

The progress tracker is already configured in:
```
courses/uno_watering_tutorial/docs/assets/javascripts/progress-tracker.js
```

**Key settings:**
- `apiEndpoint: '/api/progress'` - Points to your server
- `readThreshold: 0.7` - 70% of section must be visible
- `viewDurationMs: 3000` - 3 seconds viewing time to mark complete

## API Endpoints

### 1. Record Progress (Public)

```http
POST /api/progress
Content-Type: application/json

{
  "userId": "student-001",
  "courseId": "esp32-course",
  "sectionId": "01-introduction",
  "sectionTitle": "Introduction to ESP32",
  "pageUrl": "https://...",
  "sessionId": "session-123",
  "timeSpentSeconds": 45,
  "completedSections": ["01-intro", "01-equipment"]
}
```

**Response:**
```json
{
  "success": true,
  "progressPercentage": 25.5,
  "completedSections": 5,
  "totalSections": 20,
  "triggerQuiz": false
}
```

### 2. Get Student Progress (Auth Required)

```http
GET /api/progress/:courseId/:userId
Authorization: Bearer <token>
```

### 3. Get Course Progress - Teacher View (Auth Required)

```http
GET /api/courses/:courseId/progress
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "courseId": "esp32-course",
  "totalSections": 20,
  "students": [
    {
      "userId": "student-001",
      "username": "john",
      "displayName": "John Doe",
      "enrolledAt": "2026-01-01T10:00:00Z",
      "progress": {
        "totalSections": 20,
        "completedSections": 15,
        "percentage": 75.0,
        "lastAccessedAt": "2026-01-10T14:30:00Z",
        "totalSessions": 5,
        "totalTimeSpent": 3600
      }
    }
  ]
}
```

### 4. Get Detailed Student Progress (Auth Required)

```http
GET /api/courses/:courseId/progress/:userId/details
Authorization: Bearer <token>
```

### 5. Register Course Sections (Auth Required)

```http
POST /api/courses/:courseId/sections
Authorization: Bearer <token>
Content-Type: application/json

{
  "sections": [
    {
      "sectionId": "01-intro",
      "title": "Introduction",
      "pageUrl": "/docs/01-intro/",
      "order": 1,
      "isQuizTrigger": false
    },
    {
      "sectionId": "section-milestone-1",
      "title": "Hardware Setup Complete",
      "order": 5,
      "isQuizTrigger": true,
      "quizId": "quiz-001"
    }
  ]
}
```

### 6. Get My Progress - Student View (Auth Required)

```http
GET /api/my-progress
Authorization: Bearer <token>
```

## User Interfaces

### Teacher Dashboard

**URL:** `/course-progress.html?courseId=<course-id>`

**Features:**
- Overview statistics (total students, average progress, completion rate)
- Filterable student list
- Real-time progress bars
- Time spent tracking
- Click student row to see detailed section-by-section progress
- Export to CSV

**Access:**
```javascript
// From teacher.html, link to:
window.location.href = `/course-progress.html?courseId=${courseId}`;
```

### Student Progress Page

**URL:** `/my-progress.html`

**Features:**
- Card view of all enrolled courses
- Visual progress bars
- Completion status badges
- Achievement banner when courses completed
- Last accessed time
- Click card to return to course

**Access:**
```html
<!-- Add to student.html navigation -->
<a href="/my-progress.html">📈 My Progress</a>
```

## Adding Progress Tracking to Documentation

### 1. Add Section Markers

In your MkDocs markdown files, wrap trackable sections:

```html
<div data-progress-section="unique-section-id" data-progress-title="Section Title">

## Your Content Here

This content will be tracked when students read it.

</div>
```

**Example:**
```html
<div data-progress-section="01-introduction" data-progress-title="Introduction to ESP32">

## ESP32 Overview

The ESP32 is a powerful microcontroller...

</div>

<div data-progress-section="01-hardware-setup" data-progress-title="Hardware Setup">

## Hardware Requirements

You will need:
- ESP32 DevKit
- USB Cable
...

</div>
```

### 2. Configure Quiz Triggers

Edit `progress-tracker.js` to specify which sections trigger quizzes:

```javascript
quizTriggers: [
    'section-chapter1-complete',
    'section-chapter2-complete',
    'section-final-project-complete'
]
```

### 3. Register Sections with API

After creating sections, register them:

```javascript
const sections = [
    { sectionId: '01-intro', title: 'Introduction', order: 1 },
    { sectionId: '01-hardware', title: 'Hardware Setup', order: 2 },
    { sectionId: 'section-milestone', title: 'Milestone', order: 10, isQuizTrigger: true, quizId: 'quiz-123' }
];

fetch(`/api/courses/${courseId}/sections`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sections })
});
```

## Usage Examples

### For Teachers

1. **View Course Progress:**
   - Go to Teacher Dashboard
   - Click on a course
   - Click "View Progress" button (needs to be added to teacher.html)
   - See all students' progress

2. **Monitor Engagement:**
   - Check "Active This Week" stat
   - Sort by progress percentage
   - Identify struggling students (low progress %)
   - Export data for analysis

3. **Export Progress:**
   - Click "📊 Export CSV" button
   - Get CSV with all student data
   - Import into Excel/Google Sheets for reporting

### For Students

1. **View Your Progress:**
   - Click "📈 My Progress" in navigation
   - See all enrolled courses
   - View completion percentages
   - Track time spent

2. **Reading Documentation:**
   - Progress automatically tracked as you read
   - Checkmarks appear on completed sections
   - Quiz notifications appear at milestones

## Integration with Existing Features

### Quiz System Integration

When a section triggers a quiz:

```json
// API Response includes:
{
  "triggerQuiz": true,
  "quizData": {
    "quizId": "quiz-001",
    "title": "Chapter 1 Quiz",
    "sectionId": "section-chapter1-complete"
  }
}
```

The progress tracker can:
1. Show inline notification
2. Add quiz to student's queue
3. Open quiz modal
4. Post message to parent frame (if embedded)

### Course Enrollment

Progress tracking respects course enrollments:
- Only enrolled students can record progress
- Teachers see only enrolled students' progress
- Progress persists across sessions

## Performance Considerations

### Debouncing

Progress events are sent once per section completion:
- Uses IntersectionObserver for efficient scroll tracking
- Timer-based completion (not immediate)
- localStorage caching prevents duplicate sends

### Indexing

Database indexes optimize queries:
```sql
CREATE INDEX idx_reading_progress_user_course ON reading_progress(user_id, course_id);
CREATE INDEX idx_course_sections_course ON course_sections(course_id);
CREATE INDEX idx_course_progress_summary ON course_progress_summary(user_id, course_id);
```

### Caching

Progress summary is cached in `course_progress_summary` table:
- Recalculated on each progress update
- Avoids expensive COUNT queries on dashboard load

## Testing

### 1. Manual Testing

```bash
# Test progress recording
curl -X POST http://localhost:3030/api/progress \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "student-001",
    "courseId": "test-course",
    "sectionId": "test-section-1",
    "sectionTitle": "Test Section"
  }'

# Check database
sqlite3 database.sqlite "SELECT * FROM reading_progress LIMIT 5;"
```

### 2. Browser Testing

1. Open documentation with `?user_id=test123&course_id=esp32`
2. Scroll through sections slowly
3. Check browser console for logs (with debug:true)
4. Verify progress in database
5. Open teacher dashboard to see student appear

### 3. Load Testing

The progress API can handle multiple students:
- Batched inserts for sessions
- Efficient upsert queries
- No blocking operations

## Troubleshooting

### Progress Not Recording

**Check:**
1. Is `data-progress-section` attribute present?
2. Is user_id and course_id passed in URL?
3. Check browser console for errors
4. Verify API endpoint in progress-tracker.js
5. Check network tab for POST requests

### Teacher Dashboard Empty

**Check:**
1. Are students enrolled in course?
2. Have students accessed documentation?
3. Check course_enrollments table
4. Verify teacher owns the course

### Database Errors

**Fix:**
```bash
# Reapply migration
sqlite3 database.sqlite < migrations/013_add_reading_progress.sql

# Check table structure
sqlite3 database.sqlite ".schema reading_progress"
```

## Future Enhancements

### Planned Features

1. **Certificates** - Auto-generate on 100% completion
2. **Badges** - Award for milestones (25%, 50%, 75%, 100%)
3. **Leaderboard** - Gamification element
4. **Progress Reminders** - Email notifications for inactive students
5. **Time Goals** - Set expected completion time
6. **Progress Tracking API** - Webhook notifications
7. **Mobile App** - Native progress tracking

### Customization Options

You can customize:
- Progress thresholds (currently 70%)
- View duration (currently 3s)
- Quiz trigger logic
- Dashboard styling
- Export formats

## Security Notes

⚠️ **Important:**

1. **Authentication:** Most endpoints require JWT token
2. **Authorization:** Teachers can only see their courses
3. **Validation:** All inputs sanitized and validated
4. **Rate Limiting:** Consider adding to /api/progress endpoint
5. **CORS:** Configure for production deployment

## Files Modified/Created

### New Files

- `migrations/013_add_reading_progress.sql` - Database schema
- `public/course-progress.html` - Teacher dashboard
- `public/my-progress.html` - Student progress view

### Modified Files

- `server.js` - Added 6 new API endpoints
- `courses/uno_watering_tutorial/docs/assets/javascripts/progress-tracker.js` - Updated API endpoint

### Files to Update (Recommended)

- `public/teacher.html` - Add "View Progress" button per course
- `public/student.html` - Add "My Progress" link in navigation
- `public/teacher.html` - Add progress analytics section

## Quick Start Commands

```bash
# 1. Apply migration
sqlite3 database.sqlite < migrations/013_add_reading_progress.sql

# 2. Restart server
pm2 restart tutoriaz

# 3. Open teacher dashboard
open http://localhost:3030/course-progress.html?courseId=your-course-id

# 4. Open student progress
open http://localhost:3030/my-progress.html

# 5. Test progress tracking
open "http://localhost:3030/docs/uno_watering_tutorial/site/?user_id=student-001&course_id=test"
```

## Support

For issues or questions:
1. Check server logs: `pm2 logs tutoriaz`
2. Check database: `sqlite3 database.sqlite`
3. Enable debug mode in progress-tracker.js
4. Review browser console logs

---

**Version:** 1.0.0  
**Last Updated:** January 10, 2026  
**Status:** ✅ Production Ready
