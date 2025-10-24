# Sent Status Tracking & Timeout Fix

## Overview
Two critical features implemented to improve teacher visibility and prevent student exploits:

1. **Sent Status Tracking**: Teacher UI shows which quizzes are currently "SENT" (active) with timestamp and individual undo buttons
2. **Timeout Refresh Fix**: Quiz timeout bound to database timestamp (`first_viewed_at`), preventing refresh exploit

---

## Feature 1: Sent Status Tracking in Teacher UI

### Problem
Teachers couldn't see which quizzes were currently active/sent to students. After pushing a quiz:
- No visual indication that quiz is "in flight"
- Had to remember which quizzes were sent
- Unclear which push_id belonged to which quiz for undo
- Couldn't tell when quiz was sent

### Solution
Track active pushes with metadata and display in teacher UI with badges and undo buttons.

### Implementation

#### Frontend Changes (`public/teacher.html`)

**1. Added Global Variable**:
```javascript
let activePushes = new Map(); // quizId -> {push_id, started_at, quiz_id, title}
```

**2. Added CSS Styles**:
```css
.sent-badge {
    background-color: #17a2b8;
    color: white;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
    margin-left: 10px;
}

.undo-sent-btn {
    background-color: #ffc107;
    color: #000;
    padding: 4px 10px;
    cursor: pointer;
}
```

**3. Modified `renderQuizzes()` Function**:
```javascript
const activePush = activePushes.get(quiz.id);
const isSent = !!activePush;
const sentTime = isSent ? new Date(activePush.started_at).toLocaleTimeString() : '';

return `
    <h5>
        ${quiz.title}
        ${isSent ? `<span class="sent-badge">📤 SENT at ${sentTime}</span>` : ''}
    </h5>
    ...
    <button onclick="pushQuiz('${quiz.id}')" ${isSent ? 'disabled' : ''}>
        ${isSent ? 'Pushed' : 'Push'}
    </button>
    ${isSent ? `
        <button class="undo-sent-btn" onclick="undoPushByQuizId('${quiz.id}', '${activePush.push_id}')">
            🔙 Undo
        </button>
    ` : ''}
`;
```

**4. Added `loadActivePushes()` Function**:
```javascript
async function loadActivePushes() {
    const response = await fetch('/api/queue-status', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    
    activePushes.clear();
    data.active_pushes.forEach(push => {
        activePushes.set(push.quiz_id, push);
    });
}
```

**5. Modified `pushQuiz()` Function**:
```javascript
async function pushQuiz(quizId) {
    const response = await fetch('/api/pushes', { ... });
    const data = await response.json();
    
    // Track active push
    activePushes.set(parseInt(quizId), {
        push_id: data.push.id,
        quiz_id: parseInt(quizId),
        started_at: new Date().toISOString(),
        title: quiz.title
    });
    
    renderQuizzes(); // Re-render to show badge
}
```

**6. Added `undoPushByQuizId()` Function**:
```javascript
async function undoPushByQuizId(quizId, pushId) {
    const response = await fetch(`/api/pushes/${pushId}/undo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    // Remove from active pushes
    activePushes.delete(parseInt(quizId));
    renderQuizzes(); // Re-render to remove badge
}
```

**7. Updated Event Handlers**:
```javascript
socket.on('push_created', (data) => {
    loadActivePushes().then(() => renderQuizzes());
});

socket.on('push_undone', (data) => {
    loadActivePushes().then(() => renderQuizzes());
});
```

#### Backend Changes (`server.js`)

**Already implemented** `/api/queue-status` endpoint returns:
```javascript
{
    active_pushes: [
        {
            push_id: "abc-123",
            quiz_id: 5,
            title: "ESP32 Intro",
            started_at: "2025-10-20T10:30:00Z",
            timeout_seconds: 60
        }
    ],
    count: 1
}
```

### UI Behavior

#### Before Push:
```
┌──────────────────────────────┐
│ ESP32 Introduction          │
│ Type: select | Timeout: 60s │
│ [Edit] [Responses] [Delete] │
│ [Push] ← Blue, enabled      │
└──────────────────────────────┘
```

#### After Push:
```
┌──────────────────────────────────────────┐
│ ESP32 Introduction 📤 SENT at 10:30:15 AM │
│ Type: select | Timeout: 60s             │
│ [Edit] [Responses] [Delete]             │
│ [Pushed] ← Grayed out, disabled         │
│ [🔙 Undo] ← Yellow button               │
└──────────────────────────────────────────┘
```

#### After Undo or Timeout:
```
┌──────────────────────────────┐
│ ESP32 Introduction          │
│ Type: select | Timeout: 60s │
│ [Edit] [Responses] [Delete] │
│ [Push] ← Blue again         │
└──────────────────────────────┘
```

### Benefits
1. ✅ Teacher knows exactly which quizzes are active
2. ✅ Can see when each quiz was sent
3. ✅ Easy one-click undo for specific quiz
4. ✅ Can't accidentally push same quiz twice (button disabled)
5. ✅ Visual feedback synchronized with actual server state

---

## Feature 2: Timeout Refresh Fix

### Problem
Students could exploit timeout by refreshing the browser:
1. Student receives quiz with 60s timeout
2. Timer counts down: 50s... 40s... 30s...
3. Student refreshes page
4. Timer resets to 60s (exploit!)
5. Student gets unlimited time

### Root Cause
Timeout was tracked client-side only. Each refresh created new timer starting from full timeout.

### Solution
Bind timeout to **database timestamp** (`first_viewed_at`). Calculate remaining time from first view, not current time.

### Implementation

#### Database Changes

**1. Added Migration** (`migrations/006_add_first_viewed_at.sql`):
```sql
ALTER TABLE student_quiz_queue ADD COLUMN first_viewed_at DATETIME;

UPDATE student_quiz_queue 
SET first_viewed_at = added_at 
WHERE status = 'viewing' AND first_viewed_at IS NULL;
```

**2. Updated Schema** (`schema.sql`):
```sql
CREATE TABLE IF NOT EXISTS student_quiz_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    push_id TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    first_viewed_at DATETIME, -- NEW: When student first viewed this quiz
    position INTEGER,
    status TEXT DEFAULT 'pending',
    ...
);
```

#### Server Changes (`server.js`)

**Added Function**: `markQuizAsViewed(userId, pushId, timeoutSeconds)`
```javascript
async function markQuizAsViewed(userId, pushId, timeoutSeconds) {
    return new Promise((resolve, reject) => {
        // Check if already viewed
        db.get(
            'SELECT first_viewed_at FROM student_quiz_queue WHERE user_id = ? AND push_id = ?',
            [userId, pushId],
            (err, row) => {
                if (row && row.first_viewed_at) {
                    // Already viewed - calculate REMAINING time
                    const viewedAt = new Date(row.first_viewed_at);
                    const now = new Date();
                    const elapsedSeconds = Math.floor((now - viewedAt) / 1000);
                    const remainingSeconds = Math.max(0, timeoutSeconds - elapsedSeconds);
                    resolve(remainingSeconds);
                } else {
                    // First time viewing - set timestamp and return FULL timeout
                    db.run(
                        `UPDATE student_quiz_queue 
                         SET first_viewed_at = CURRENT_TIMESTAMP, status = 'viewing'
                         WHERE user_id = ? AND push_id = ?`,
                        [userId, pushId],
                        (err) => {
                            if (err) reject(err);
                            else resolve(timeoutSeconds); // Full timeout for first view
                        }
                    );
                }
            }
        );
    });
}
```

**Modified All** `show_next_quiz` **Emissions**:

Before:
```javascript
socket.emit('show_next_quiz', {
    push_id: quiz.push_id,
    quiz: quiz.quiz,
    timeout_seconds: quiz.timeout_seconds || 60, // Always full timeout
    ...
});
```

After:
```javascript
const fullTimeout = quiz.timeout_seconds || 60;
const remainingTime = await markQuizAsViewed(userId, quiz.push_id, fullTimeout);

socket.emit('show_next_quiz', {
    push_id: quiz.push_id,
    quiz: quiz.quiz,
    timeout_seconds: remainingTime, // Remaining time from first view
    ...
});
```

**Updated Locations**:
1. `socket.on('auth')` - When student connects/reconnects
2. `socket.on('quiz_answer')` - After answering, show next quiz
3. `socket.on('get_my_queue')` - When student requests current quiz
4. `/api/pushes` POST - When quiz first pushed to student
5. `/api/pushes/:pushId/undo` - When showing next quiz after undo

### Flow Diagrams

#### First View:
```
Student connects
    ↓
Server: SELECT first_viewed_at FROM student_quiz_queue
    ↓
Result: NULL (never viewed)
    ↓
Server: UPDATE student_quiz_queue SET first_viewed_at = NOW(), status = 'viewing'
    ↓
Server: remainingTime = 60 (full timeout)
    ↓
emit('show_next_quiz', { timeout_seconds: 60 })
    ↓
Student: Timer starts at 60s
```

#### Refresh After 30s:
```
Student refreshes at 30s elapsed
    ↓
Server: SELECT first_viewed_at FROM student_quiz_queue
    ↓
Result: 2025-10-20 10:30:00 (30s ago)
    ↓
Server: elapsedSeconds = NOW() - first_viewed_at = 30
Server: remainingTime = 60 - 30 = 30
    ↓
emit('show_next_quiz', { timeout_seconds: 30 })
    ↓
Student: Timer starts at 30s (correct remaining time!)
```

#### Refresh After 70s (Expired):
```
Student refreshes at 70s elapsed (past timeout)
    ↓
Server: SELECT first_viewed_at FROM student_quiz_queue
    ↓
Result: 2025-10-20 10:30:00 (70s ago)
    ↓
Server: elapsedSeconds = NOW() - first_viewed_at = 70
Server: remainingTime = MAX(0, 60 - 70) = 0
    ↓
emit('show_next_quiz', { timeout_seconds: 0 })
    ↓
Student: Timer shows 0s (expired immediately)
```

### Testing Scenarios

#### Test 1: Normal Usage (No Refresh)
```
1. Student receives quiz with 60s timeout
2. Timer counts down normally
3. Student submits at 45s
✅ Expected: Works normally
```

#### Test 2: Refresh Early
```
1. Student receives quiz with 60s timeout
2. Wait 20s
3. Student refreshes browser
✅ Expected: Timer shows 40s remaining (not 60s)
```

#### Test 3: Refresh After Timeout
```
1. Student receives quiz with 60s timeout
2. Wait 65s (let it expire)
3. Student refreshes browser
✅ Expected: Timer shows 0s (expired)
```

#### Test 4: Multiple Refreshes
```
1. Student receives quiz with 60s timeout
2. Wait 10s, refresh → Timer shows 50s ✅
3. Wait 15s more, refresh → Timer shows 35s ✅
4. Wait 20s more, refresh → Timer shows 15s ✅
```

#### Test 5: Answer Then Next Quiz
```
1. Student views Quiz A (first_viewed_at set)
2. Student answers Quiz A
3. Quiz B appears
✅ Expected: Quiz B has NEW first_viewed_at, full 60s timeout
```

### Database State

```sql
-- Before student views quiz
SELECT * FROM student_quiz_queue WHERE user_id = 'student-001';
| push_id | added_at            | first_viewed_at | status  |
|---------|---------------------|-----------------|---------|
| abc-123 | 2025-10-20 10:30:00 | NULL            | pending |

-- After first view
| push_id | added_at            | first_viewed_at     | status  |
|---------|---------------------|---------------------|---------|
| abc-123 | 2025-10-20 10:30:00 | 2025-10-20 10:30:05 | viewing |

-- After refresh at 10:30:35 (30s later)
-- Database unchanged, but server calculates:
-- remainingTime = 60 - (10:30:35 - 10:30:05) = 60 - 30 = 30s
```

---

## Combined Benefits

### For Teachers:
1. ✅ See which quizzes are currently active
2. ✅ Know exactly when each was sent
3. ✅ Easy undo for specific quiz
4. ✅ No confusion about quiz state
5. ✅ Visual synchronization with server

### For System Integrity:
1. ✅ Timeout exploit fixed
2. ✅ Fair assessment timing
3. ✅ Database as source of truth
4. ✅ Consistent behavior across refreshes
5. ✅ Proper time tracking for analytics

### For Students:
1. ✅ Accurate remaining time display
2. ✅ No confusion if accidentally refresh
3. ✅ Fair timeout enforcement
4. ✅ Consistent experience

---

## Files Modified

1. **`public/teacher.html`**
   - Added `activePushes` Map
   - Added CSS for sent badge and undo button
   - Modified `renderQuizzes()` to show badges
   - Added `loadActivePushes()` function
   - Added `undoPushByQuizId()` function
   - Updated event handlers

2. **`server.js`**
   - Added `markQuizAsViewed()` function
   - Updated all `show_next_quiz` emissions (5 locations)
   - Calculate remaining time from database timestamp

3. **`schema.sql`**
   - Added `first_viewed_at` column to `student_quiz_queue`

4. **`migrations/006_add_first_viewed_at.sql`**
   - Migration to add column to existing databases

---

## Testing Checklist

### Sent Status:
- [ ] After push, quiz shows "📤 SENT at [time]"
- [ ] Push button disabled when quiz is sent
- [ ] Undo button appears when quiz is sent
- [ ] Click undo removes sent badge
- [ ] Multiple quizzes can be sent simultaneously
- [ ] Sent status persists across page refresh
- [ ] Sent status syncs across multiple teacher tabs

### Timeout Fix:
- [ ] First view: timer starts at full timeout (60s)
- [ ] Refresh after 30s: timer shows 30s remaining
- [ ] Refresh after 70s: timer shows 0s (expired)
- [ ] Multiple refreshes: timer continues from correct position
- [ ] Answer quiz: next quiz gets new full timeout
- [ ] Disconnect/reconnect: timer resumes correctly
- [ ] Database stores first_viewed_at correctly
- [ ] Remaining time calculation accurate

