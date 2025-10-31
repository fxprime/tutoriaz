#!/bin/bash

# Tutoriaz Startup Script
# This script ensures proper environment setup before starting the server

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "======================================"
echo "Starting Tutoriaz Server"
echo "======================================"

# Load environment variables if .env file exists
if [ -f ".env" ]; then
    echo "Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Set default environment variables if not already set
export NODE_ENV=${NODE_ENV:-production}
export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-3030}
export BASE_URL=${BASE_URL:-http://localhost:3030}
export JWT_SECRET=${JWT_SECRET:-please-change-this-secret}

echo "Environment:"
echo "  NODE_ENV: $NODE_ENV"
echo "  HOST: $HOST"
echo "  PORT: $PORT"
echo "  BASE_URL: $BASE_URL"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Dependencies not installed. Running npm install..."
    npm install --production
fi

# Check if database exists
if [ ! -f "database.sqlite" ]; then
    echo "⚠️  Warning: database.sqlite not found. It will be created on first run."
fi

# Check if courses submodule is initialized
if [ -d "courses/esp32_basic" ]; then
    if [ ! -f "courses/esp32_basic/site/index.html" ]; then
        echo "⚠️  Warning: Course documentation not found."
        echo "    Run: git submodule init && git submodule update --recursive"
    fi
fi

echo "Starting server..."
echo "======================================"

# Start the server
exec node server.js
