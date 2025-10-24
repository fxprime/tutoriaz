# Student-Side Quiz Queue Architecture (Correct Design)

## Problem with Current Implementation
❌ **Current:** Global server queue + client-side check prevents re-showing
- Students see dialog then it gets hidden (bad UX)
- Teacher doesn't know queue status per student
- No visibility into which students have which quizzes pending

## Correct Architecture
✅ **New:** Each student maintains their own queue of unanswered quizzes
- Quiz only shows if it's in student's queue
- Teacher can see per-student queue status
- Remove from queue when answered (never show again)

## Data Structures

### Server Side
```javascript
// Per-student queue: Map<userId, Set<push_id>>
const studentQueues = new Map();

// Example:
studentQueues.set('user123', new Set(['push-abc', 'push-def', 'push-xyz']));
// user123 has 3 unanswered quizzes in their queue

// Track quiz metadata
const quizMetadata = new Map(); // push_id -> { quiz, title, pushed_at }
```

### Client Side (Student)
```javascript
// Student's personal queue (received from server)
let myQueue = []; // Array of { push_id, quiz, ... }
let currentQuizIndex = 0; // Which quiz in queue is showing
```

## Flow Design

### When Teacher Pushes Quiz

```
Teacher clicks "Push Quiz A"
        ↓
Server creates push_id = "abc-123"
        ↓
Server finds ALL students
        ↓
For each student:
  - Check: Is this push already in student's queue? NO
  - Check: Has student answered this push? NO
  - Add to studentQueues[userId]
        ↓
Send to student: quiz_queue_updated { queue: [...] }
        ↓
Student receives queue
        ↓
If student has NO current quiz showing:
  - Show first quiz in queue
Else:
  - Keep current quiz, update queue UI
```

### When Student Answers Quiz

```
Student submits answer for push_id "abc-123"
        ↓
Server saves response to database
        ↓
Server removes "abc-123" from studentQueues[userId]
        ↓
Send to student: quiz_answered { push_id, queue: [...] }
        ↓
Student removes from local queue
        ↓
If queue has more items:
  - Show next quiz in queue
Else:
  - Hide dialog, show "All done!"
```

### When Teacher Pushes Same Quiz Again

```
Teacher clicks "Push Quiz A" again
        ↓
Server creates NEW push_id = "xyz-789"
        ↓
For each student:
  - Check studentQueues[userId]
  - Quiz A already in queue? YES
  - Skip this student (don't add duplicate)
        ↓
Result: Only students who don't have Quiz A get it
```

## Teacher Dashboard - Queue Visibility

### Per-Quiz Status View
```
Quiz: "ESP32 Basics"
├─ Total Pushes: 3
├─ Current Active Push: abc-123
│
├─ Student Status:
│  ├─ Alice: ✓ Answered (abc-123)
│  ├─ Bob: 📋 In Queue (position 2/3)
│  ├─ Charlie: ⏳ Viewing Now
│  └─ David: ✓ Answered (abc-123)
│
└─ Summary: 2/4 answered, 1 viewing, 1 queued
```

### Per-Student Queue View
```
Student: Bob
├─ Queue Length: 3
├─ Current: Quiz B (viewing now)
└─ Pending:
   ├─ 1. Quiz C
   └─ 2. Quiz D
```

## API Changes

### New Endpoints

#### GET /api/teacher/queue-status
Returns overview of all students' queues
```json
{
  "students": [
    {
      "user_id": "user123",
      "username": "alice",
      "queue_length": 2,
      "current_quiz": "Quiz A",
      "pending_quizzes": ["Quiz B", "Quiz C"]
    }
  ],
  "total_queued": 15
}
```

#### GET /api/teacher/quiz/:quizId/status
Returns which students have this quiz
```json
{
  "quiz_id": "quiz-abc",
  "title": "ESP32 Basics",
  "students": [
    {
      "user_id": "user123",
      "username": "alice",
      "status": "answered",
      "answered_at": "2025-10-20T10:30:00Z"
    },
    {
      "user_id": "user456",
      "username": "bob",
      "status": "in_queue",
      "position": 2
    },
    {
      "user_id": "user789",
      "username": "charlie",
      "status": "viewing"
    }
  ],
  "summary": {
    "answered": 1,
    "viewing": 1,
    "in_queue": 1,
    "not_sent": 0
  }
}
```

## WebSocket Events

### Server → Student

#### `quiz_queue_updated`
Sent when student's queue changes
```javascript
{
  queue: [
    {
      push_id: "abc-123",
      quiz: { id, title, content_text, ... },
      pushed_at: "2025-10-20T10:00:00Z",
      position: 1
    },
    {
      push_id: "def-456",
      quiz: { id, title, ... },
      pushed_at: "2025-10-20T10:05:00Z",
      position: 2
    }
  ],
  total: 2
}
```

#### `show_next_quiz`
Tells student to show next quiz (after answering current)
```javascript
{
  push_id: "abc-123",
  quiz: { ... },
  position: 1,
  total: 3
}
```

### Student → Server

#### `get_my_queue`
Request current queue (on connect/reconnect)
```javascript
{ user_id: "user123" }
```

### Server → Teacher

#### `student_queue_update`
Notify teacher when any student's queue changes
```javascript
{
  user_id: "user123",
  username: "alice",
  queue_length: 2,
  current_quiz: "Quiz A"
}
```

## Implementation Plan

### Phase 1: Server-Side Queue Management
- [ ] Add `studentQueues` Map
- [ ] Modify push endpoint to check student queues
- [ ] Add/remove from queue on push/answer
- [ ] Add queue status endpoints

### Phase 2: Student-Side Queue Display
- [ ] Receive and store personal queue
- [ ] Show current quiz (first in queue)
- [ ] Auto-advance to next after answering
- [ ] Show queue position (1/3, 2/3, etc.)

### Phase 3: Teacher Dashboard
- [ ] Add queue status view
- [ ] Show per-student queue length
- [ ] Show per-quiz distribution
- [ ] Real-time updates via WebSocket

### Phase 4: Duplicate Prevention
- [ ] Check if quiz already in student's queue
- [ ] Skip students who already have it
- [ ] Notify teacher: "Sent to 5/10 students (5 already have it)"

## Edge Cases

### Student Reconnects
```
Student disconnects
        ↓
Server keeps studentQueues[userId] intact
        ↓
Student reconnects
        ↓
Server sends: quiz_queue_updated with full queue
        ↓
Student resumes where they left off
```

### Teacher Deletes Response
```
Teacher deletes Alice's answer for push_id "abc-123"
        ↓
Server checks: Is "abc-123" still a valid push?
        ↓
If YES:
  - Add "abc-123" back to studentQueues[alice]
  - Send: quiz_queue_updated to Alice
  - Alice sees quiz appear in queue again
If NO:
  - Do nothing (old push, expired)
```

### Push Expires/Undo
```
Teacher undoes push_id "abc-123"
        ↓
Server removes "abc-123" from ALL studentQueues
        ↓
Send: quiz_removed { push_id: "abc-123" } to all students
        ↓
Students remove from queue
        ↓
If that was current quiz showing:
  - Hide it, show next in queue
```

### Multiple Students Different Progress
```
Initial: Alice, Bob, Charlie all get Quiz A
        ↓
Alice answers → removed from her queue
Bob views → still in his queue (position 1)
Charlie hasn't opened → still in his queue (position 1)
        ↓
Teacher pushes Quiz B
        ↓
All 3 get Quiz B added to queue:
- Alice: Queue = [Quiz B] (position 1)
- Bob: Queue = [Quiz A, Quiz B] (position 1 viewing, 2 pending)
- Charlie: Queue = [Quiz A, Quiz B] (position 1, 2)
```

## Database Schema Update

### Add Queue Tracking Table
```sql
CREATE TABLE student_quiz_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    push_id TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    position INTEGER,
    status TEXT DEFAULT 'pending', -- pending, viewing, answered
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (push_id) REFERENCES quiz_pushes(id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
    UNIQUE(user_id, push_id)
);

CREATE INDEX idx_student_queue ON student_quiz_queue(user_id, status);
CREATE INDEX idx_push_queue ON student_quiz_queue(push_id, status);
```

### Query Examples

**Get student's queue:**
```sql
SELECT * FROM student_quiz_queue 
WHERE user_id = ? AND status IN ('pending', 'viewing')
ORDER BY position ASC;
```

**Count students who have quiz in queue:**
```sql
SELECT COUNT(DISTINCT user_id) FROM student_quiz_queue
WHERE push_id = ? AND status IN ('pending', 'viewing');
```

**Students who already have this quiz:**
```sql
SELECT user_id FROM student_quiz_queue
WHERE quiz_id = ? AND status IN ('pending', 'viewing');
```

## Benefits of This Design

✅ **No Dialog Flash** - Quiz never shows if already answered
✅ **Clear Visibility** - Teacher sees exactly who has what
✅ **Fair Distribution** - Students can work at own pace
✅ **No Duplicates** - Same quiz doesn't appear twice in queue
✅ **Persistent** - Queue survives reconnect/refresh
✅ **Scalable** - Each student independent

## Migration from Current Code

1. **Keep existing code working** - Don't break current functionality
2. **Add studentQueues alongside** - Parallel implementation
3. **Migrate quiz_push logic** - Check queue before adding
4. **Update student client** - Handle queue instead of single push
5. **Add teacher UI** - Queue status views
6. **Test thoroughly** - Ensure no regressions
7. **Remove old code** - Clean up after migration complete

## Example Flow (Complete)

```
=== Teacher Action ===
Teacher: Push "Quiz A"
Server: Create push_id = "p1"
Server: studentQueues = {
  alice: ["p1"],
  bob: ["p1"],
  charlie: ["p1"]
}
Students: All receive quiz_queue_updated
Alice: Shows Quiz A (1/1)
Bob: Shows Quiz A (1/1)
Charlie: Shows Quiz A (1/1)

=== Alice Answers ===
Alice: Submits answer for p1
Server: Remove p1 from alice's queue
Server: studentQueues = {
  alice: [],
  bob: ["p1"],
  charlie: ["p1"]
}
Alice: Queue empty, hide dialog

=== Teacher Pushes Quiz B ===
Teacher: Push "Quiz B"
Server: Create push_id = "p2"
Server: studentQueues = {
  alice: ["p2"],
  bob: ["p1", "p2"],
  charlie: ["p1", "p2"]
}
Students: Receive queue updates
Alice: Shows Quiz B (1/1) - new quiz
Bob: Still showing Quiz A, updates to (1/2)
Charlie: Still showing Quiz A, updates to (1/2)

=== Teacher Pushes Quiz A Again ===
Teacher: Push "Quiz A"
Server: Create push_id = "p3"
Server: Check which students already have Quiz A
Server: Alice answered p1, can get p3
Server: Bob has p1 in queue, SKIP
Server: Charlie has p1 in queue, SKIP
Server: studentQueues = {
  alice: ["p2", "p3"],
  bob: ["p1", "p2"],      // unchanged
  charlie: ["p1", "p2"]   // unchanged
}
Result:
- Alice gets it (now has 2 in queue)
- Bob doesn't get it (already has Quiz A queued)
- Charlie doesn't get it (already has Quiz A queued)

Teacher sees:
"Quiz A sent to 1/3 students (2 already have it in queue)"
```

This is the correct architecture! Should I implement it?
