#!/bin/bash

# Tutoriaz Auto-Update Setup Script
# Run this script to configure automatic updates for your Tutoriaz installation

set -e

echo "======================================"
echo "Tutoriaz Auto-Update Setup"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "Please do not run this script as root. Run as your regular user."
   exit 1
fi

# Get current directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$SCRIPT_DIR"

echo "Repository directory: $REPO_DIR"
echo ""

# Ask for configuration
read -p "Enter the git branch to track [main]: " BRANCH
BRANCH=${BRANCH:-main}

read -p "Are you using PM2? (y/n) [n]: " USE_PM2_INPUT
if [[ "$USE_PM2_INPUT" =~ ^[Yy]$ ]]; then
    USE_PM2="true"
    read -p "Enter PM2 process name [tutoriaz]: " SERVICE_NAME
    SERVICE_NAME=${SERVICE_NAME:-tutoriaz}
else
    USE_PM2="false"
    read -p "Enter systemd service name [tutoriaz]: " SERVICE_NAME
    SERVICE_NAME=${SERVICE_NAME:-tutoriaz}
fi

read -p "Enter path for log file [/var/log/tutoriaz-autoupdate.log]: " LOG_FILE
LOG_FILE=${LOG_FILE:-/var/log/tutoriaz-autoupdate.log}

read -p "Update check interval in minutes [5]: " INTERVAL
INTERVAL=${INTERVAL:-5}

echo ""
echo "Configuration:"
echo "  Repository: $REPO_DIR"
echo "  Branch: $BRANCH"
echo "  Service Manager: $([ "$USE_PM2" = "true" ] && echo "PM2" || echo "systemd")"
echo "  Service/Process Name: $SERVICE_NAME"
echo "  Log File: $LOG_FILE"
echo "  Check Interval: $INTERVAL minutes"
echo ""
read -p "Continue with this configuration? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled."
    exit 1
fi

# Update auto-update.sh with configuration
echo "Configuring auto-update script..."
sed -i.bak \
    -e "s|REPO_DIR=\".*\"|REPO_DIR=\"$REPO_DIR\"|" \
    -e "s|BRANCH=\".*\"|BRANCH=\"$BRANCH\"|" \
    -e "s|SERVICE_NAME=\".*\"|SERVICE_NAME=\"$SERVICE_NAME\"|" \
    -e "s|USE_PM2=.*|USE_PM2=$USE_PM2|" \
    -e "s|LOG_FILE=\".*\"|LOG_FILE=\"$LOG_FILE\"|" \
    "$REPO_DIR/auto-update.sh"

# Make scripts executable
chmod +x "$REPO_DIR/auto-update.sh"
chmod +x "$REPO_DIR/start.sh"

# Create log file and set permissions
sudo touch "$LOG_FILE"
sudo chown $(whoami):$(whoami) "$LOG_FILE"

# Test the auto-update script
echo ""
echo "Testing auto-update script..."
if bash "$REPO_DIR/auto-update.sh"; then
    echo "✓ Auto-update script test successful!"
else
    echo "✗ Auto-update script test failed. Please check the configuration."
    exit 1
fi

# Setup systemd timer
echo ""
read -p "Do you want to setup systemd timer for automatic updates? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Update service file with correct paths and user
    sed -i.bak \
        -e "s|User=.*|User=$(whoami)|" \
        -e "s|Group=.*|Group=$(whoami)|" \
        -e "s|ExecStart=.*|ExecStart=/bin/bash $REPO_DIR/auto-update.sh|" \
        "$REPO_DIR/tutoriaz-autoupdate.service"
    
    # Update timer file with interval
    sed -i.bak \
        -e "s|OnUnitActiveSec=.*|OnUnitActiveSec=${INTERVAL}min|" \
        "$REPO_DIR/tutoriaz-autoupdate.timer"
    
    # Install service and timer
    sudo cp "$REPO_DIR/tutoriaz-autoupdate.service" /etc/systemd/system/
    sudo cp "$REPO_DIR/tutoriaz-autoupdate.timer" /etc/systemd/system/
    
    # Reload systemd
    sudo systemctl daemon-reload
    
    # Enable and start timer
    sudo systemctl enable tutoriaz-autoupdate.timer
    sudo systemctl start tutoriaz-autoupdate.timer
    
    echo "✓ Systemd timer installed and started!"
    echo ""
    echo "Timer status:"
    sudo systemctl status tutoriaz-autoupdate.timer
fi

# Setup cron job alternative
echo ""
read -p "Do you want to setup a cron job instead? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    CRON_LINE="*/$INTERVAL * * * * /bin/bash $REPO_DIR/auto-update.sh >> $LOG_FILE 2>&1"
    (crontab -l 2>/dev/null | grep -v "auto-update.sh"; echo "$CRON_LINE") | crontab -
    echo "✓ Cron job added!"
    echo "Cron entry: $CRON_LINE"
fi

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Auto-update is now configured. Your Tutoriaz installation will"
echo "automatically check for updates every $INTERVAL minutes."
echo ""
echo "Useful commands:"
echo "  # View update logs"
echo "  tail -f $LOG_FILE"
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "  # Check timer status"
    echo "  sudo systemctl status tutoriaz-autoupdate.timer"
    echo ""
    echo "  # View timer logs"
    echo "  sudo journalctl -u tutoriaz-autoupdate -f"
    echo ""
    echo "  # Manually trigger update"
    echo "  sudo systemctl start tutoriaz-autoupdate.service"
else
    echo "  # View cron jobs"
    echo "  crontab -l"
    echo ""
    echo "  # Edit cron jobs"
    echo "  crontab -e"
fi
echo ""
echo "  # Manually run update"
echo "  bash $REPO_DIR/auto-update.sh"
echo ""
