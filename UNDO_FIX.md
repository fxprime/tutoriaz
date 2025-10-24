# Undo Fix - Target Specific Quiz Only

## Problem
The undo functionality was not properly handling the per-student queue system. It needed to:
1. Remove only the specific quiz (by push_id) from each student's queue
2. If student is currently viewing that quiz, close it and show next quiz
3. If student is NOT viewing that quiz (it's pending), just remove from queue
4. Update teacher dashboard to reflect new queue status

## Solution

### Server-Side Changes (`server.js`)

#### Modified: `/api/pushes/:pushId/undo` endpoint

**Key Changes**:

1. **Remove from Database Queue**:
   ```javascript
   // Remove this specific push from all student queues in database
   await new Promise((resolve, reject) => {
       db.run('DELETE FROM student_quiz_queue WHERE push_id = ?', [pushId], (err) => {
           if (err) reject(err);
           else resolve();
       });
   });
   ```

2. **Process Each Student Individually**:
   ```javascript
   for (const student of connectedTargets) {
       // Remove from in-memory queue
       await removeFromStudentQueue(student.userId, pushId);
       
       // Send undo event
       io.to(student.socketId).emit('quiz_undo', { push_id: pushId });
       
       // Get updated queue
       const remainingQueue = await getStudentQueue(student.userId);
       
       if (remainingQueue.length > 0) {
           // Send next quiz
           const nextQuiz = remainingQueue[0];
           io.to(student.socketId).emit('show_next_quiz', { ... });
       } else {
           // Queue is empty
           io.to(student.socketId).emit('quiz_queue_updated', { queue: [] });
       }
   }
   ```

3. **Update Teacher Dashboard**:
   ```javascript
   // Update online list to reflect queue changes
   updateOnlineList();
   ```

**Flow**:
```
Teacher clicks Undo on Quiz A
    ↓
DELETE FROM student_quiz_queue WHERE push_id = 'quiz-a-id'
    ↓
For each student who received Quiz A:
    ├─ Remove from in-memory queue (studentQueues Map)
    ├─ Send 'quiz_undo' event (closes dialog if viewing)
    └─ Send 'show_next_quiz' or 'quiz_queue_updated' (shows next or empty)
    ↓
Update teacher dashboard (updateOnlineList)
    ↓
Teachers see updated queue counts
```

---

### Client-Side Changes (`public/student.html`)

#### Modified: `socket.on('quiz_undo')` handler

**Key Changes**:

1. **Update Local Queue**:
   ```javascript
   // Remove from myQueue
   myQueue = myQueue.filter(item => item.push_id !== data.push_id);
   updateDebugQueue();
   ```

2. **Smart Dialog Handling**:
   ```javascript
   if (currentQuiz && currentQuiz.push_id === data.push_id) {
       // Currently viewing this quiz - close it
       hideQuiz();
       showNotification('Quiz was cancelled by teacher', 'info');
       // Server will send next quiz
   } else {
       // Not viewing, just in queue - remove silently
       showNotification('A quiz was removed from your queue', 'info');
   }
   ```

**Behavior**:
- If student is viewing Quiz A and teacher undoes it → Dialog closes, next quiz appears
- If student is viewing Quiz B and teacher undoes Quiz A → Quiz A removed from queue, Quiz B stays open
- Debug panel updates in real-time to show removed quiz

---

## Test Scenarios

### Scenario 1: Undo Currently Viewing Quiz
```
Initial State:
- Student viewing: Quiz A (push_id: abc123)
- Student queue: [Quiz A, Quiz B, Quiz C]

Teacher undoes Quiz A:
1. ✅ Quiz A dialog closes
2. ✅ Quiz B appears automatically
3. ✅ Debug panel shows: [Quiz B, Quiz C]
4. ✅ Teacher dashboard shows: "Viewing: Quiz B, 1 pending"
```

### Scenario 2: Undo Pending Quiz
```
Initial State:
- Student viewing: Quiz A (push_id: abc123)
- Student queue: [Quiz A, Quiz B, Quiz C]

Teacher undoes Quiz B:
1. ✅ Quiz A stays open (student keeps working)
2. ✅ Notification: "A quiz was removed from your queue"
3. ✅ Debug panel shows: [Quiz A, Quiz C]
4. ✅ Teacher dashboard shows: "Viewing: Quiz A, 1 pending"
```

### Scenario 3: Undo Last Quiz in Queue
```
Initial State:
- Student viewing: Quiz A (push_id: abc123)
- Student queue: [Quiz A]

Teacher undoes Quiz A:
1. ✅ Quiz A dialog closes
2. ✅ Notification: "All quizzes completed!"
3. ✅ Debug panel shows: "Queue is empty"
4. ✅ Teacher dashboard shows: "✅ No pending quizzes"
```

### Scenario 4: Multiple Students, Different Queues
```
Initial State:
- Alice viewing: Quiz A, queue: [Quiz A, Quiz B]
- Bob viewing: Quiz B, queue: [Quiz B, Quiz C]
- Charlie viewing: Quiz A, queue: [Quiz A]

Teacher undoes Quiz A:
1. ✅ Alice: Quiz A closes, Quiz B appears
2. ✅ Bob: Nothing changes (still on Quiz B)
3. ✅ Charlie: Quiz A closes, queue empty
4. ✅ Teacher sees all three students with updated queues
```

---

## Code Changes Summary

### Files Modified:
1. **`server.js`**
   - `/api/pushes/:pushId/undo` endpoint completely rewritten
   - Now uses database DELETE for specific push_id
   - Processes each student individually
   - Sends next quiz or empty queue event
   - Calls `updateOnlineList()` to update teacher dashboard

2. **`public/student.html`**
   - `quiz_undo` event handler enhanced
   - Updates local `myQueue` array
   - Updates debug panel display
   - Smart notification based on whether viewing or pending

### Database:
- Uses existing `student_quiz_queue` table
- DELETE operation removes only rows with matching `push_id`
- Other quizzes in queue remain intact

---

## Benefits

1. **Precise Control**: Teacher can undo specific quizzes without affecting others
2. **Smooth UX**: Student sees immediate feedback and next quiz appears automatically
3. **Real-Time Updates**: Teacher dashboard shows accurate queue status
4. **Debug Visibility**: Debug panel shows queue changes in real-time
5. **No Interruption**: Students working on other quizzes are not disturbed

---

## Testing Checklist

- [ ] Teacher pushes Quiz A, Quiz B, Quiz C to student
- [ ] Student receives all three in queue
- [ ] Debug panel shows all three quizzes
- [ ] Teacher undoes Quiz B (middle of queue)
- [ ] Student still viewing Quiz A (no interruption)
- [ ] Debug panel shows only Quiz A and Quiz C
- [ ] Teacher dashboard shows student has 1 pending
- [ ] Student finishes Quiz A
- [ ] Quiz C appears next (Quiz B skipped)
- [ ] Undo currently viewing quiz closes dialog immediately
- [ ] Next quiz appears after undo of current quiz
- [ ] Multiple students can have different queues undone independently

---

## Edge Cases Handled

1. **Undo First Quiz**: Current quiz closes, next quiz appears
2. **Undo Middle Quiz**: Removed from queue, student keeps working on current
3. **Undo Last Quiz**: If viewing, closes and shows empty. If pending, just removed
4. **Undo When One Quiz Left**: Shows "All quizzes completed!"
5. **Multiple Students**: Each student's queue updated independently
6. **Database + Memory Sync**: Both database and in-memory queue updated
7. **Teacher Dashboard**: Real-time update shows new queue status

