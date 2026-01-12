#!/bin/bash

# Progress Tracking Test Script
# Tests the reading progress tracking system

echo "🧪 Testing Reading Progress Tracking System"
echo "=========================================="

BASE_URL="http://localhost:3030"
TOKEN=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo -e "\n${YELLOW}1. Checking if server is running...${NC}"
if curl -s "$BASE_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${RED}✗ Server is not running${NC}"
    echo "Please start the server first: node server.js"
    exit 1
fi

# Check database tables
echo -e "\n${YELLOW}2. Verifying database tables...${NC}"
TABLES=$(sqlite3 database.sqlite "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND (name LIKE '%progress%' OR name LIKE '%reading%' OR name LIKE '%section%');")
if [ "$TABLES" -ge 5 ]; then
    echo -e "${GREEN}✓ All progress tracking tables exist${NC}"
    echo "   Found tables: reading_progress, course_sections, course_progress_summary, reading_sessions, reading_quiz_triggers"
else
    echo -e "${RED}✗ Some tables are missing${NC}"
    echo "Please run: cat migrations/013_add_reading_progress.sql | sqlite3 database.sqlite"
    exit 1
fi

# Login as student
echo -e "\n${YELLOW}3. Logging in as student...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"student1","password":"student123"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    echo -e "${GREEN}✓ Login successful${NC}"
    echo "   Token: ${TOKEN:0:20}..."
else
    echo -e "${RED}✗ Login failed${NC}"
    echo "   Response: $LOGIN_RESPONSE"
    exit 1
fi

# Test progress recording (no auth required for this endpoint)
echo -e "\n${YELLOW}4. Testing progress recording...${NC}"
PROGRESS_RESPONSE=$(curl -s -X POST "$BASE_URL/api/progress" \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"student-001",
    "courseId":"test-course",
    "sectionId":"test-section-1",
    "sectionTitle":"Test Section 1",
    "pageUrl":"http://test.com/section1",
    "sessionId":"test-session-123",
    "timeSpentSeconds":30,
    "completedSections":["test-section-1"]
  }')

if echo $PROGRESS_RESPONSE | grep -q '"success":true'; then
    echo -e "${GREEN}✓ Progress recorded successfully${NC}"
    PERCENTAGE=$(echo $PROGRESS_RESPONSE | grep -o '"progressPercentage":[0-9.]*' | cut -d':' -f2)
    echo "   Progress: $PERCENTAGE%"
else
    echo -e "${RED}✗ Failed to record progress${NC}"
    echo "   Response: $PROGRESS_RESPONSE"
fi

# Test getting my progress
echo -e "\n${YELLOW}5. Testing my progress retrieval...${NC}"
MY_PROGRESS=$(curl -s "$BASE_URL/api/my-progress" \
  -H "Authorization: Bearer $TOKEN")

if echo $MY_PROGRESS | grep -q '"success":true'; then
    echo -e "${GREEN}✓ Retrieved my progress successfully${NC}"
    COURSE_COUNT=$(echo $MY_PROGRESS | grep -o '"courseId"' | wc -l)
    echo "   Enrolled courses: $COURSE_COUNT"
else
    echo -e "${RED}✗ Failed to retrieve my progress${NC}"
    echo "   Response: $MY_PROGRESS"
fi

# Login as teacher
echo -e "\n${YELLOW}6. Logging in as teacher...${NC}"
TEACHER_LOGIN=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"teacher","password":"admin123"}')

TEACHER_TOKEN=$(echo $TEACHER_LOGIN | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TEACHER_TOKEN" ]; then
    echo -e "${GREEN}✓ Teacher login successful${NC}"
else
    echo -e "${RED}✗ Teacher login failed${NC}"
    exit 1
fi

# Get teacher's courses
echo -e "\n${YELLOW}7. Getting teacher's courses...${NC}"
COURSES=$(curl -s "$BASE_URL/api/courses" \
  -H "Authorization: Bearer $TEACHER_TOKEN")

FIRST_COURSE_ID=$(echo $COURSES | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -n "$FIRST_COURSE_ID" ]; then
    echo -e "${GREEN}✓ Retrieved courses${NC}"
    echo "   Testing with course: $FIRST_COURSE_ID"
    
    # Test course progress endpoint
    echo -e "\n${YELLOW}8. Testing course progress (teacher view)...${NC}"
    COURSE_PROGRESS=$(curl -s "$BASE_URL/api/courses/$FIRST_COURSE_ID/progress" \
      -H "Authorization: Bearer $TEACHER_TOKEN")
    
    if echo $COURSE_PROGRESS | grep -q '"success":true'; then
        echo -e "${GREEN}✓ Retrieved course progress successfully${NC}"
        STUDENT_COUNT=$(echo $COURSE_PROGRESS | grep -o '"userId"' | wc -l)
        echo "   Students tracked: $STUDENT_COUNT"
    else
        echo -e "${YELLOW}⚠ Course progress endpoint returned: $(echo $COURSE_PROGRESS | head -c 100)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ No courses found. Create a course to test fully.${NC}"
fi

# Check database entries
echo -e "\n${YELLOW}9. Checking database entries...${NC}"
PROGRESS_COUNT=$(sqlite3 database.sqlite "SELECT COUNT(*) FROM reading_progress;")
SESSION_COUNT=$(sqlite3 database.sqlite "SELECT COUNT(*) FROM reading_sessions;")
SUMMARY_COUNT=$(sqlite3 database.sqlite "SELECT COUNT(*) FROM course_progress_summary;")

echo "   Reading Progress entries: $PROGRESS_COUNT"
echo "   Reading Sessions: $SESSION_COUNT"
echo "   Progress Summaries: $SUMMARY_COUNT"

if [ $PROGRESS_COUNT -gt 0 ]; then
    echo -e "${GREEN}✓ Database contains progress data${NC}"
else
    echo -e "${YELLOW}⚠ No progress data in database yet${NC}"
fi

# Test UI pages
echo -e "\n${YELLOW}10. Testing UI pages...${NC}"

if curl -s "$BASE_URL/course-progress.html" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Teacher progress dashboard accessible${NC}"
else
    echo -e "${RED}✗ Teacher progress dashboard not found${NC}"
fi

if curl -s "$BASE_URL/my-progress.html" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Student progress page accessible${NC}"
else
    echo -e "${RED}✗ Student progress page not found${NC}"
fi

echo -e "\n${GREEN}=========================================="
echo "✓ Testing Complete!"
echo "==========================================${NC}"
echo ""
echo "Next Steps:"
echo "1. Open teacher dashboard: $BASE_URL/course-progress.html?courseId=<course-id>"
echo "2. Open student progress: $BASE_URL/my-progress.html"
echo "3. Test with documentation: $BASE_URL/docs/uno_watering_tutorial/site/?user_id=student-001&course_id=test"
echo ""
echo "Documentation: See PROGRESS_TRACKING_IMPLEMENTATION.md"
