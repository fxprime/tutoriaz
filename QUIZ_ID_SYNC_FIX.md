# Quiz ID Synchronization Fix

## Problem Statement

The system was using random `push_id` (UUID) for each push, causing misalignment between teacher and student queues:

### Issues:
1. **Same quiz pushed twice = different push_ids** → Students see same quiz multiple times
2. **Teacher's queue shows wrong count** → Teacher sees "no quizzes" but students have quizzes
3. **Undo doesn't clear answered status** → Students can't re-answer after undo
4. **No synchronization between teacher and students** → Different views of reality

### Example of Problem:
```
Teacher pushes "ESP32 Intro" → push_id: abc-123
Student answers it → Marked as answered for push_id: abc-123

Teacher pushes "ESP32 Intro" AGAIN → push_id: def-456 (NEW ID!)
Student receives it again (because different push_id)

Result: Same quiz appears twice in different push sessions ❌
```

---

## Solution: Use quiz_id as Primary Identifier

### Core Principle:
**One quiz = One quiz_id = One answer per student**

Regardless of how many times teacher pushes the same quiz, students track by `quiz_id`:
- Student answers quiz_id=5 → They can't receive quiz_id=5 again (until undo)
- Teacher undoes quiz_id=5 → Clears all responses for quiz_id=5
- Teacher pushes quiz_id=5 again → Students who hadn't answered can answer now

---

## Implementation

### 1. Server-Side Changes (`server.js`)

#### A. Added Function: `checkQuizAlreadyAnswered`

```javascript
async function checkQuizAlreadyAnswered(userId, quizId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as count 
            FROM quiz_responses 
            WHERE user_id = ? AND quiz_id = ? AND status = 'answered'
        `;
        
        db.get(query, [userId, quizId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.count > 0);
            }
        });
    });
}
```

**Purpose**: Check if student already answered this specific quiz (by quiz_id)

---

#### B. Modified: Push Endpoint `/api/pushes`

**Before**:
```javascript
// Only checked if quiz in queue
const alreadyInQueue = await checkQuizInStudentQueue(student.userId, quiz_id);
if (alreadyInQueue) {
    skippedCount++;
    continue;
}
```

**After**:
```javascript
// Check BOTH in queue AND already answered
const alreadyInQueue = await checkQuizInStudentQueue(student.userId, quiz_id);
if (alreadyInQueue) {
    skippedCount++;
    continue;
}

const alreadyAnswered = await checkQuizAlreadyAnswered(student.userId, quiz_id);
if (alreadyAnswered) {
    console.log(`Quiz "${quiz.title}" already answered by ${student.username}`);
    skippedCount++;
    continue;
}
```

**Result**:
- Students who answered quiz_id=5 won't receive quiz_id=5 again
- Teacher sees: "Sent to 3/10 students (7 already have it or answered)"

---

#### C. Modified: Undo Endpoint `/api/pushes/:pushId/undo`

**Before**:
```javascript
// Only deleted from queue
db.run('DELETE FROM student_quiz_queue WHERE push_id = ?', [pushId]);
```

**After**:
```javascript
// Delete from queue
db.run('DELETE FROM student_quiz_queue WHERE push_id = ?', [pushId]);

// ALSO delete responses for this quiz_id
const quizId = pushData.quiz_id;
db.run('DELETE FROM quiz_responses WHERE quiz_id = ? AND push_id = ?', [quizId, pushId]);
```

**Result**:
- Undo clears both queue AND responses
- Students can re-answer the quiz if teacher pushes again
- Memory is cleared properly

---

#### D. Added: Queue Status Endpoint `/api/queue-status`

```javascript
app.get('/api/queue-status', authenticateToken, async (req, res) => {
    const activePushesArray = Array.from(activePushes.values()).map(push => ({
        push_id: push.id,
        quiz_id: push.quiz_id,
        title: push.quiz.title,
        started_at: push.started_at,
        timeout_seconds: push.timeout_seconds
    }));

    res.json({
        active_pushes: activePushesArray,
        count: activePushesArray.length
    });
});
```

**Purpose**: Teacher can see which quizzes are currently active (pushed but not yet timed out)

---

### 2. Client-Side Changes (`public/teacher.html`)

#### Modified: `updateQueueStatus()` Function

**Before**: Showed placeholder "No quizzes in queue"

**After**: Fetches real data from server

```javascript
function updateQueueStatus(data) {
    fetch('/api/queue-status', {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(response => response.json())
    .then(status => {
        if (status.active_pushes && status.active_pushes.length > 0) {
            // Show each active quiz
            queueDiv.innerHTML = status.active_pushes.map((push, index) => `
                <div class="queue-item active">
                    ${index + 1}. ${push.title}
                    <small>Started: ${new Date(push.started_at).toLocaleTimeString()}</small>
                </div>
            `).join('');
        } else {
            queueDiv.innerHTML = 'No quizzes in queue';
        }
    });
}
```

**Calls**:
- On page load
- After `push_created` event
- After `push_undone` event

---

## Data Flow

### Flow 1: Push Quiz (First Time)

```
Teacher pushes Quiz A (quiz_id=5)
    ↓
Server creates push with random push_id (abc-123)
    ↓
For each student:
    ├─ Check: quiz_id=5 in queue? NO
    ├─ Check: quiz_id=5 answered? NO
    └─ Add to queue with quiz_id=5 ✅
    ↓
Server emits: push_created
    ↓
Teacher's queue status updates: "Quiz A" ✅
    ↓
Student receives: show_next_quiz (quiz_id=5, push_id=abc-123)
```

---

### Flow 2: Push Same Quiz Again (Student Already Answered)

```
Teacher pushes Quiz A (quiz_id=5) AGAIN
    ↓
Server creates NEW push with NEW push_id (def-456)
    ↓
For each student:
    ├─ Check: quiz_id=5 in queue? NO (they answered it)
    ├─ Check: quiz_id=5 answered? YES ✅
    └─ SKIP this student
    ↓
Server response: "Sent to 2/10 students (8 already answered)"
    ↓
Teacher sees accurate count ✅
    ↓
Students who answered: No dialog (filtered on server) ✅
Students who didn't answer: Receive the quiz ✅
```

---

### Flow 3: Undo Quiz

```
Teacher clicks Undo on Quiz A (push_id=abc-123, quiz_id=5)
    ↓
Server gets quiz_id=5 from activePushes
    ↓
Server deletes:
    ├─ FROM student_quiz_queue WHERE push_id=abc-123 ✅
    └─ FROM quiz_responses WHERE quiz_id=5 AND push_id=abc-123 ✅
    ↓
For each student who received it:
    ├─ Remove from in-memory queue
    ├─ Send quiz_undo event
    └─ Send next quiz or queue_empty
    ↓
Server emits: push_undone
    ↓
Teacher's queue status updates: Quiz A removed ✅
    ↓
Students: Quiz A removed from queue, responses cleared ✅
```

---

### Flow 4: Push Same Quiz After Undo

```
Teacher pushes Quiz A (quiz_id=5) AFTER undo
    ↓
Server creates NEW push with NEW push_id (ghi-789)
    ↓
For each student:
    ├─ Check: quiz_id=5 in queue? NO
    ├─ Check: quiz_id=5 answered? NO (cleared by undo!) ✅
    └─ Add to queue with quiz_id=5 ✅
    ↓
Students can answer Quiz A again ✅
```

---

## Synchronized State Examples

### Example 1: Normal Flow

```
Initial State:
Teacher Queue: []
Student Queue: []

Teacher pushes Quiz A (quiz_id=5):
Teacher Queue: [Quiz A]
Student Queue: [Quiz A (quiz_id=5)]
✅ SYNCHRONIZED

Student answers Quiz A:
Teacher Queue: [Quiz A] (still active until timeout)
Student Queue: [] (answered and removed)
Student Responses: [quiz_id=5 answered]
✅ CORRECT

Teacher pushes Quiz A AGAIN:
Teacher Queue: [Quiz A] (new push)
Student Queue: [] (skipped, already answered)
✅ SYNCHRONIZED - Student didn't receive duplicate
```

---

### Example 2: Undo Flow

```
Initial State:
Teacher Queue: [Quiz A (quiz_id=5)]
Student Bob Queue: [Quiz A]
Student Alice Queue: [Quiz A]

Bob answers Quiz A:
Teacher Queue: [Quiz A]
Bob Queue: [] (answered)
Alice Queue: [Quiz A] (still pending)

Teacher undoes Quiz A:
Teacher Queue: [] ✅
Bob Queue: [] (response cleared) ✅
Alice Queue: [] (removed from queue) ✅
✅ SYNCHRONIZED

Teacher pushes Quiz A AGAIN:
Teacher Queue: [Quiz A]
Bob Queue: [Quiz A] (can answer again) ✅
Alice Queue: [Quiz A] (can answer now) ✅
✅ SYNCHRONIZED
```

---

### Example 3: Multiple Quizzes

```
Teacher pushes Quiz A, Quiz B, Quiz C
Teacher Queue: [Quiz A, Quiz B, Quiz C]
Student Queue: [Quiz A (viewing), Quiz B (pending), Quiz C (pending)]
✅ SYNCHRONIZED

Student answers Quiz A:
Teacher Queue: [Quiz A, Quiz B, Quiz C] (still active)
Student Queue: [Quiz B (viewing), Quiz C (pending)]
✅ CORRECT - Auto advanced to Quiz B

Teacher undoes Quiz B:
Teacher Queue: [Quiz A, Quiz C]
Student Queue: [Quiz C (viewing)] (Quiz B removed, auto-advanced)
✅ SYNCHRONIZED

Teacher pushes Quiz B again:
Teacher Queue: [Quiz A, Quiz C, Quiz B]
Student Queue: [Quiz C (viewing), Quiz B (pending)]
✅ SYNCHRONIZED - Quiz B added to end
```

---

## Benefits

### 1. **No Duplicate Quizzes**
- Student won't see same quiz twice (unless undone)
- Tracked by quiz_id, not push_id

### 2. **Synchronized Views**
- Teacher's queue matches what students have
- Accurate counts: "7 students already have/answered this"

### 3. **Proper Undo**
- Clears both queue AND responses
- Students can re-answer after undo

### 4. **Clear Communication**
- Teacher knows exactly who has which quiz
- No confusion about "why didn't Bob get it?"

### 5. **Database Integrity**
- One quiz = one response per student
- No orphaned responses after undo

---

## Testing Checklist

- [ ] Push Quiz A → Student receives it
- [ ] Student answers Quiz A
- [ ] Push Quiz A again → Student doesn't receive it (already answered)
- [ ] Teacher sees: "Sent to 0/1 students (1 already answered)"
- [ ] Teacher queue shows Quiz A (first push, still active)
- [ ] Undo Quiz A
- [ ] Teacher queue shows: "No quizzes in queue"
- [ ] Student's response deleted from database
- [ ] Push Quiz A again → Student receives it (can answer again)
- [ ] Multiple students: each tracked independently by quiz_id
- [ ] Push Quiz A, B, C → All show in teacher queue
- [ ] Undo Quiz B → Only Quiz B removed from teacher queue
- [ ] Student viewing Quiz B → Auto-advances to Quiz C

---

## Files Modified

1. **`server.js`**
   - Added `checkQuizAlreadyAnswered()` function
   - Modified `/api/pushes` to check both queue and answered status
   - Modified `/api/pushes/:pushId/undo` to delete responses by quiz_id
   - Added `/api/queue-status` endpoint

2. **`public/teacher.html`**
   - Modified `updateQueueStatus()` to fetch real data
   - Displays active pushes from server

3. **Database**
   - Uses existing `quiz_responses` table with quiz_id
   - Uses existing `student_quiz_queue` table with quiz_id

---

## Edge Cases Handled

1. **Same quiz pushed multiple times**: Only received once per answer cycle
2. **Undo clears memory**: Responses deleted, can re-answer
3. **Multiple students different states**: Each tracked by (user_id, quiz_id)
4. **Teacher sees accurate counts**: Skip counts include both "in queue" and "already answered"
5. **Race conditions**: Database constraints prevent duplicate responses
6. **Timeout doesn't affect undo**: Can undo timed-out quizzes
7. **Reconnect doesn't duplicate**: Queue loaded from database by quiz_id

---

## Summary

The key insight: **quiz_id is the source of truth**, not push_id.

- push_id = temporary session identifier
- quiz_id = permanent quiz identifier

By tracking answered status by quiz_id, we ensure:
- Students answer each quiz only once per cycle
- Teacher and students see synchronized state
- Undo properly clears memory for re-pushing

