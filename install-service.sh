#!/bin/bash

# Tutoriaz Systemd Service Installer
# Auto-generates and installs tutoriaz.service, tutoriaz-autoupdate.service,
# and tutoriaz-autoupdate.timer with values detected from the current environment.

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
hdr()  { echo -e "\n${CYAN}$1${NC}"; }

# ── Guard: must NOT run as root (sudo is called internally where needed) ───────
if [ "$EUID" -eq 0 ]; then
    err "Do not run as root. Run as your regular user; sudo is used internally."
    exit 1
fi

# ── Detect environment ─────────────────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CURRENT_USER="$(whoami)"
CURRENT_GROUP="$(id -gn)"

# Detect primary LAN IP (skip loopback)
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr eth0 2>/dev/null || echo '127.0.0.1')"
fi

# Generate a random 48-char JWT secret if not already in .env
if [ -f "$SCRIPT_DIR/.env" ]; then
    EXISTING_SECRET="$(grep -E '^JWT_SECRET=' "$SCRIPT_DIR/.env" 2>/dev/null | cut -d'=' -f2-)"
fi
JWT_SECRET="${EXISTING_SECRET:-$(openssl rand -hex 24)}"

hdr "===== Tutoriaz Service Installer ====="
echo ""
echo "Detected values:"
echo "  User            : $CURRENT_USER"
echo "  Group           : $CURRENT_GROUP"
echo "  Working dir     : $SCRIPT_DIR"
echo "  Server IP       : $SERVER_IP"
echo "  JWT secret      : ${JWT_SECRET:0:8}... (truncated)"
echo ""

# ── Ask for overrides ─────────────────────────────────────────────────────────
read -p "Port to listen on [3030]: " PORT_INPUT
PORT="${PORT_INPUT:-3030}"

read -p "Server IP or hostname [$SERVER_IP]: " IP_INPUT
SERVER_IP="${IP_INPUT:-$SERVER_IP}"

read -p "Node environment (production/development) [production]: " NODE_ENV_INPUT
NODE_ENV="${NODE_ENV_INPUT:-production}"

read -p "DB path [/var/lib/tutoriaz/database.sqlite]: " DB_PATH_INPUT
DB_PATH="${DB_PATH_INPUT:-/var/lib/tutoriaz/database.sqlite}"

read -p "Auto-update check interval in minutes [5]: " INTERVAL_INPUT
INTERVAL="${INTERVAL_INPUT:-5}"

echo ""
echo "Final configuration:"
echo "  User            : $CURRENT_USER ($CURRENT_GROUP)"
echo "  Working dir     : $SCRIPT_DIR"
echo "  Port            : $PORT"
echo "  Base URL        : http://$SERVER_IP:$PORT"
echo "  Node env        : $NODE_ENV"
echo "  DB path         : $DB_PATH"
echo "  Update interval : ${INTERVAL} min"
echo ""
read -p "Install with these settings? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Cancelled."
    exit 0
fi

# ── Generate tutoriaz.service ─────────────────────────────────────────────────
hdr "Generating tutoriaz.service …"

cat > /tmp/tutoriaz.service <<EOF
[Unit]
Description=Tutoriaz Quiz Server
Documentation=https://github.com/fxprime/tutoriaz
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_GROUP
WorkingDirectory=$SCRIPT_DIR

# Environment variables
Environment=NODE_ENV=$NODE_ENV
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
Environment=BASE_URL=http://$SERVER_IP:$PORT
Environment=JWT_SECRET=$JWT_SECRET
Environment=DB_PATH=$DB_PATH

# Start script
ExecStart=/bin/bash $SCRIPT_DIR/startByService.sh

# Restart policy
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tutoriaz

# Security
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

ok "Generated tutoriaz.service"

# ── Generate tutoriaz-autoupdate.service ──────────────────────────────────────
hdr "Generating tutoriaz-autoupdate.service …"

cat > /tmp/tutoriaz-autoupdate.service <<EOF
[Unit]
Description=Tutoriaz Auto-Update Service
After=network.target

[Service]
Type=oneshot
User=$CURRENT_USER
Group=$CURRENT_GROUP
ExecStart=/bin/bash $SCRIPT_DIR/auto-update.sh
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tutoriaz-autoupdate
EOF

ok "Generated tutoriaz-autoupdate.service"

# ── Generate tutoriaz-autoupdate.timer ────────────────────────────────────────
hdr "Generating tutoriaz-autoupdate.timer …"

cat > /tmp/tutoriaz-autoupdate.timer <<EOF
[Unit]
Description=Check for Tutoriaz updates every ${INTERVAL} minutes
Requires=tutoriaz-autoupdate.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL}min

[Install]
WantedBy=timers.target
EOF

ok "Generated tutoriaz-autoupdate.timer"

# ── Install services ──────────────────────────────────────────────────────────
hdr "Installing systemd units …"

sudo cp /tmp/tutoriaz.service             /etc/systemd/system/tutoriaz.service
sudo cp /tmp/tutoriaz-autoupdate.service  /etc/systemd/system/tutoriaz-autoupdate.service
sudo cp /tmp/tutoriaz-autoupdate.timer    /etc/systemd/system/tutoriaz-autoupdate.timer

rm -f /tmp/tutoriaz.service /tmp/tutoriaz-autoupdate.service /tmp/tutoriaz-autoupdate.timer

ok "Copied units to /etc/systemd/system/"

# Ensure DB directory exists
DB_DIR="$(dirname "$DB_PATH")"
if [ ! -d "$DB_DIR" ]; then
    info "Creating DB directory: $DB_DIR"
    sudo mkdir -p "$DB_DIR"
    sudo chown "$CURRENT_USER:$CURRENT_GROUP" "$DB_DIR"
    ok "Created $DB_DIR"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/startByService.sh" "$SCRIPT_DIR/auto-update.sh" 2>/dev/null || true

# ── Reload & enable ───────────────────────────────────────────────────────────
hdr "Enabling services …"

sudo systemctl daemon-reload
sudo systemctl enable tutoriaz.service
sudo systemctl enable tutoriaz-autoupdate.timer
sudo systemctl start  tutoriaz-autoupdate.timer

ok "tutoriaz.service enabled (start it with: sudo systemctl start tutoriaz)"
ok "tutoriaz-autoupdate.timer enabled and started"

# ── Save generated JWT secret to .env if missing ─────────────────────────────
if [ -z "$EXISTING_SECRET" ] && [ -n "$JWT_SECRET" ]; then
    if [ -f "$SCRIPT_DIR/.env" ]; then
        echo "JWT_SECRET=$JWT_SECRET" >> "$SCRIPT_DIR/.env"
    else
        echo "JWT_SECRET=$JWT_SECRET" > "$SCRIPT_DIR/.env"
    fi
    ok "JWT_SECRET saved to .env"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
hdr "===== Installation complete ====="
echo ""
echo "Start the server  : sudo systemctl start tutoriaz"
echo "Server status     : sudo systemctl status tutoriaz"
echo "Server logs       : sudo journalctl -u tutoriaz -f"
echo ""
echo "Update timer status: sudo systemctl status tutoriaz-autoupdate.timer"
echo "Update logs        : sudo journalctl -u tutoriaz-autoupdate -f"
echo ""
