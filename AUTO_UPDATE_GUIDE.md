# Auto-Update Configuration Guide

## Overview

The auto-update system automatically checks for new commits on your GitHub repository and updates your Tutoriaz installation without manual intervention.

## Features

- ✅ Automatically detects new commits
- ✅ Pulls latest code with `git pull -f`
- ✅ Updates git submodules (course documentation)
- ✅ Installs new dependencies
- ✅ Restarts the application
- ✅ Preserves database (stores outside git directory)
- ✅ Logs all update activity
- ✅ Supports both PM2 and systemd

## Quick Setup

### Automated Setup (Recommended)

```bash
cd /path/to/tutoriaz
chmod +x setup-autoupdate.sh
./setup-autoupdate.sh
```

Follow the prompts to configure:
- Git branch to track (default: main)
- Service manager (PM2 or systemd)
- Service/process name
- Update check interval (default: 5 minutes)
- Log file location

### Manual Setup

#### 1. Configure Database Location (CRITICAL)

Store your database OUTSIDE the git directory to prevent data loss:

```bash
# Create database directory
sudo mkdir -p /var/lib/tutoriaz
sudo chown $(whoami):$(whoami) /var/lib/tutoriaz

# Copy existing database if it exists
if [ -f ~/tutoriaz/database.sqlite ]; then
    cp ~/tutoriaz/database.sqlite /var/lib/tutoriaz/
fi
```

Update your `.env` file:
```bash
cd /path/to/tutoriaz
nano .env
```

Add or update:
```
DB_PATH=/var/lib/tutoriaz/database.sqlite
```

#### 2. Configure Auto-Update Script

Edit `auto-update.sh`:
```bash
nano auto-update.sh
```

Update these lines:
```bash
REPO_DIR="/path/to/tutoriaz"  # Your tutoriaz installation path
BRANCH="main"                  # Git branch to track
SERVICE_NAME="tutoriaz"        # Service or PM2 process name
USE_PM2=false                  # true for PM2, false for systemd
LOG_FILE="/var/log/tutoriaz-autoupdate.log"
```

Make executable:
```bash
chmod +x auto-update.sh
```

#### 3. Setup Automatic Checking

**Option A: Using Systemd Timer (Recommended)**

```bash
# Edit service file
nano tutoriaz-autoupdate.service
# Update User, Group, and ExecStart path

# Edit timer file for custom interval
nano tutoriaz-autoupdate.timer
# Change OnUnitActiveSec=5min to your desired interval

# Install
sudo cp tutoriaz-autoupdate.service /etc/systemd/system/
sudo cp tutoriaz-autoupdate.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tutoriaz-autoupdate.timer
sudo systemctl start tutoriaz-autoupdate.timer

# Check status
sudo systemctl status tutoriaz-autoupdate.timer
```

**Option B: Using Cron**

```bash
# Edit crontab
crontab -e

# Add this line (checks every 5 minutes)
*/5 * * * * /bin/bash /path/to/tutoriaz/auto-update.sh >> /var/log/tutoriaz-autoupdate.log 2>&1

# Or check every 10 minutes
*/10 * * * * /bin/bash /path/to/tutoriaz/auto-update.sh >> /var/log/tutoriaz-autoupdate.log 2>&1

# Or check every hour
0 * * * * /bin/bash /path/to/tutoriaz/auto-update.sh >> /var/log/tutoriaz-autoupdate.log 2>&1
```

## Testing

### Test Auto-Update Manually

```bash
cd /path/to/tutoriaz
./auto-update.sh
```

Expected output:
```
[2025-10-31 10:00:00] ===== Checking for updates =====
[2025-10-31 10:00:01] Local commit:  abc123...
[2025-10-31 10:00:01] Remote commit: abc123...
[2025-10-31 10:00:01] Already up to date. No update needed.
```

If there's an update:
```
[2025-10-31 10:00:00] ===== Checking for updates =====
[2025-10-31 10:00:01] New commit detected! Starting update process...
[2025-10-31 10:00:02] Pulling latest changes...
[2025-10-31 10:00:03] Updating git submodules...
[2025-10-31 10:00:05] Installing dependencies...
[2025-10-31 10:00:15] Restarting application...
[2025-10-31 10:00:18] ✓ Update successful! Application is running.
[2025-10-31 10:00:18] ===== Update complete =====
```

## Monitoring

### View Update Logs

```bash
# Real-time log viewing
tail -f /var/log/tutoriaz-autoupdate.log

# View last 50 lines
tail -n 50 /var/log/tutoriaz-autoupdate.log

# View with systemd (if using timer)
sudo journalctl -u tutoriaz-autoupdate -f
```

### Check Timer Status

```bash
# Timer status
sudo systemctl status tutoriaz-autoupdate.timer

# List all timers
systemctl list-timers

# Check when next update is scheduled
systemctl list-timers tutoriaz-autoupdate.timer
```

### Manual Update Trigger

```bash
# Using systemd
sudo systemctl start tutoriaz-autoupdate.service

# Using script directly
cd /path/to/tutoriaz
./auto-update.sh
```

## Database Safety

### Why Store Database Outside Git Directory?

When using `git pull -f`, Git will overwrite ALL files in the directory. If your database is in the git directory, **IT WILL BE DELETED**.

### Recommended Database Locations

```bash
# System-wide (recommended for production)
/var/lib/tutoriaz/database.sqlite

# User directory
~/tutoriaz-data/database.sqlite

# Custom location
/mnt/data/tutoriaz/database.sqlite
```

### Verify Database Location

```bash
# Check what the app is using
cd /path/to/tutoriaz
grep DB_PATH .env

# Or check running process
ps aux | grep node
# Look for DB_PATH in environment
```

### Migrate Existing Database

```bash
# 1. Stop the service
sudo systemctl stop tutoriaz
# or
pm2 stop tutoriaz

# 2. Create new directory
sudo mkdir -p /var/lib/tutoriaz
sudo chown $(whoami):$(whoami) /var/lib/tutoriaz

# 3. Move database
mv /path/to/tutoriaz/database.sqlite /var/lib/tutoriaz/

# 4. Update configuration
echo "DB_PATH=/var/lib/tutoriaz/database.sqlite" >> /path/to/tutoriaz/.env

# 5. Start service
sudo systemctl start tutoriaz
# or
pm2 start tutoriaz
```

## Troubleshooting

### Update fails

```bash
# Check logs
tail -f /var/log/tutoriaz-autoupdate.log

# Check if git is working
cd /path/to/tutoriaz
git fetch origin main
git status

# Check if service can restart
sudo systemctl restart tutoriaz
# or
pm2 restart tutoriaz
```

### Database gets deleted

**This means DB_PATH is not set correctly!**

```bash
# Restore from backup (auto-update creates backups)
cd /path/to/tutoriaz
ls -la database.sqlite.backup.*

# Restore latest backup
cp database.sqlite.backup.TIMESTAMP /var/lib/tutoriaz/database.sqlite

# Fix DB_PATH in .env
echo "DB_PATH=/var/lib/tutoriaz/database.sqlite" >> .env

# Restart
sudo systemctl restart tutoriaz
```

### Permission denied errors

```bash
# Fix ownership
sudo chown -R $(whoami):$(whoami) /path/to/tutoriaz

# Fix database directory
sudo chown -R $(whoami):$(whoami) /var/lib/tutoriaz

# Fix log file
sudo chown $(whoami):$(whoami) /var/log/tutoriaz-autoupdate.log
```

### Timer not running

```bash
# Check if timer is enabled
systemctl is-enabled tutoriaz-autoupdate.timer

# Enable if not
sudo systemctl enable tutoriaz-autoupdate.timer

# Start timer
sudo systemctl start tutoriaz-autoupdate.timer

# Check for errors
sudo journalctl -u tutoriaz-autoupdate.timer -xe
```

## Advanced Configuration

### Custom Update Intervals

Edit `tutoriaz-autoupdate.timer`:
```ini
[Timer]
# Every 1 minute (for testing)
OnUnitActiveSec=1min

# Every 15 minutes
OnUnitActiveSec=15min

# Every hour
OnUnitActiveSec=1h

# Every day at 2 AM
OnCalendar=daily
OnCalendar=02:00
```

### Update Notifications

Add to `auto-update.sh` to send notifications:

```bash
# Email notification (requires mailutils)
if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo "Tutoriaz updated from $LOCAL_COMMIT to $REMOTE_COMMIT" | \
        mail -s "Tutoriaz Auto-Update" admin@example.com
fi

# Slack webhook
if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"Tutoriaz updated successfully!"}' \
        YOUR_SLACK_WEBHOOK_URL
fi
```

### Pre/Post Update Hooks

Add custom actions in `auto-update.sh`:

```bash
# Before update
log "Running pre-update hooks..."
# Your custom commands here
# Example: backup data, notify users, etc.

# After update
log "Running post-update hooks..."
# Your custom commands here
# Example: clear cache, warm up, etc.
```

## Complete Production Setup

```bash
# 1. Setup external database
sudo mkdir -p /var/lib/tutoriaz
sudo chown $(whoami):$(whoami) /var/lib/tutoriaz

# 2. Move existing database
mv ~/tutoriaz/database.sqlite /var/lib/tutoriaz/

# 3. Configure environment
cd ~/tutoriaz
cat > .env << EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3030
BASE_URL=https://tutoriaz.yourdomain.com
JWT_SECRET=$(openssl rand -hex 32)
DB_PATH=/var/lib/tutoriaz/database.sqlite
EOF

# 4. Setup auto-update
chmod +x setup-autoupdate.sh
./setup-autoupdate.sh

# 5. Verify everything works
./auto-update.sh
sudo systemctl status tutoriaz
tail -f /var/log/tutoriaz-autoupdate.log
```

## Summary

- ✅ Store database in `/var/lib/tutoriaz/` or similar (NOT in git directory)
- ✅ Set `DB_PATH` environment variable
- ✅ Configure `auto-update.sh` with your paths
- ✅ Setup systemd timer or cron job
- ✅ Monitor logs for update status
- ✅ Application will auto-update when you push to GitHub!
