# Testing Guide - Quiz Queue System

## Prerequisites
```bash
# Start the server
cd /Volumes/ExHDD/dev/tutoriaz
node server.js
```

Server should show:
```
Server running on port 3000
Database initialized
```

## Test Scenarios

### Test 1: Prevent Re-Show of Answered Quiz ✅

**Setup:**
1. Open 2 browser windows
   - Window 1: http://localhost:3000 (Teacher: admin/admin123)
   - Window 2: http://localhost:3000 (Student: student1/student123)

**Steps:**
1. Teacher: Create a quiz named "Test Quiz 1"
2. Teacher: Click "Push to Students" on Test Quiz 1
3. Student: Should see quiz dialog appear with title "Test Quiz 1 (1/1)"
4. Student: Answer the quiz and submit
5. Student: Dialog should close after 2 seconds
6. Teacher: Click "Push to Students" on Test Quiz 1 AGAIN
7. Student: Should see notification "You already answered this quiz"
8. Student: Dialog should NOT appear ✅

**Expected Console Logs (Student):**
```
Quiz push received: abc-123-def
Quiz already answered (local check), not showing
```

---

### Test 2: Queue Counter Dynamic Update ✅

**Setup:**
1. Open 2 browser windows (Teacher + Student)

**Steps:**
1. Teacher: Push Quiz A
2. Student: Should see "Quiz A (1/1)"
3. Student: DO NOT ANSWER YET - just look at it
4. Teacher: Push Quiz B (while Quiz A is still showing on student)
5. Student: Should see title update to "Quiz A (1/2)" ✅
6. Teacher: Push Quiz C
7. Student: Should see title update to "Quiz A (1/3)" ✅
8. Student: Now answer Quiz A and submit
9. Student: After 2 seconds, Quiz B should appear showing "Quiz B (1/2)" ✅
10. Student: Answer Quiz B
11. Student: Quiz C should appear showing "Quiz C (1/1)" ✅

**Expected Console Logs (Student):**
```
Queue update received: {active_push_id: "abc", queue_total: 2}
Updated quiz title to: Quiz A (1/2)
Queue update received: {active_push_id: "abc", queue_total: 3}
Updated quiz title to: Quiz A (1/3)
```

**Expected Console Logs (Server):**
```
Quiz "Quiz B" added to queue. Queue length: 1
Queue update sent: active=abc-123, total=2
Quiz "Quiz C" added to queue. Queue length: 2
Queue update sent: active=abc-123, total=3
```

---

### Test 3: Multiple Students at Different Stages ✅

**Setup:**
1. Open 4 browser windows
   - Window 1: Teacher (admin/admin123)
   - Window 2: Student Alice (student1/student123)
   - Window 3: Student Bob (student2/student123)
   - Window 4: Student Charlie (student3/student123)

**Steps:**
1. Teacher: Push Quiz A
2. All students: Should see "Quiz A (1/1)"
3. Alice: Answer Quiz A immediately
4. Alice: Dialog should close
5. Teacher: Push Quiz B (while Bob and Charlie still have Quiz A open)
6. Alice: Should see nothing (no dialog)
7. Bob: Should see "Quiz A (1/2)" ✅
8. Charlie: Should see "Quiz A (1/2)" ✅
9. Bob: Answer Quiz A
10. Bob: Dialog closes
11. Charlie: Answer Quiz A
12. Charlie: Dialog closes
13. ALL students: Should now see "Quiz B (1/1)" ✅

**Expected Behavior:**
- Alice: No Quiz B until Bob and Charlie finish Quiz A (queue processing)
- Bob & Charlie: See count update when Quiz B is queued
- All get Quiz B after all finish Quiz A

---

### Test 4: Student Page Refresh ✅

**Setup:**
1. Teacher + Student windows

**Steps:**
1. Teacher: Push Quiz A (push_id will be something like 'abc-123')
2. Student: See quiz, answer it, submit
3. Student: Note the push_id in debug logs
4. Student: Press F5 to refresh page (or Cmd+R on Mac)
5. Student: Log back in (student1/student123)
6. Teacher: Push Quiz A again WITH SAME push_id (if possible)
   - OR check: Navigate to teacher view, click "View Responses"
   - Find the push_id from step 3
7. Teacher: Use API to re-push (advanced test)
8. Student: Should see "You already answered this quiz" ✅
9. Student: Dialog should NOT appear ✅

**Expected Console Logs (Student after refresh):**
```
Quiz push received: abc-123
answeredPushes.has('abc-123') → false (lost in refresh)
Checking server: /api/check-response/abc-123
Quiz already answered (server check), not showing
```

---

### Test 5: Rapid Multiple Queuing ✅

**Setup:**
1. Teacher + Student windows
2. Create 5 quizzes beforehand (Quiz A, B, C, D, E)

**Steps:**
1. Teacher: Push Quiz A
2. Student: Should see "Quiz A (1/1)"
3. Teacher: Quickly push Quiz B, C, D, E (click push buttons rapidly)
4. Student: Should see updates:
   - "Quiz A (1/2)" after B is queued
   - "Quiz A (1/3)" after C is queued
   - "Quiz A (1/4)" after D is queued
   - "Quiz A (1/5)" after E is queued ✅
5. Student: Answer Quiz A
6. Student: Should see "Quiz B (1/4)" ✅
7. Student: Answer B → see "Quiz C (1/3)" ✅
8. Student: Answer C → see "Quiz D (1/2)" ✅
9. Student: Answer D → see "Quiz E (1/1)" ✅

**Expected Server Logs:**
```
Quiz "Quiz B" added to queue. Queue length: 1
Queue update sent: active=A, total=2
Quiz "Quiz C" added to queue. Queue length: 2
Queue update sent: active=A, total=3
Processing queued quiz: "Quiz B"
Queued quiz "Quiz B" sent to 1 students
```

---

### Test 6: Undo During Queue ✅

**Setup:**
1. Teacher + Student windows

**Steps:**
1. Teacher: Push Quiz A
2. Student: See "Quiz A (1/1)"
3. Teacher: Push Quiz B (queued)
4. Student: See "Quiz A (1/2)"
5. Teacher: Click "Undo" on Quiz A
6. Student: Quiz A dialog should close immediately ✅
7. Student: Quiz B should appear within 100ms showing "Quiz B (1/1)" ✅

**Expected Flow:**
- Undo triggers `processNextInQueue()` after clearing currentActiveQuiz
- Queue processes automatically without teacher action

---

### Test 7: Teacher Deletes Response ✅

**Setup:**
1. Teacher + Student windows

**Steps:**
1. Teacher: Push Quiz A
2. Student: Answer Quiz A
3. Student: answeredPushes now contains Quiz A's push_id
4. Teacher: Navigate to Quiz A responses view
5. Teacher: Find student's response, click delete (if implemented)
6. Teacher: Push Quiz A again
7. Student: Should see quiz dialog again ✅

**Note:** Delete response feature needs to be implemented in teacher UI for this test.

---

## Debug Tools

### Check answeredPushes Set (Student Console)
```javascript
console.log('Answered pushes:', answeredPushes);
console.log('Size:', answeredPushes.size);
```

### Check Current Quiz (Student Console)
```javascript
console.log('Current quiz:', currentQuiz);
console.log('Push ID:', currentQuiz?.push_id);
```

### Check Server State (Server Console)
Add these commands in server code temporarily:
```javascript
console.log('Active pushes:', activePushes.size);
console.log('Queue length:', quizQueue.length);
console.log('Current active quiz:', currentActiveQuiz);
```

### Manual API Tests (Using curl or Postman)

Check if student answered:
```bash
# Get token first by logging in, then:
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/check-response/PUSH_ID
```

Get queue status:
```bash
curl -H "Authorization: Bearer TEACHER_TOKEN" \
  http://localhost:3000/api/queue-status
```

---

## Common Issues & Solutions

### Issue: Queue counter not updating
**Symptom:** Push Quiz B while A is showing, still shows (1/1)
**Check:**
1. Server console: Is "Queue update sent" appearing?
2. Student console: Is 'queue_update' event received?
3. Student console: Is currentQuiz defined?

**Solution:**
- Ensure student is authenticated
- Check WebSocket connection is active
- Verify student has quiz dialog open (not hidden)

### Issue: Quiz shows again after answering
**Symptom:** Answer Quiz A, it appears again
**Check:**
1. Student console: Is push_id added to answeredPushes?
2. Server: Was response saved to database?
3. Student console: Check `answeredPushes.has(push_id)`

**Solution:**
- Check 'answer_submitted' event is firing
- Verify answeredPushes.add() is called
- Check server /api/check-response endpoint

### Issue: Queue doesn't process automatically
**Symptom:** Answer Quiz A, Quiz B doesn't appear
**Check:**
1. Server console: Is "Processing queued quiz" appearing?
2. Server: Is `processNextInQueue()` being called?
3. Check if timeout or undo triggered the process

**Solution:**
- Ensure undo/timeout calls processNextInQueue()
- Check quizQueue is not empty
- Verify currentActiveQuiz is cleared before processing

---

## Success Criteria

✅ All tests pass
✅ No duplicate quiz dialogs for answered quizzes
✅ Queue counter updates dynamically (1/1 → 1/2 → 1/3)
✅ Multiple students work independently
✅ Page refresh doesn't break answer tracking
✅ Queue processes automatically
✅ No console errors

## Performance Benchmarks

- **Quiz push latency:** < 100ms from teacher click to student display
- **Queue update latency:** < 50ms from queue to counter update
- **Answer check (local):** < 1ms (Set lookup)
- **Answer check (server):** < 100ms (database query)
- **Undo to next quiz:** < 100ms (processNextInQueue)

---

## Automated Test Script (Future)

```javascript
// Example automated test using Puppeteer or Selenium
describe('Quiz Queue System', () => {
  test('Answered quiz does not show again', async () => {
    // Login as student
    // Wait for quiz push
    // Submit answer
    // Wait for another push of same quiz
    // Assert: dialog is not visible
  });
  
  test('Queue counter updates', async () => {
    // Login as student
    // Wait for quiz A (1/1)
    // Teacher pushes quiz B
    // Assert: title shows (1/2)
  });
});
```
