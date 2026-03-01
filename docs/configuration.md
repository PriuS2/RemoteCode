# Configuration

## Overview

Remote Code uses Pydantic Settings for configuration management. Settings can be configured via environment variables with the `CCR_` prefix.

## Configuration Options

### Core Settings

| Setting | Environment Variable | Default | Description |
|---------|---------------------|---------|-------------|
| `host` | `CCR_HOST` | `0.0.0.0` | Server bind address |
| `port` | `CCR_PORT` | `8080` | Server port |
| `claude_command` | `CCR_CLAUDE_COMMAND` | `claude` | Claude CLI command |
| `password` | `CCR_PASSWORD` | `changeme` | Login password |
| `jwt_secret` | `CCR_JWT_SECRET` | `change-this-secret-key` | JWT signing secret |
| `jwt_expire_hours` | `CCR_JWT_EXPIRE_HOURS` | `72` | JWT expiration time |
| `db_path` | `CCR_DB_PATH` | `sessions.db` | SQLite database path |
| `allowed_origins` | `CCR_ALLOWED_ORIGINS` | `*` | CORS allowed origins |

### Configuration Class

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8080
    claude_command: str = "claude"
    password: str = "changeme"
    jwt_secret: str = "change-this-secret-key"
    jwt_expire_hours: int = 72
    db_path: str = "sessions.db"
    allowed_origins: str = "*"

    model_config = {"env_prefix": "CCR_"}

settings = Settings()
```

## Environment-Specific Configuration

### Development

```bash
# .env file or environment variables
CCR_HOST=127.0.0.1
CCR_PORT=8080
CCR_PASSWORD=dev
CCR_JWT_SECRET=dev-secret-key
CCR_ALLOWED_ORIGINS=http://localhost:5173
```

### Production

```bash
# Production environment
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_PASSWORD=<strong-password>
CCR_JWT_SECRET=<random-secret-key>
CCR_ALLOWED_ORIGINS=https://your-domain.com
CCR_DB_PATH=/data/sessions.db
```

## Security Best Practices

### JWT Secret

**?ая╕П IMPORTANT:** Change the default JWT secret in production!

```bash
# Generate a secure random secret
openssl rand -hex 32
# or
python -c "import secrets; print(secrets.token_hex(32))"
```

### Password

**?ая╕П IMPORTANT:** Change the default password in production!

Use a strong password:
- At least 12 characters
- Mix of uppercase, lowercase, numbers, symbols
- No dictionary words

### CORS Origins

In production, specify exact origins instead of `*`:

```bash
# Single origin
CCR_ALLOWED_ORIGINS=https://code.example.com

# Multiple origins (comma-separated)
CCR_ALLOWED_ORIGINS=https://code.example.com,https://dev.example.com
```

## Claude Code Provider Configuration

Claude Code CLI supports multiple AI providers. Configure the appropriate environment variables based on your chosen provider.

## Provider Options

### Option 1: Anthropic API (Direct)

Default provider. Uses Anthropic's official API.

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx

# Optional
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### Option 2: OpenRouter

Use OpenRouter to access various AI models including Claude, GPT, and more.

** Important:** You MUST set `ANTHROPIC_API_KEY=""` (empty string) when using OpenRouter to prevent auth conflicts. Claude CLI checks for `ANTHROPIC_API_KEY` first, so it needs to be explicitly set to empty.

**PowerShell (Windows):**
```powershell
# Set OpenRouter configuration
# ANTHROPIC_API_KEY must be empty string, not unset!
$env:ANTHROPIC_API_KEY = ""
$env:OPENROUTER_API_KEY = "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx"
$env:ANTHROPIC_AUTH_TOKEN = $env:OPENROUTER_API_KEY
$env:ANTHROPIC_BASE_URL = "https://openrouter.ai/api"
$env:ANTHROPIC_MODEL = "moonshotai/kimi-k2.5"
```

**Bash (Linux/macOS):**
```bash
# Set OpenRouter configuration
# ANTHROPIC_API_KEY must be empty string, not unset!
export ANTHROPIC_API_KEY=""
export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"
```

**Docker/systemd:**
```bash
# ANTHROPIC_API_KEY must be set to empty string!
ANTHROPIC_API_KEY=""
ANTHROPIC_AUTH_TOKEN=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_MODEL=moonshotai/kimi-k2.5
```

**Available Models on OpenRouter:**
- `anthropic/claude-sonnet-4` - Claude 4 Sonnet (Recommended)
- `anthropic/claude-opus-4` - Claude 4 Opus
- `moonshotai/kimi-k2.5` - Kimi K2.5
- `openai/gpt-4o` - GPT-4o
- Browse [openrouter.ai/models](https://openrouter.ai/models) for full list

### Option 3: AWS Bedrock

Use AWS Bedrock for enterprise Claude access.

```bash
# Required
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0
```

### Option 4: LM Studio / OpenAI-compatible API

Use local models via LM Studio or other OpenAI-compatible APIs.

```bash
# Required
ANTHROPIC_BASE_URL=http://localhost:1234/v1
ANTHROPIC_API_KEY=lm-studio
ANTHROPIC_MODEL=your-model-name
```

## Environment Variable Reference

| Variable | Description | Required For |
|----------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (set to `""` for OpenRouter) | All providers |
| `ANTHROPIC_AUTH_TOKEN` | Auth token (OpenRouter) | OpenRouter |
| `ANTHROPIC_BASE_URL` | Custom API base URL | OpenRouter, LM Studio |
| `ANTHROPIC_MODEL` | Model identifier | All providers |
| `OPENROUTER_API_KEY` | OpenRouter API key | Reference only |
| `CLAUDE_CODE_USE_BEDROCK` | Enable AWS Bedrock | AWS Bedrock |
| `AWS_REGION` | AWS region | AWS Bedrock |
| `AWS_ACCESS_KEY_ID` | AWS access key | AWS Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | AWS Bedrock |

### Important Notes

- **`ANTHROPIC_API_KEY` behavior:**
  - **Anthropic Direct**: Set to your API key (`sk-ant-...`)
  - **OpenRouter**: Must be set to empty string (`""`) to prevent auth conflicts
  - Claude CLI checks `ANTHROPIC_API_KEY` first; if unset, it may prompt for API key
- **`OPENROUTER_API_KEY`**: Optional, for reference only; actual token used is `ANTHROPIC_AUTH_TOKEN`

## Troubleshooting

### "Auth conflict" Error

**Error:**
```
Auth conflict: Both a token (ANTHROPIC_AUTH_TOKEN) and an API key (ANTHROPIC_API_KEY) are set.
```

**Solution for OpenRouter:**
```bash
# For OpenRouter, set ANTHROPIC_API_KEY to empty string (don't unset it!)
export ANTHROPIC_API_KEY=""
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-..."
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
```

**Solution for Anthropic Direct:**
```bash
# Unset ANTHROPIC_AUTH_TOKEN
unset ANTHROPIC_AUTH_TOKEN
export ANTHROPIC_API_KEY="sk-ant-..."
```

### "Model may not exist" Error

**Error:**
```
There's an issue with the selected model. It may not exist or you may not have access to it.
```

**Solutions:**
1. Check the model name on [openrouter.ai/models](https://openrouter.ai/models)
2. Run `/model` in Claude and select from available models
3. Try alternative model names:
   - `anthropic/claude-sonnet-4`
   - `anthropic/claude-opus-4`
   - `anthropic/claude-3-5-sonnet`

### Model Not Found

If your model isn't working, verify availability:
```bash
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://openrouter.ai/api/v1/models
```</replace_all>?

## Command Path

If `claude` is not in PATH, specify the full path:

```bash
CCR_CLAUDE_COMMAND=/usr/local/bin/claude
# or on Windows
CCR_CLAUDE_COMMAND=C:\Program Files\Claude\claude.exe
```

## Claude Configuration Directory

Claude Code stores its configuration and session data in:

- **macOS**: `~/Library/Application Support/Claude/`
- **Linux**: `~/.config/claude/`
- **Windows**: `%APPDATA%\Claude\`

## Database Configuration

### SQLite Path

The database file location can be configured:

```bash
# Relative path (from working directory)
CCR_DB_PATH=data/sessions.db

# Absolute path
CCR_DB_PATH=/var/lib/remote-code/sessions.db

# Windows
CCR_DB_PATH=C:\ProgramData\RemoteCode\sessions.db
```

### WAL Mode

SQLite WAL (Write-Ahead Logging) mode is automatically enabled for better concurrent performance. WAL files:
- `sessions.db-wal`: Write-ahead log
- `sessions.db-shm`: Shared memory file

These files are automatically managed by SQLite.

## Network Configuration

### Port Configuration

```bash
# Standard HTTP port (requires root/admin)
CCR_PORT=80

# Alternative port
CCR_PORT=3000

# Custom port
CCR_PORT=8888
```

### Binding Address

```bash
# All interfaces (accessible externally)
CCR_HOST=0.0.0.0

# Localhost only (internal access only)
CCR_HOST=127.0.0.1

# Specific interface
CCR_HOST=192.168.1.100
```

## Reverse Proxy Configuration

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name code.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```caddyfile
code.example.com {
    reverse_proxy localhost:8080
}
```

### Cloudflare Tunnel

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Run tunnel
cloudflared tunnel --url http://localhost:8080
```

## Logging Configuration

### Python Logging

Add to your startup script for debug logging:

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### Module-Specific Logging

```python
# Enable PTY debug logging
logging.getLogger("backend.pty_manager").setLevel(logging.DEBUG)

# Enable WebSocket debug logging
logging.getLogger("backend.websocket").setLevel(logging.DEBUG)

# Enable session debug logging
logging.getLogger("backend.session_manager").setLevel(logging.DEBUG)
```

## Frontend Configuration

Frontend configuration is stored in browser localStorage:

### Persistent Settings

| Key | Description | Default |
|-----|-------------|---------|
| `token` | JWT token | - |
| `sidebarWidth` | Sidebar width in pixels | 260 |
| `explorerWidth` | File explorer width | 240 |
| `gitPanelWidth` | Git panel width | 300 |
| `webFontSize` | Web UI font size | 14 |
| `terminalFontSize` | Terminal font size | 14 |
| `splitRatio` | Split panel ratio | 0.5 |

### Reset Frontend Settings

Clear browser localStorage to reset all frontend settings:

```javascript
localStorage.clear();
```

## Docker Configuration

Example Dockerfile:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy backend
COPY backend/ ./backend/

# Copy built frontend
COPY frontend/dist/ ./static/

# Environment variables
ENV CCR_HOST=0.0.0.0
ENV CCR_PORT=8080
ENV CCR_PASSWORD=changeme

EXPOSE 8080

CMD ["python", "-m", "backend.main"]
```

## Systemd Service

```ini
# /etc/systemd/system/remote-code.service
[Unit]
Description=Remote Code Server
After=network.target

[Service]
Type=simple
User=remote-code
WorkingDirectory=/opt/remote-code
Environment=CCR_HOST=127.0.0.1
Environment=CCR_PORT=8080
Environment=CCR_PASSWORD=<secure-password>
Environment=CCR_JWT_SECRET=<random-secret>
ExecStart=/opt/remote-code/venv/bin/python -m backend.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable remote-code
sudo systemctl start remote-code
sudo systemctl status remote-code
```

## Configuration Validation

Settings are validated at startup. Invalid values will cause the application to fail fast with a clear error message.

Example validation errors:
```
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
port
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
```
