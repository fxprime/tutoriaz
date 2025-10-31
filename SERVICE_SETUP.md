# Systemd Service Installation Guide

## Quick Setup

### 1. Prepare the Service File

Edit `tutoriaz.service` and update these values:
- `User=YOUR_USERNAME` → Your Linux username
- `Group=YOUR_USERNAME` → Your Linux group (usually same as username)
- `WorkingDirectory=/path/to/tutoriaz` → Full path to your tutoriaz directory
- `ExecStart=/path/to/tutoriaz/server.js` → Full path to server.js
- `BASE_URL=http://YOUR_SERVER_IP:3030` → Your actual server URL
- `JWT_SECRET=...` → A secure random string
- `ReadWritePaths=/path/to/tutoriaz` → Full path to your tutoriaz directory

### 2. Install the Service

```bash
# Make start script executable
chmod +x /path/to/tutoriaz/start.sh

# Copy service file to systemd directory
sudo cp tutoriaz.service /etc/systemd/system/

# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable tutoriaz

# Start the service
sudo systemctl start tutoriaz

# Check status
sudo systemctl status tutoriaz
```

## Service Management Commands

```bash
# Start service
sudo systemctl start tutoriaz

# Stop service
sudo systemctl stop tutoriaz

# Restart service
sudo systemctl restart tutoriaz

# Check status
sudo systemctl status tutoriaz

# View logs (live)
sudo journalctl -u tutoriaz -f

# View recent logs
sudo journalctl -u tutoriaz -n 100

# Disable auto-start on boot
sudo systemctl disable tutoriaz

# Enable auto-start on boot
sudo systemctl enable tutoriaz
```

## Alternative: Using Environment File

### 1. Create .env file

```bash
cd /path/to/tutoriaz
cp .env.example .env
nano .env
```

Update the values in `.env`:
```
NODE_ENV=production
HOST=0.0.0.0
PORT=3030
BASE_URL=https://tutoriaz.yourdomain.com
JWT_SECRET=your-very-secure-random-string-here
```

### 2. Update service to use .env

Edit `/etc/systemd/system/tutoriaz.service`:

```ini
[Service]
# Comment out individual Environment lines
# Environment=NODE_ENV=production
# Environment=HOST=0.0.0.0
# ...

# Use environment file instead
EnvironmentFile=/path/to/tutoriaz/.env

ExecStart=/bin/bash /path/to/tutoriaz/start.sh
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart tutoriaz
```

## Using PM2 (Alternative to Systemd)

PM2 is easier to set up and includes monitoring:

```bash
# Install PM2 globally
npm install -g pm2

# Start tutoriaz with PM2
cd /path/to/tutoriaz
pm2 start start.sh --name tutoriaz --interpreter bash

# Or start server.js directly
pm2 start server.js --name tutoriaz

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions it prints

# Useful PM2 commands
pm2 list              # List all processes
pm2 logs tutoriaz     # View logs
pm2 restart tutoriaz  # Restart
pm2 stop tutoriaz     # Stop
pm2 delete tutoriaz   # Remove from PM2
pm2 monit            # Monitor CPU/RAM
```

## Complete Installation Example (Ubuntu/Debian)

```bash
# 1. Navigate to installation directory
cd ~
git clone https://github.com/fxprime/tutoriaz.git
cd tutoriaz

# 2. Initialize git submodules (for course documentation)
git submodule init
git submodule update --recursive --remote

# 3. Install dependencies
npm install --production

# 4. Create environment file
cp .env.example .env
nano .env
# Update: BASE_URL, JWT_SECRET

# 5. Make start script executable
chmod +x start.sh

# 6. Edit service file
nano tutoriaz.service
# Update: User, WorkingDirectory, ExecStart, ReadWritePaths

# 7. Install and start service
sudo cp tutoriaz.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tutoriaz
sudo systemctl start tutoriaz

# 8. Check status
sudo systemctl status tutoriaz

# 9. View logs
sudo journalctl -u tutoriaz -f

# 10. Open firewall port (if needed)
sudo ufw allow 3030/tcp
```

## Troubleshooting

### Service won't start
```bash
# Check detailed error logs
sudo journalctl -u tutoriaz -xe

# Check if port is already in use
sudo netstat -tuln | grep 3030

# Verify file permissions
ls -la /path/to/tutoriaz/server.js

# Test running manually
cd /path/to/tutoriaz
./start.sh
```

### Permission denied errors
```bash
# Fix ownership
sudo chown -R YOUR_USERNAME:YOUR_USERNAME /path/to/tutoriaz

# Make scripts executable
chmod +x /path/to/tutoriaz/start.sh
```

### Database locked errors
```bash
# Make sure no other instance is running
ps aux | grep node

# Kill other instances
sudo systemctl stop tutoriaz
pkill -f "node server.js"

# Then restart
sudo systemctl start tutoriaz
```

## Nginx Reverse Proxy (Recommended for Production)

```nginx
# /etc/nginx/sites-available/tutoriaz
server {
    listen 80;
    server_name tutoriaz.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/tutoriaz /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d tutoriaz.yourdomain.com
```

Update BASE_URL in .env to use HTTPS:
```
BASE_URL=https://tutoriaz.yourdomain.com
```
