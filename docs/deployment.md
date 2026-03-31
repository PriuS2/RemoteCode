# Deployment Guide

## Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher (for building frontend)
- Claude Code CLI installed (`claude` command available)
- Git (optional, for cloning)

## System Requirements

### Minimum

- RAM: 512 MB
- Disk: 1 GB
- CPU: 1 core

### Recommended

- RAM: 2 GB+
- Disk: 10 GB+
- CPU: 2+ cores

## Installation Methods

### Method 1: Quick Setup (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd remote-code

# Run automated setup
make setup

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Start server
make start
```

### Method 2: Manual Setup

#### Backend Setup

```bash
# Create virtual environment
python -m venv venv

# Activate
# Linux/macOS:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt
```

#### Frontend Build

```bash
cd frontend
npm install
npm run build
cd ..
```

#### Start Server

```bash
# Production mode
python -m backend.main

# Or with custom settings
CCR_HOST=0.0.0.0 CCR_PORT=8080 CCR_PASSWORD=secret python -m backend.main
```

### Method 3: Docker

```bash
# Build image
docker build -t remote-code .

# Run container
docker run -d \
  -p 8080:8080 \
  -e CCR_PASSWORD=secret \
  -e CCR_JWT_SECRET=random-secret \
  -v /path/to/data:/data \
  remote-code
```

### Method 4: Desktop Executable (Windows/macOS)

Use this when you want a packaged local runtime instead of a Python/Node source setup.
You can now build either a browser-launching `web` package or a `chromium` desktop-shell package.

```bash
# Windows
.\build-release.ps1 -Target all

# macOS
chmod +x build-release.sh
./build-release.sh --target all
```

Output archives are created in `release/`.

- Windows: `remote-code-<version>-windows-x64.zip`
- Windows Chromium: `remote-code-chromium-<version>-windows-x64.zip`
- Windows Chromium manifest: `update-manifest-windows-x64.json`
- macOS Intel: `remote-code-<version>-macos-x64.zip`
- macOS Apple Silicon: `remote-code-<version>-macos-arm64.zip`
- macOS Chromium Intel: `remote-code-chromium-<version>-macos-x64.zip`
- macOS Chromium Apple Silicon: `remote-code-chromium-<version>-macos-arm64.zip`
- macOS Chromium manifest: `update-manifest-macos-<arch>.json`

The packaged launcher stores runtime files in the user app-data directory:

- Windows: `%APPDATA%\Remote Code`
- macOS: `~/Library/Application Support/Remote Code`

That directory contains the packaged-app `.env` and `sessions.db`.
Chromium packages also embed an `update-manifest.json` resource that the desktop Settings panel can read to show the latest packaged version metadata.

## Platform-Specific Instructions

### Windows

1. Install Python 3.11+ from python.org
2. Install Node.js from nodejs.org
3. Install Claude Code CLI
4. Run PowerShell setup script:
   ```powershell
   .\setup.ps1
   .\start.ps1 -Runtime web
   .\start.ps1 -Runtime chromium
   ```

### macOS

```bash
# Install dependencies with Homebrew
brew install python@3.11 node

# Run setup
make setup
make start
```

### Linux (Ubuntu/Debian)

```bash
# Update system
sudo apt update
sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm

# Clone and setup
git clone <repository-url>
cd remote-code
make setup
make start
```

## Production Deployment

### 1. Environment Variables

Create a `.env` file or export variables:

```bash
# Security (CHANGE THESE!)
export CCR_PASSWORD=<strong-password>
export CCR_JWT_SECRET=$(openssl rand -hex 32)

# Network
export CCR_HOST=127.0.0.1  # Bind to localhost only
export CCR_PORT=8080

# CORS
export CCR_ALLOWED_ORIGINS=https://your-domain.com

# Database
export CCR_DB_PATH=/var/lib/remote-code/sessions.db
```

### 2. Systemd Service

Create `/etc/systemd/system/remote-code.service`:

```ini
[Unit]
Description=Remote Code Server
After=network.target

[Service]
Type=simple
User=remote-code
Group=remote-code
WorkingDirectory=/opt/remote-code
Environment=CCR_HOST=127.0.0.1
Environment=CCR_PORT=8080
Environment=CCR_PASSWORD=<secure-password>
Environment=CCR_JWT_SECRET=<random-secret>
Environment=CCR_ALLOWED_ORIGINS=https://code.example.com
Environment=CCR_DB_PATH=/var/lib/remote-code/sessions.db
ExecStart=/opt/remote-code/venv/bin/python -m backend.main
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
# Create user
sudo useradd -r -s /bin/false remote-code

# Set permissions
sudo mkdir -p /var/lib/remote-code
sudo chown remote-code:remote-code /var/lib/remote-code

# Enable service
sudo systemctl daemon-reload
sudo systemctl enable remote-code
sudo systemctl start remote-code

# Check status
sudo systemctl status remote-code
sudo journalctl -u remote-code -f
```

### 3. Nginx Reverse Proxy

Install Nginx:

```bash
sudo apt install nginx
```

Create `/etc/nginx/sites-available/remote-code`:

```nginx
server {
    listen 80;
    server_name code.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name code.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/remote-code /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 4. SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d code.example.com

# Auto-renewal test
sudo certbot renew --dry-run
```

### 5. Firewall

```bash
# Allow SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Deny direct access to app port
sudo ufw deny 8080/tcp

# Enable firewall
sudo ufw enable
```

## Cloud Deployment

### Cloudflare Tunnel (Quick)

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create remote-code

# Configure (~/.cloudflared/config.yml)
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: code.your-domain.com
    service: http://localhost:8080
  - service: http_status:404

# Run tunnel
cloudflared tunnel run remote-code
```

### Railway/Render/Heroku

1. Fork repository to your GitHub account
2. Connect to platform
3. Set environment variables
4. Deploy

Note: May require `Procfile` or `railway.json` modifications.

## Updating

### Manual Update

```bash
# Pull latest changes
git pull origin main

# Update backend dependencies
pip install -r backend/requirements.txt

# Rebuild frontend
cd frontend
npm install
npm run build
cd ..

# Restart service
sudo systemctl restart remote-code
```

### Backup Before Update

```bash
# Backup database
sudo cp /var/lib/remote-code/sessions.db /backup/sessions-$(date +%Y%m%d).db

# Backup database with WAL
sudo sqlite3 /var/lib/remote-code/sessions.db ".backup '/backup/sessions-$(date +%Y%m%d).db'"
```

## Monitoring

### Logs

```bash
# Systemd journal
sudo journalctl -u remote-code -f

# Nginx access log
sudo tail -f /var/log/nginx/access.log

# Nginx error log
sudo tail -f /var/log/nginx/error.log
```

### Health Check

```bash
# Application health
curl https://code.example.com/api/health

# Response: {"status":"ok"}
```

### Process Monitoring

```bash
# Check processes
ps aux | grep python

# Check ports
sudo ss -tlnp | grep 8080
```

## Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Find process using port
sudo lsof -i :8080

# Kill process
sudo kill -9 <PID>
```

#### Permission Denied

```bash
# Check file ownership
sudo chown -R remote-code:remote-code /opt/remote-code
sudo chown remote-code:remote-code /var/lib/remote-code/sessions.db
```

#### WebSocket Connection Failed

- Check nginx configuration has WebSocket headers
- Verify firewall allows WebSocket connections
- Check browser console for errors

#### PTY Spawn Failed

- Verify `claude` command is in PATH
- Check claude CLI is properly installed
- Review logs: `journalctl -u remote-code -f`

## Security Checklist

- [ ] Changed default password
- [ ] Changed default JWT secret
- [ ] Using HTTPS in production
- [ ] Restricted CORS origins
- [ ] Firewall configured
- [ ] Running as non-root user
- [ ] Database file permissions set
- [ ] Regular backups scheduled
- [ ] Auto-updates configured (optional)

## Performance Tuning

### SQLite Optimization

```sql
-- Connect to database
sqlite3 sessions.db

-- Optimize (run periodically)
PRAGMA optimize;
VACUUM;
```

### System Limits

```bash
# Increase file descriptor limits
# /etc/security/limits.conf
remote-code soft nofile 65536
remote-code hard nofile 65536
```

### Nginx Tuning

```nginx
# /etc/nginx/nginx.conf
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}
```
