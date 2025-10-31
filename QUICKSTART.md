# Quick Setup Guide - Production Deployment with Auto-Update

## Step 1: Setup Database Outside Git Directory

```bash
# Create database directory
sudo mkdir -p /var/lib/tutoriaz
sudo chown $USER:$USER /var/lib/tutoriaz

# Move existing database (if any)
[ -f ~/tutoriaz/database.sqlite ] && mv ~/tutoriaz/database.sqlite /var/lib/tutoriaz/
```

## Step 2: Configure Environment

```bash
cd ~/tutoriaz
cp .env.example .env
nano .env
```

Update these critical values:
```
DB_PATH=/var/lib/tutoriaz/database.sqlite  # IMPORTANT!
BASE_URL=https://your-domain.com
JWT_SECRET=your-secure-random-secret
```

## Step 3: Setup Auto-Update

```bash
chmod +x setup-autoupdate.sh auto-update.sh start.sh
./setup-autoupdate.sh
```

Answer the prompts:
- Branch: `main`
- Using PM2? `y` or `n`
- Service name: `tutoriaz`
- Check interval: `5` (minutes)
- Setup systemd timer? `y`

## Step 4: Start Application

### Option A: PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions
```

### Option B: Systemd
```bash
sudo cp tutoriaz.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tutoriaz
sudo systemctl start tutoriaz
```

## Step 5: Verify Everything Works

```bash
# Check app is running
sudo systemctl status tutoriaz
# or
pm2 list

# Check auto-update is working
sudo systemctl status tutoriaz-autoupdate.timer
tail -f /var/log/tutoriaz-autoupdate.log

# Test manual update
./auto-update.sh
```

## Daily Management

```bash
# View app logs
sudo journalctl -u tutoriaz -f
# or
pm2 logs tutoriaz

# View update logs
tail -f /var/log/tutoriaz-autoupdate.log

# Restart app
sudo systemctl restart tutoriaz
# or
pm2 restart tutoriaz

# Check for updates now
sudo systemctl start tutoriaz-autoupdate.service
# or
./auto-update.sh
```

## Important Files

```
/var/lib/tutoriaz/database.sqlite  ← Your database (safe from git pull)
~/tutoriaz/.env                     ← Configuration
~/tutoriaz/auto-update.sh          ← Update script
/var/log/tutoriaz-autoupdate.log   ← Update logs
```

## How It Works

1. Every 5 minutes, the system checks GitHub for new commits
2. If new commit found:
   - Pulls latest code with `git pull -f`
   - Updates submodules (course docs)
   - Installs new dependencies
   - Restarts application
3. Database stays safe in `/var/lib/tutoriaz/`
4. Logs everything to `/var/log/tutoriaz-autoupdate.log`

## 🚨 CRITICAL: Database Location

**NEVER** keep `database.sqlite` in the git directory! It will be deleted on updates!

Always set:
```
DB_PATH=/var/lib/tutoriaz/database.sqlite
```

---

For detailed docs: See `AUTO_UPDATE_GUIDE.md` and `SERVICE_SETUP.md`
