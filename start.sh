#!/bin/bash

# Tutoriaz Startup Script
# This script ensures proper environment setup and builds course documentation before starting the server

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output
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
echo "Starting Tutoriaz Server"
echo "======================================"

# Load environment variables if .env file exists
if [ -f ".env" ]; then
    log_info "Loading environment variables from .env file..."
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
    log_info "Dependencies not installed. Running npm install..."
    npm install --production
    log_success "Dependencies installed"
fi

# Check if database exists
if [ ! -f "database.sqlite" ]; then
    log_error "Warning: database.sqlite not found. It will be created on first run."
fi

# Initialize and update git submodules
log_info "Checking course repositories..."
if [ -f ".gitmodules" ]; then
    log_info "Updating course submodules..."
    git submodule update --init --recursive --remote 2>/dev/null || {
        log_info "Note: Could not update submodules (this is OK if already up to date)"
    }
    log_success "Course repositories updated"
else
    log_info "No course submodules configured yet"
fi

# Build course documentation
COURSES_DIR="$SCRIPT_DIR/courses"
VENV_DIR="$COURSES_DIR/venv"

if [ -d "$VENV_DIR" ]; then
    log_info "Building course documentation..."
    COURSES_BUILT=0
    
    source "$VENV_DIR/bin/activate"
    
    for course_dir in "$COURSES_DIR"/*; do
        if [ -d "$course_dir" ] && [ "$course_dir" != "$VENV_DIR" ] && [ -f "$course_dir/mkdocs.yml" ]; then
            course_name=$(basename "$course_dir")
            log_info "Building docs for: $course_name"
            cd "$course_dir"
            if mkdocs build --quiet 2>/dev/null; then
                log_success "Built documentation for $course_name"
                COURSES_BUILT=$((COURSES_BUILT + 1))
            else
                log_info "Could not build $course_name (continuing anyway)"
            fi
            cd "$SCRIPT_DIR"
        fi
    done
    
    deactivate
    
    if [ $COURSES_BUILT -eq 0 ]; then
        log_info "No courses found to build"
    else
        log_success "Built documentation for $COURSES_BUILT course(s)"
    fi
else
    log_info "Python virtual environment not found. Run './setup.sh' to set up courses."
    log_info "Server will start without building documentation."
fi

echo ""
log_success "Starting server..."
echo "======================================"
echo ""

# Start the server
exec node server.js
