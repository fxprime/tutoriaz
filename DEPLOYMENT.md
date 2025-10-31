# Production Deployment Guide

## Why Course Docs Don't Show Up

The main issue is the **HOST binding configuration**. By default, the server binds to `127.0.0.1` (localhost only), which prevents external network access.

### The Problem:
- `HOST=127.0.0.1` → Only accessible from the same machine (localhost)
- `HOST=0.0.0.0` → Accessible from external networks

## Solution

### Automatic (Recommended)
The server now automatically uses `0.0.0.0` when `NODE_ENV=production` is set.

### Manual Configuration
Set these environment variables on your server:

```bash
export NODE_ENV=production
export PORT=3030
export HOST=0.0.0.0
export BASE_URL=http://your-server-ip:3030
export JWT_SECRET=your-secure-secret-key
```

## Deployment Steps

### 1. On Your Server

**IMPORTANT**: The course documentation is a git submodule and must be initialized!

```bash
# Clone the repository
git clone https://github.com/fxprime/tutoriaz.git
cd tutoriaz

# CRITICAL: Initialize and update git submodules
# This downloads the course documentation
git submodule init
git submodule update --recursive --remote

# Verify submodule is loaded
ls -la courses/esp32_basic/site/
# Should show: index.html, assets/, esp32/, etc.

# Install dependencies
npm install --production

# Set environment variables
export NODE_ENV=production
export HOST=0.0.0.0
export PORT=3030
export BASE_URL=http://YOUR_SERVER_IP:3030
export JWT_SECRET=your-secure-random-secret

# Start the server
npm start
```

**Or use the automated deployment script:**

```bash
# Make script executable
chmod +x deploy.sh

# Run deployment script (handles submodules automatically)
./deploy.sh

# Then start the server
npm start
```

### 2. Using PM2 (Recommended for Production)

```bash
# Install PM2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'tutoriaz',
    script: './server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3030,
      HOST: '0.0.0.0',
      BASE_URL: 'http://YOUR_SERVER_IP:3030',
      JWT_SECRET: 'your-secure-secret-key'
    }
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 3. Using systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/tutoriaz.service
```

Add this content:

```ini
[Unit]
Description=Tutoriaz Quiz Server
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/tutoriaz
Environment=NODE_ENV=production
Environment=PORT=3030
Environment=HOST=0.0.0.0
Environment=BASE_URL=http://YOUR_SERVER_IP:3030
Environment=JWT_SECRET=your-secure-secret-key
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable tutoriaz

# Start service
sudo systemctl start tutoriaz

# Check status
sudo systemctl status tutoriaz
```

## Firewall Configuration

Make sure your server's firewall allows traffic on the PORT:

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 3030/tcp

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=3030/tcp
sudo firewall-cmd --reload

# Check if port is listening
netstat -tuln | grep 3030
# or
ss -tuln | grep 3030
```

## Verifying Deployment

### 1. Check Server is Listening on 0.0.0.0
```bash
netstat -tuln | grep 3030
# Should show: 0.0.0.0:3030 (not 127.0.0.1:3030)
```

### 2. Test from Another Machine
```bash
# Replace SERVER_IP with your server's IP
curl http://SERVER_IP:3030/
# Should return the index.html page
```

### 3. Test Course Documentation Access
```bash
# Should return the course documentation
curl http://SERVER_IP:3030/docs/esp32_basic/site/index.html
```

## Troubleshooting

### ⚠️ MOST COMMON ISSUE: Git Submodules Not Initialized

The course documentation lives in a **git submodule**. If you didn't run `git submodule init` and `git submodule update`, the `courses/esp32_basic/site/` directory will be empty!

**Check if submodules are initialized:**
```bash
cd ~/learning/tutoriaz
ls -la courses/esp32_basic/site/
```

**If empty or missing:**
```bash
# Initialize and download submodules
git submodule init
git submodule update --recursive --remote

# Verify it worked
ls -la courses/esp32_basic/site/index.html
# Should show: -rw-r--r-- ... index.html

# Restart your server
npm start
```

**Quick test:**
```bash
# This should return HTML content (not 404)
curl http://localhost:3030/docs/esp32_basic/site/index.html
```

### Docs still not showing?

1. **Check HOST binding:**
   ```bash
   netstat -tuln | grep 3030
   ```
   If it shows `127.0.0.1:3030`, the HOST is wrong.

2. **Check file permissions:**
   ```bash
   ls -la courses/esp32_basic/site/
   # Files should be readable by the user running the server
   ```

3. **Check if courses directory exists:**
   ```bash
   ls -R courses/
   ```

4. **Check server logs:**
   ```bash
   # If using PM2
   pm2 logs tutoriaz
   
   # If using systemd
   sudo journalctl -u tutoriaz -f
   ```

5. **Verify static file serving:**
   ```bash
   # This should work from another machine
   curl http://YOUR_SERVER_IP:3030/docs/esp32_basic/site/index.html
   ```

## Common Issues

### Issue: "Connection refused" from external network
**Cause:** Server is bound to 127.0.0.1 (localhost only)
**Solution:** Set `HOST=0.0.0.0` or `NODE_ENV=production`

### Issue: "404 Not Found" for /docs/
**Cause 1:** `courses/` directory is missing or not uploaded
**Cause 2:** Git submodules were not initialized (MOST COMMON)
**Solution:** 
```bash
# Initialize git submodules
git submodule init
git submodule update --recursive --remote

# Verify the site directory exists
ls -la courses/esp32_basic/site/index.html
# Should show the file, not "No such file or directory"
```

### Issue: Blank iframe in documentation
**Cause:** BASE_URL is not set correctly
**Solution:** Set `BASE_URL=http://YOUR_SERVER_IP:3030` in environment variables

## Render.com vs Self-Hosted

| Feature | Render.com | Self-Hosted Server |
|---------|-----------|-------------------|
| HOST default | Automatically 0.0.0.0 | Must set manually |
| Environment vars | Set in dashboard | Set in shell/systemd |
| BASE_URL | Auto-configured | Must set manually |
| Process management | Automatic | Use PM2/systemd |
| HTTPS | Automatic | Must configure nginx/certbot |

## HTTPS Setup (Optional but Recommended)

For production, use nginx as a reverse proxy with SSL:

```nginx
# /etc/nginx/sites-available/tutoriaz
server {
    listen 80;
    server_name your-domain.com;
    
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

Then get SSL certificate:
```bash
sudo certbot --nginx -d your-domain.com
```

Update BASE_URL to: `https://your-domain.com`

## Summary

**Quick Fix:** Set `NODE_ENV=production` and restart your server.

The server will now automatically bind to `0.0.0.0`, making it accessible from external networks, and your course documentation will be available at:
```
http://YOUR_SERVER_IP:3030/docs/esp32_basic/site/
```
