#!/bin/bash

# Tutoriaz Service Startup Script
# This script is designed to be used by systemd service
# It skips git operations and documentation building (handled by auto-update.sh)
# and focuses on just starting the server

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output (if running interactively)
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_info() {
    echo -e "${YELLOW}→${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

echo "======================================"
echo "Tutoriaz Service Startup"
echo "======================================"

# Load environment variables if .env file exists
if [ -f ".env" ]; then
    log_info "Loading environment variables from .env file..."
    set -a  # automatically export all variables
    source .env
    set +a
fi

# Set default environment variables if not already set
export NODE_ENV=${NODE_ENV:-production}
export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-3030}
export BASE_URL=${BASE_URL:-http://localhost:3030}
export JWT_SECRET=${JWT_SECRET:-please-change-this-secret}

# Use external database if DB_PATH is set
if [ -n "$DB_PATH" ]; then
    log_info "Using external database: $DB_PATH"
    # Ensure the directory exists
    DB_DIR=$(dirname "$DB_PATH")
    if [ ! -d "$DB_DIR" ]; then
        log_info "Creating database directory: $DB_DIR"
        sudo mkdir -p "$DB_DIR"
        sudo chown $USER:$USER "$DB_DIR"
        log_success "Database directory created"
    fi
fi

echo "Environment:"
echo "  NODE_ENV: $NODE_ENV"
echo "  HOST: $HOST"
echo "  PORT: $PORT"
echo "  BASE_URL: $BASE_URL"
if [ -n "$DB_PATH" ]; then
    echo "  DB_PATH: $DB_PATH"
fi
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    log_error "Dependencies not installed!"
    log_info "This should be handled by auto-update.sh or setup.sh"
    exit 1
fi

# Check if database exists (either local or external)
DB_FILE="${DB_PATH:-database.sqlite}"
if [ ! -f "$DB_FILE" ]; then
    log_error "Warning: Database not found at $DB_FILE"
    log_info "It will be created on first run if schema is available"
fi

# Check if course documentation has been built
COURSES_DIR="$SCRIPT_DIR/courses"
COURSES_FOUND=0
for course_dir in "$COURSES_DIR"/*; do
    if [ -d "$course_dir" ] && [ -f "$course_dir/mkdocs.yml" ]; then
        if [ -d "$course_dir/site" ]; then
            COURSES_FOUND=$((COURSES_FOUND + 1))
        fi
    fi
done

if [ $COURSES_FOUND -eq 0 ]; then
    log_info "Note: No built course documentation found"
    log_info "Auto-update script will build documentation on next update"
else
    log_success "Found $COURSES_FOUND built course(s)"
fi

echo ""
log_success "Starting Node.js server..."
echo "======================================"
echo ""

# Start the server (use exec to replace the shell process)
exec node server.js
