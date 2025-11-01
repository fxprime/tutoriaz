#!/bin/bash

# Test CSV export functionality
# This script logs in as teacher and tests CSV export

set -e

BASE_URL="${BASE_URL:-http://localhost:3030}"

echo "🧪 CSV Export Test"
echo "=================="
echo "Base URL: $BASE_URL"
echo ""

# Login as teacher to get token
echo "1️⃣  Logging in as teacher..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"teacher","password":"admin123"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed!"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

echo "✅ Login successful"
echo "Token: ${TOKEN:0:30}..."
echo ""

# Get courses
echo "2️⃣  Fetching courses..."
COURSES_RESPONSE=$(curl -s -X GET "$BASE_URL/api/courses" \
  -H "Authorization: Bearer $TOKEN")

COURSE_ID=$(echo "$COURSES_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | sed 's/"id":"//')

if [ -z "$COURSE_ID" ]; then
    echo "❌ No courses found!"
    echo "Response: $COURSES_RESPONSE"
    exit 1
fi

echo "✅ Found course: $COURSE_ID"
echo ""

# Test basic export
echo "3️⃣  Testing BASIC export..."
BASIC_FILE="test_export_basic_$(date +%Y%m%d_%H%M%S).csv"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$BASIC_FILE" \
  "$BASE_URL/api/courses/$COURSE_ID/export-csv?mode=basic" \
  -H "Authorization: Bearer $TOKEN")

if [ "$HTTP_CODE" = "200" ]; then
    LINES=$(wc -l < "$BASIC_FILE" | tr -d ' ')
    SIZE=$(ls -lh "$BASIC_FILE" | awk '{print $5}')
    echo "✅ Basic export successful!"
    echo "   File: $BASIC_FILE"
    echo "   Size: $SIZE"
    echo "   Lines: $LINES"
    echo ""
    echo "   Preview:"
    head -n 3 "$BASIC_FILE" | sed 's/^/   /'
else
    echo "❌ Basic export failed! HTTP $HTTP_CODE"
    cat "$BASIC_FILE"
    rm -f "$BASIC_FILE"
    exit 1
fi

echo ""

# Test full export
echo "4️⃣  Testing FULL export..."
FULL_FILE="test_export_full_$(date +%Y%m%d_%H%M%S).csv"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$FULL_FILE" \
  "$BASE_URL/api/courses/$COURSE_ID/export-csv?mode=full" \
  -H "Authorization: Bearer $TOKEN")

if [ "$HTTP_CODE" = "200" ]; then
    LINES=$(wc -l < "$FULL_FILE" | tr -d ' ')
    SIZE=$(ls -lh "$FULL_FILE" | awk '{print $5}')
    echo "✅ Full export successful!"
    echo "   File: $FULL_FILE"
    echo "   Size: $SIZE"
    echo "   Lines: $LINES"
    echo ""
    echo "   Preview:"
    head -n 3 "$FULL_FILE" | sed 's/^/   /'
else
    echo "❌ Full export failed! HTTP $HTTP_CODE"
    cat "$FULL_FILE"
    rm -f "$FULL_FILE"
    exit 1
fi

echo ""
echo "=================="
echo "🎉 All tests passed!"
echo ""
echo "Exported files:"
echo "  - $BASIC_FILE"
echo "  - $FULL_FILE"
