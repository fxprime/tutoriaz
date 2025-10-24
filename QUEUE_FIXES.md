# Quiz Queue & Re-Answer Prevention Fixes

## Summary
Fixed the quiz queue system to properly deliver queued quizzes to students and added prevention for re-answering the same quiz.

## Changes Made

### 1. Server-Side Queue Processing (`server.js`)

#### Fixed `processNextInQueue()` function:
- Now properly creates push records in database
- Sends quizzes via correct `quiz_push` WebSocket event
- Includes queue position info: `queue_position` and `queue_total`
- Creates proper timeout handlers
- Notifies teachers when queued quiz becomes active

#### Updated `addToQueue()` function:
- Now accepts `push`, `quiz`, and `teacherSocketId` parameters
- Properly stores all necessary data for queue processing

#### Enhanced Push Endpoint (`/api/pushes`):
- Detects when a quiz is already active
- Automatically queues subsequent pushes
- Returns queue position to teacher
- Adds queue metadata to all quiz pushes

#### Added Response Check Endpoint (`/api/check-response/:pushId`):
- GET endpoint for students to check if they've already answered
- Returns `{ already_answered: true/false }`
- Used by student interface to disable re-submission

### 2. Student Interface (`public/student.html`)

#### Queue Position Display:
- Quiz title now shows `(1/N)` format
- Example: "ESP32 Basics Quiz (1/3)" means this is quiz 1 of 3 total

#### Prevent Re-Answering:
- Checks if student has already answered when quiz is shown
- Fetches response status from `/api/check-response/:pushId`
- Automatically disables submission if already answered
- Shows info message: "You have already answered this quiz"

#### Error Handling:
- Detects "Already answered" error from server
- Automatically disables submission button
- Shows error message to student

## How Queue System Works

### Normal Flow (No Queue):
1. Teacher pushes Quiz A
2. Quiz A sent immediately to all students
3. `currentActiveQuiz = Quiz A`
4. Students see: "Quiz A (1/1)"

### Queued Flow:
1. Teacher pushes Quiz A
   - Sent immediately (currentActiveQuiz = A)
   - Students see: "Quiz A (1/1)"

2. Teacher pushes Quiz B (while A is active)
   - Added to queue, NOT sent yet
   - Teacher sees: "Quiz B added to queue. Position: 1"
   - Students see: "Quiz A (1/2)" ← total updated!

3. Teacher undoes Quiz A OR students finish
   - Quiz A cleared
   - Quiz B automatically dequeued and sent
   - Students see: "Quiz B (1/1)"

### Re-Answer Prevention:
1. Student answers Quiz A → response saved to database
2. Teacher pushes Quiz A again (or student rejoins)
3. Student receives quiz_push event
4. Student interface checks `/api/check-response/:pushId`
5. If already answered:
   - Show message: "You have already answered this quiz"
   - Disable submit button
   - Student can see quiz but cannot re-submit

## Teacher Can Delete Responses
If teacher wants student to re-answer:
1. Go to quiz responses view
2. Delete the student's previous response
3. Push the quiz again
4. Student can now answer (no existing response found)

## Queue Position Format
- `queue_position`: Current position (always 1 when active)
- `queue_total`: Total including current + queued
- Display: `(1/3)` means "quiz 1 of 3 total"

## Testing Scenarios

### Test 1: Basic Queue
```
1. Push Quiz A → Students see "Quiz A (1/1)"
2. Push Quiz B → Students still see "Quiz A (1/2)"
3. Undo Quiz A → Students see "Quiz B (1/1)" immediately
```

### Test 2: Multiple Queued
```
1. Push Quiz A → (1/1)
2. Push Quiz B → Queue position 1, students see (1/2)
3. Push Quiz C → Queue position 2, students see (1/3)
4. Undo A → B sent automatically, students see (1/2)
5. Undo B → C sent automatically, students see (1/1)
```

### Test 3: Re-Answer Prevention
```
1. Push Quiz A → Student answers
2. Push Quiz A again → Student sees "Already answered" message
3. Teacher deletes student's response
4. Push Quiz A again → Student can answer again
```

## Console Debug Output

### Server logs:
```
Quiz "ESP32 Basics" added to queue. Queue length: 1
Processing queued quiz: "ESP32 Basics"
Queued quiz "ESP32 Basics" sent to 5 students
```

### Student console logs:
```
Quiz push received: abc-123-def
Quiz overlay shown for push_id: abc-123-def
```

### Undo debug (on-screen):
- Red box top-right: "UNDO: abc-123-def"
- Green box: "QUIZ HIDDEN SUCCESSFULLY"

## Files Modified
1. `/Volumes/ExHDD/dev/tutoriaz/server.js`
   - Fixed `processNextInQueue()` function
   - Updated `addToQueue()` function
   - Enhanced `/api/pushes` endpoint
   - Added `/api/check-response/:pushId` endpoint

2. `/Volumes/ExHDD/dev/tutoriaz/public/student.html`
   - Added queue position display in title
   - Added response check on quiz show
   - Enhanced error handling for re-answer attempts

## Benefits
✅ Queued quizzes now properly delivered to students
✅ Clear queue position indicator for students
✅ Prevents duplicate answers (unless teacher deletes response)
✅ Automatic queue processing on undo/completion
✅ Teacher control over re-answer via response deletion
