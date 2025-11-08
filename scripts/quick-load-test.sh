#!/bin/bash

# Quick Load Test Runner
# Usage: ./scripts/quick-load-test.sh [num_students]

NUM_STUDENTS=${1:-40}
SERVER_URL=${2:-http://localhost:3030}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧪 Tutoriaz Quick Load Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Students: $NUM_STUDENTS"
echo "  Server:   $SERVER_URL"
echo ""

# Check if server is running
echo "🔍 Checking server health..."
if curl -s -f "$SERVER_URL/health" > /dev/null 2>&1; then
    echo "✅ Server is responding"
else
    echo "❌ Server is not responding at $SERVER_URL"
    echo "   Please start the server first:"
    echo "   npm start"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 Starting Load Test..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if socket.io-client is installed
if ! node -e "require('socket.io-client')" 2>/dev/null; then
    echo "📦 Installing socket.io-client..."
    npm install socket.io-client
fi

# Check if node-fetch is installed  
if ! node -e "require('node-fetch')" 2>/dev/null; then
    echo "📦 Installing node-fetch..."
    npm install node-fetch@2
fi

# Run the load test
node scripts/loadTest.js $NUM_STUDENTS $SERVER_URL

# Capture exit code
EXIT_CODE=$?

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $EXIT_CODE -eq 0 ]; then
    echo "  ✅ Load Test Completed"
else
    echo "  ❌ Load Test Failed (Exit Code: $EXIT_CODE)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit $EXIT_CODE
