#!/bin/bash

# Tutoriaz Auto-Update Script
# This script checks for new commits and automatically updates the application

set -e

# Configuration
REPO_DIR="/path/to/tutoriaz"  # UPDATE THIS
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
git submodule update --recursive --remote 2>&1 | tee -a "$LOG_FILE"

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
