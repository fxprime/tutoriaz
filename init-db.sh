#!/bin/bash

# Initialize Database Script
# This script initializes or resets the database with demo data
# Respects DB_PATH environment variable

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_info() { echo -e "${YELLOW}→${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo "======================================"
echo "Initialize Tutoriaz Database"
echo "======================================"
echo ""

# Load environment variables if .env exists
if [ -f ".env" ]; then
    log_info "Loading environment variables from .env..."
    set -a
    source .env
    set +a
fi

# Determine database location
DB_FILE="${DB_PATH:-database.sqlite}"

echo "Database location: $DB_FILE"
echo ""

# If using external path, ensure directory exists
if [ -n "$DB_PATH" ]; then
    DB_DIR=$(dirname "$DB_PATH")
    if [ ! -d "$DB_DIR" ]; then
        log_info "Creating database directory: $DB_DIR"
        sudo mkdir -p "$DB_DIR"
        sudo chown $USER:$USER "$DB_DIR"
        log_success "Directory created"
    fi
fi

# Check if database exists
if [ -f "$DB_FILE" ]; then
    log_error "WARNING: Database already exists at: $DB_FILE"
    read -p "Do you want to WIPE and recreate it with demo data? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Aborted. Database unchanged."
        exit 0
    fi
    log_info "Removing existing database..."
    rm -f "$DB_FILE"
fi

# Run bootstrap script
log_info "Running bootstrap script..."
npm run bootstrap

# Verify database was created
if [ -f "$DB_FILE" ]; then
    log_success "Database initialized successfully!"
    echo ""
    echo "Demo accounts created:"
    echo "  Teacher: username='teacher', password='admin123'"
    echo "  Students: username='student1' to 'student50', password='student123'"
    echo ""
    
    # Show database info
    DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
    echo "Database file: $DB_FILE ($DB_SIZE)"
else
    log_error "ERROR: Database was not created at expected location!"
    log_info "Expected: $DB_FILE"
    
    # Check if it was created in repo directory instead
    if [ -f "$SCRIPT_DIR/database.sqlite" ] && [ "$DB_FILE" != "$SCRIPT_DIR/database.sqlite" ]; then
        log_error "Database was created at: $SCRIPT_DIR/database.sqlite"
        log_info "This means the bootstrap script did not respect DB_PATH"
        echo ""
        read -p "Move it to the correct location? (yes/no): " move_confirm
        if [ "$move_confirm" = "yes" ]; then
            mv "$SCRIPT_DIR/database.sqlite" "$DB_FILE"
            log_success "Database moved to: $DB_FILE"
        fi
    fi
fi

echo ""
echo "======================================"
