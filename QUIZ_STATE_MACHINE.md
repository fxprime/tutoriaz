# Quiz Push State Machine & Timeline

## Problem Analysis
1. **Answered quizzes should not show again** - Once answered, quiz dialog should auto-close and not reappear
2. **Queue counter not updating** - When new quiz is pushed while student has unanswered quiz, should update from (1/1) to (1/2)

## Current Flow Issues

### Issue 1: Answered Quiz Still Shows
```
Timeline:
1. Teacher pushes Quiz A → Student sees dialog (1/1)
2. Student answers Quiz A → Dialog closes after 2s
3. Teacher pushes Quiz A again → Student sees dialog AGAIN ❌

Expected:
3. Teacher pushes Quiz A again → Student should NOT see dialog (already answered) ✓
```

### Issue 2: Queue Counter Not Updating
```
Timeline:
1. Teacher pushes Quiz A → Student sees (1/1)
2. Student does NOT answer yet
3. Teacher pushes Quiz B (queued) → Student should see Quiz A update to (1/2) ❌
   Currently: Student still sees (1/1)

Expected:
3. Teacher pushes Quiz B → Student sees Quiz A dialog update to (1/2) ✓
```

## State Machine Design

### Student Quiz States
```
┌─────────────┐
│   NO QUIZ   │ ← Initial state
└──────┬──────┘
       │ quiz_push received
       ↓
┌─────────────────┐
│  SHOWING QUIZ   │ ← Dialog visible, can answer
│   (Active)      │
└────┬─────┬──────┘
     │     │
     │     └─→ answer submitted → ANSWERED → hide after 2s → NO QUIZ
     │
     └─→ quiz_undo → NO QUIZ
     │
     └─→ timeout → TIMEOUT → NO QUIZ
```

### Server Push States
```
TEACHER PUSHES QUIZ
       ↓
   Is there an
   active quiz?
       ↓
    NO │ YES
       │  ↓
       │  ADD TO QUEUE
       │  Send queue update to students
       ↓
   CREATE PUSH RECORD
   SET currentActiveQuiz
   SEND quiz_push to students
   NOTIFY teachers
```

## Required Changes

### 1. Server-Side: Send Queue Updates to Students

When a quiz is added to queue, server should notify ALL students:
```javascript
// When quiz is queued:
io.emit('queue_update', {
    active_push_id: currentActiveQuiz,
    queue_total: 1 + quizQueue.length
});
```

### 2. Student-Side: Handle Queue Updates

Student should listen for `queue_update` event and update current quiz display:
```javascript
socket.on('queue_update', (data) => {
    if (currentQuiz && currentQuiz.push_id === data.active_push_id) {
        // Update the title with new queue count
        updateQuizTitle(currentQuiz.quiz.title, 1, data.queue_total);
    }
});
```

### 3. Student-Side: Check Before Showing Quiz

When `quiz_push` is received, check if already answered:
```javascript
socket.on('quiz_push', async (data) => {
    // Check if already answered
    const alreadyAnswered = await checkIfAnswered(data.push_id);
    
    if (alreadyAnswered) {
        console.log('Quiz already answered, not showing');
        showNotification('You already answered this quiz', 'info');
        return; // DON'T show quiz
    }
    
    // Show quiz if not answered
    showQuiz(data);
});
```

### 4. Student-Side: Track Answered Pushes

Keep a local set of answered push IDs to avoid re-showing:
```javascript
const answeredPushes = new Set();

// When answer is submitted successfully:
socket.on('answer_submitted', (data) => {
    answeredPushes.add(data.push_id);
    // ... existing code
});
```

## Data Flow Diagram

### Scenario 1: Single Quiz Push
```
Server                          Student
  │                               │
  │─── quiz_push (1/1) ──────────→│ Show dialog
  │                               │ Student answers
  │←── quiz_answer ───────────────│
  │─── answer_submitted ─────────→│ Add to answeredPushes
  │                               │ Hide dialog after 2s
```

### Scenario 2: Queue Building (Student Not Answered Yet)
```
Server                          Student
  │                               │
  │─── quiz_push A (1/1) ────────→│ Show Quiz A
  │                               │ (not answered yet)
  │                               │
Teacher pushes Quiz B (queued)   │
  │                               │
  │─── queue_update ─────────────→│ Update: Quiz A (1/2) ✓
  │     {active: A, total: 2}     │
  │                               │
Student answers A                 │
  │←── quiz_answer A ─────────────│
  │─── answer_submitted A ────────→│ Hide A
  │                               │
  │─── quiz_push B (1/1) ────────→│ Show Quiz B ✓
```

### Scenario 3: Re-Push Already Answered Quiz
```
Server                          Student
  │                               │
  │─── quiz_push A ──────────────→│ Check answeredPushes
  │                               │ Contains A? YES
  │                               │ → DON'T show dialog ✓
  │                               │ → Show notification ✓
```

## Implementation Checklist

### Server (`server.js`):
- [ ] Add `queue_update` event emission when quiz is queued
- [ ] Include `active_push_id` and `queue_total` in queue_update
- [ ] Emit to ALL connected students

### Student (`student.html`):
- [ ] Add `answeredPushes` Set to track answered quiz push_ids
- [ ] Modify `quiz_push` handler to check if already answered BEFORE showing
- [ ] Add `queue_update` handler to update current quiz title
- [ ] Add push_id to `answeredPushes` when answer submitted successfully
- [ ] Create helper function to update quiz title dynamically

## Edge Cases to Handle

1. **Student reconnects after answering**
   - answeredPushes is in memory, lost on page refresh
   - Solution: Check server on quiz_push (already implemented with `/api/check-response`)

2. **Teacher deletes response**
   - answeredPushes still has old push_id
   - Solution: Use server check as source of truth, clear answeredPushes on new push

3. **Multiple students at different stages**
   - Student A answered, Student B hasn't
   - Both get queue_update
   - Solution: Each student checks their own currentQuiz state

4. **Queue empties**
   - Last quiz completes, queue becomes empty
   - Solution: queue_total correctly shows 1 when queue is empty

## Testing Plan

### Test 1: Prevent Re-Show
```
1. Push Quiz A
2. Student answers Quiz A
3. Push Quiz A again
Expected: Student does NOT see Quiz A dialog
```

### Test 2: Queue Counter Update
```
1. Push Quiz A → Student sees (1/1)
2. Push Quiz B (student hasn't answered A)
Expected: Student sees Quiz A update to (1/2)
3. Student answers A
Expected: Student sees Quiz B as (1/1)
```

### Test 3: Multi-Student
```
1. Push Quiz A to 3 students
2. Student 1 answers immediately
3. Push Quiz B (queued)
Expected: 
  - Student 1 sees nothing (answered A)
  - Student 2,3 see Quiz A update to (1/2)
```

### Test 4: Reconnect
```
1. Student answers Quiz A
2. Student refreshes page
3. Push Quiz A again
Expected: Student does NOT see Quiz A (server check prevents it)
```
