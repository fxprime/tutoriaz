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
    git submodule update --init --recursive 2>/dev/null || {
        log_info "Note: Could not initialize submodules"
    }
    
    # Update each submodule with proper branch detection
    git submodule foreach '
        git fetch origin 2>/dev/null
        # Determine the default branch
        if git ls-remote --heads origin main 2>/dev/null | grep -q main; then
            BRANCH="main"
        elif git ls-remote --heads origin master 2>/dev/null | grep -q master; then
            BRANCH="master"
        else
            BRANCH="main"  # fallback
        fi
        
        # Checkout the branch first to avoid detached HEAD
        git checkout $BRANCH 2>/dev/null || git checkout -b $BRANCH origin/$BRANCH 2>/dev/null || true
        
        # Pull latest changes
        git pull origin $BRANCH 2>/dev/null || true
    ' 2>/dev/null || log_info "Note: Could not update some submodules"
    
    log_success "Course repositories updated"
else
    log_info "No course submodules configured yet"
fi

# Build course documentation
COURSES_DIR="$SCRIPT_DIR/courses"
VENV_DIR="$COURSES_DIR/venv"

log_info "Building course documentation..."
COURSES_BUILT=0

# Auto-create shared venv and install mkdocs if nothing is available
if [ ! -f "$VENV_DIR/bin/activate" ] && ! command -v mkdocs &>/dev/null; then
    log_info "No mkdocs found — creating shared virtual environment..."
    PYTHON_BIN=""
    for py in python3 python; do
        if command -v "$py" &>/dev/null; then
            PYTHON_BIN="$py"
            break
        fi
    done

    if [ -n "$PYTHON_BIN" ]; then
        if "$PYTHON_BIN" -m venv "$VENV_DIR" 2>/dev/null; then
            log_info "Installing mkdocs into shared venv..."
            "$VENV_DIR/bin/pip" install --quiet mkdocs mkdocs-material 2>/dev/null \
                && log_success "mkdocs installed successfully" \
                || log_info "mkdocs install had warnings (may still work)"
        else
            log_info "Could not create virtual environment — skipping doc builds"
        fi
    else
        log_info "Python not found — skipping doc builds"
    fi
fi

# Check each course directory
for course_dir in "$COURSES_DIR"/*; do
    if [ -d "$course_dir" ] && [ -f "$course_dir/mkdocs.yml" ]; then
        course_name=$(basename "$course_dir")
        log_info "Building docs for: $course_name"
        cd "$course_dir"

        # Determine which mkdocs to use (course venv > shared venv > system)
        MKDOCS_CMD=""
        NEEDS_DEACTIVATE=0

        if [ -f "$course_dir/.venv/bin/activate" ]; then
            source "$course_dir/.venv/bin/activate"
            MKDOCS_CMD="mkdocs"
            NEEDS_DEACTIVATE=1
        elif [ -f "$VENV_DIR/bin/activate" ]; then
            source "$VENV_DIR/bin/activate"
            MKDOCS_CMD="mkdocs"
            NEEDS_DEACTIVATE=1
        elif command -v mkdocs &>/dev/null; then
            MKDOCS_CMD="mkdocs"
        fi

        if [ -n "$MKDOCS_CMD" ]; then
            if $MKDOCS_CMD build --quiet 2>/dev/null; then
                log_success "Built documentation for $course_name"
                COURSES_BUILT=$((COURSES_BUILT + 1))
            else
                log_info "Could not build $course_name (continuing anyway)"
            fi
        else
            log_info "No mkdocs available for $course_name — skipping"
        fi

        [ $NEEDS_DEACTIVATE -eq 1 ] && deactivate
        cd "$SCRIPT_DIR"
    fi
done

if [ $COURSES_BUILT -eq 0 ]; then
    log_info "No courses found to build"
else
    log_success "Built documentation for $COURSES_BUILT course(s)"
fi

echo ""

# Ensure database directory exists (DB_PATH may point to /var/lib/tutoriaz or similar)
if [ -n "$DB_PATH" ]; then
    DB_DIR=$(dirname "$DB_PATH")
    if [ ! -d "$DB_DIR" ]; then
        log_info "Creating database directory: $DB_DIR"
        mkdir -p "$DB_DIR" 2>/dev/null || sudo mkdir -p "$DB_DIR" && sudo chown "$(whoami)" "$DB_DIR"
        if [ ! -d "$DB_DIR" ]; then
            log_info "Warning: Could not create $DB_DIR - server may fail to open database"
        fi
    fi
fi

log_success "Starting server..."
echo "======================================"
echo ""

# Start the server
exec node server.js
