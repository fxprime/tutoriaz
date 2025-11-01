#!/bin/bash

# Quick CSV export test - requires server to be running
# Usage: bash scripts/quickTestCsv.sh

echo "🧪 Quick CSV Export Test"
echo ""

# Check if server is running
if ! curl -s http://localhost:3030 > /dev/null; then
    echo "❌ Server not running at http://localhost:3030"
    echo "   Start the server first: npm start"
    exit 1
fi

echo "✅ Server is running"
echo ""

# Login and test
TOKEN=$(curl -s -X POST "http://localhost:3030/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"teacher","password":"admin123"}' | \
  grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed"
    exit 1
fi

echo "✅ Logged in as teacher"

COURSE_ID=$(curl -s "http://localhost:3030/api/courses" \
  -H "Authorization: Bearer $TOKEN" | \
  grep -o '"id":"[^"]*' | head -1 | sed 's/"id":"//')

if [ -z "$COURSE_ID" ]; then
    echo "❌ No courses found"
    exit 1
fi

echo "✅ Found course: $COURSE_ID"
echo ""

# Test basic export
echo "📊 Testing BASIC export..."
curl -s "http://localhost:3030/api/courses/$COURSE_ID/export-csv?mode=basic" \
  -H "Authorization: Bearer $TOKEN" \
  -o "test_basic.csv"

if [ $? -eq 0 ] && [ -s "test_basic.csv" ]; then
    echo "✅ Basic export successful!"
    echo "   Lines: $(wc -l < test_basic.csv)"
    echo "   First 2 lines:"
    head -n 2 test_basic.csv | sed 's/^/   /'
else
    echo "❌ Basic export failed"
    cat test_basic.csv
    exit 1
fi

echo ""

# Test full export
echo "📊 Testing FULL export..."
curl -s "http://localhost:3030/api/courses/$COURSE_ID/export-csv?mode=full" \
  -H "Authorization: Bearer $TOKEN" \
  -o "test_full.csv"

if [ $? -eq 0 ] && [ -s "test_full.csv" ]; then
    echo "✅ Full export successful!"
    echo "   Lines: $(wc -l < test_full.csv)"
    echo "   First 2 lines:"
    head -n 2 test_full.csv | sed 's/^/   /'
else
    echo "❌ Full export failed"
    cat test_full.csv
    exit 1
fi

echo ""
echo "🎉 All tests passed!"
echo ""
echo "Files created:"
echo "  - test_basic.csv"
echo "  - test_full.csv"
