#!/bin/bash

# Tutoriaz Auto-Update Script
# This script checks for new commits and automatically updates the application

set -e

# Configuration
REPO_DIR="/home/thanabadeebulunseechart/learning/tutoriaz"  # UPDATE THIS
BRANCH="main"
SERVICE_NAME="tutoriaz"  # or use PM2 process name
USE_PM2=false  # Set to true if using PM2, false for systemd
LOG_FILE="/var/log/tutoriaz-autoupdate.log"

# Change to repo directory
cd "$REPO_DIR"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "===== Checking for updates ====="

# Fetch latest changes
git fetch origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"

# Get current and remote commit hashes
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/$BRANCH)

log "Local commit:  $LOCAL_COMMIT"
log "Remote commit: $REMOTE_COMMIT"

# Check if update is needed
if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    log "Already up to date. No update needed."
    exit 0
fi

log "New commit detected! Starting update process..."

# Backup database (if it exists in repo - shouldn't if DB_PATH is set correctly)
if [ -f "$REPO_DIR/database.sqlite" ]; then
    log "WARNING: Found database in repo directory. Backing up..."
    cp "$REPO_DIR/database.sqlite" "$REPO_DIR/database.sqlite.backup.$(date +%s)"
fi

# Pull latest changes (force to overwrite local changes)
log "Pulling latest changes..."
git reset --hard origin/$BRANCH 2>&1 | tee -a "$LOG_FILE"

# Update submodules (for course documentation)
log "Updating git submodules..."
git submodule update --init --recursive 2>&1 | tee -a "$LOG_FILE"
git submodule foreach 'git fetch && git pull origin main || git pull origin master' 2>&1 | tee -a "$LOG_FILE"

# Build MkDocs documentation
log "Building course documentation..."
COURSES_DIR="$REPO_DIR/courses"
VENV_DIR="$COURSES_DIR/venv"

# Setup shared virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    log "Creating shared virtual environment for all courses"
    python3 -m venv "$VENV_DIR" 2>&1 | tee -a "$LOG_FILE"
fi

# Activate virtual environment once
log "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Install/upgrade mkdocs if needed
log "Installing/upgrading MkDocs packages..."
pip install --upgrade mkdocs mkdocs-material 2>&1 | tee -a "$LOG_FILE"

# Build documentation for all courses
for course_dir in "$COURSES_DIR"/*; do
    if [ -d "$course_dir" ] && [ -f "$course_dir/mkdocs.yml" ]; then
        course_name=$(basename "$course_dir")
        log "Building docs for course: $course_name"
        cd "$course_dir"
        mkdocs build 2>&1 | tee -a "$LOG_FILE"
        log "✓ Documentation built for $course_name"
        cd "$REPO_DIR"
    fi
done

# Deactivate virtual environment
deactivate
log "✓ All course documentation built successfully"

# Install/update dependencies
log "Installing dependencies..."
npm install --production 2>&1 | tee -a "$LOG_FILE"

# Restart the service
log "Restarting application..."
if [ "$USE_PM2" = true ]; then
    # Using PM2
    pm2 restart "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"
    log "Application restarted with PM2"
else
    # Using systemd
    sudo systemctl restart "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"
    log "Application restarted with systemd"
fi

# Wait a moment and check if service is running
sleep 3

if [ "$USE_PM2" = true ]; then
    if pm2 info "$SERVICE_NAME" | grep -q "online"; then
        log "✓ Update successful! Application is running."
    else
        log "✗ ERROR: Application failed to start after update!"
        exit 1
    fi
else
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "✓ Update successful! Application is running."
    else
        log "✗ ERROR: Application failed to start after update!"
        exit 1
    fi
fi

log "===== Update complete ====="
