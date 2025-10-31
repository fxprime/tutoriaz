#!/bin/bash

# Test Service Script
# This script tests the service startup WITHOUT blocking your terminal

echo "======================================"
echo "Testing Tutoriaz Service Configuration"
echo "======================================"
echo ""

# Check if service file exists
if [ ! -f "tutoriaz.service" ]; then
    echo "❌ tutoriaz.service not found in current directory"
    exit 1
fi

echo "✓ Service file found"
echo ""

# Check if systemd service is installed
if systemctl list-unit-files | grep -q "tutoriaz.service"; then
    echo "✓ Service is installed in systemd"
    
    # Check service status
    if systemctl is-active --quiet tutoriaz; then
        echo "✓ Service is currently RUNNING"
        echo ""
        echo "To view logs:"
        echo "  sudo journalctl -u tutoriaz -f"
        echo ""
        echo "To restart service:"
        echo "  sudo systemctl restart tutoriaz"
        echo ""
        echo "To stop service:"
        echo "  sudo systemctl stop tutoriaz"
    else
        echo "⚠ Service is installed but NOT running"
        echo ""
        echo "To start service:"
        echo "  sudo systemctl start tutoriaz"
    fi
    
    echo ""
    echo "Service status:"
    sudo systemctl status tutoriaz --no-pager -l
else
    echo "⚠ Service is NOT installed in systemd"
    echo ""
    echo "To install service:"
    echo "  sudo cp tutoriaz.service /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable tutoriaz"
    echo "  sudo systemctl start tutoriaz"
fi

echo ""
echo "======================================"
echo ""
echo "Note: Do NOT run 'bash startByService.sh' directly!"
echo "That script is meant to be executed by systemd only."
echo ""
echo "For local development, use:"
echo "  npm start        (or bash start.sh)"
echo ""
echo "For production, use systemd:"
echo "  sudo systemctl start tutoriaz"
echo "======================================"
