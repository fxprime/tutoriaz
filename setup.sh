#!/bin/bash

# Tutoriaz Setup Script
# This script sets up the application for first-time installation or after fresh clone

set -e

echo "===== Tutoriaz Setup Script ====="
echo ""

# Get the directory where the script is located
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

# Check Node.js installation
log_info "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi
NODE_VERSION=$(node -v)
log_success "Node.js $NODE_VERSION found"

# Check npm installation
log_info "Checking npm installation..."
if ! command -v npm &> /dev/null; then
    log_error "npm is not installed. Please install npm first."
    exit 1
fi
NPM_VERSION=$(npm -v)
log_success "npm $NPM_VERSION found"

# Check Python installation
log_info "Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    log_error "Python 3 is not installed. Please install Python 3 for MkDocs documentation."
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
log_success "$PYTHON_VERSION found"

# Install Node.js dependencies
echo ""
log_info "Installing Node.js dependencies..."
npm install
log_success "Node.js dependencies installed"

# Initialize and update git submodules
echo ""
log_info "Initializing git submodules (course repositories)..."
if [ -f ".gitmodules" ]; then
    log_info "Updating course submodules..."
    git submodule update --init --recursive 2>/dev/null || {
        log_info "Note: Could not initialize submodules"
    }
    
    # Update each submodule with proper branch detection
    git submodule foreach '
        git fetch origin 2>/dev/null
        if git ls-remote --heads origin main 2>/dev/null | grep -q main; then
            git pull origin main 2>/dev/null || true
        elif git ls-remote --heads origin master 2>/dev/null | grep -q master; then
            git pull origin master 2>/dev/null || true
        fi
    ' 2>/dev/null || log_info "Note: Could not update some submodules"
    
    log_success "Git submodules initialized and updated"
else
    log_info "No submodules found (this is OK if no courses added yet)"
fi

# Setup Python virtual environment for courses
echo ""
COURSES_DIR="$SCRIPT_DIR/courses"
VENV_DIR="$COURSES_DIR/venv"

if [ ! -d "$COURSES_DIR" ]; then
    log_info "Creating courses directory..."
    mkdir -p "$COURSES_DIR"
fi

log_info "Setting up Python virtual environment for course documentation..."
if [ -d "$VENV_DIR" ]; then
    log_info "Virtual environment already exists, skipping creation"
else
    python3 -m venv "$VENV_DIR"
    log_success "Virtual environment created at courses/venv"
fi

# Activate virtual environment and install MkDocs
log_info "Installing MkDocs and dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install mkdocs mkdocs-material
deactivate
log_success "MkDocs installed in virtual environment"

# Build course documentation
echo ""
log_info "Building course documentation..."
COURSES_BUILT=0

source "$VENV_DIR/bin/activate"

# Build documentation for all courses
for course_dir in "$COURSES_DIR"/*; do
    if [ -d "$course_dir" ] && [ "$course_dir" != "$VENV_DIR" ] && [ -f "$course_dir/mkdocs.yml" ]; then
        course_name=$(basename "$course_dir")
        log_info "Building docs for: $course_name"
        cd "$course_dir"
        if mkdocs build 2>/dev/null; then
            log_success "Documentation built for $course_name"
            COURSES_BUILT=$((COURSES_BUILT + 1))
        else
            log_info "Could not build $course_name (continuing anyway)"
        fi
        cd "$SCRIPT_DIR"
    fi
done

deactivate

if [ $COURSES_BUILT -eq 0 ]; then
    log_info "No courses with mkdocs.yml found (this is OK if no courses added yet)"
else
    log_success "Built documentation for $COURSES_BUILT course(s)"
fi

# Initialize database
echo ""
log_info "Setting up database..."

# Check if DB_PATH is set in .env
if [ -f ".env" ]; then
    # Load DB_PATH from .env if it exists
    DB_PATH=$(grep -E "^DB_PATH=" .env 2>/dev/null | cut -d'=' -f2-)
fi

# Determine which database location to check
DB_FILE="${DB_PATH:-database.sqlite}"

if [ -f "$DB_FILE" ]; then
    log_info "Database already exists at: $DB_FILE"
    log_info "Run 'npm run bootstrap' to reset with demo data."
else
    log_info "Bootstrapping database at: $DB_FILE"
    
    # If using external DB_PATH, ensure directory exists
    if [ -n "$DB_PATH" ]; then
        DB_DIR=$(dirname "$DB_PATH")
        if [ ! -d "$DB_DIR" ]; then
            log_info "Creating database directory: $DB_DIR"
            sudo mkdir -p "$DB_DIR"
            sudo chown $USER:$USER "$DB_DIR"
        fi
    fi
    
    npm run bootstrap
    
    if [ -f "$DB_FILE" ]; then
        log_success "Database initialized with demo accounts at: $DB_FILE"
    else
        log_error "Warning: Database not found after bootstrap"
    fi
fi

# Create .env file if it doesn't exist
echo ""
if [ ! -f ".env" ]; then
    log_info "Creating .env file from example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        log_success ".env file created. Please review and update as needed."
    else
        log_info "No .env.example found, skipping .env creation"
    fi
else
    log_info ".env file already exists"
fi

# Summary
echo ""
echo "===== Setup Complete ====="
echo ""
log_success "Application is ready to run!"
echo ""
echo "Next steps:"
echo "  1. Review and update .env file if needed"
echo "  2. Run 'npm start' to start the server"
echo "  3. Open http://localhost:3030 in your browser"
echo ""
echo "Demo accounts (if bootstrapped):"
echo "  Teacher: username='teacher', password='admin123'"
echo "  Students: username='student1-50', password='student123'"
echo ""
