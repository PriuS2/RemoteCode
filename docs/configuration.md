# Configuration

Remote Code uses Pydantic settings with the `CCR_` prefix for app-level settings.
Other environment variables may coexist in the same `.env` file and are passed through to child CLI processes such as Claude Code.

## Core settings

| Setting | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `host` | `CCR_HOST` | `0.0.0.0` | FastAPI bind address |
| `port` | `CCR_PORT` | `8080` | FastAPI bind port |
| `claude_command` | `CCR_CLAUDE_COMMAND` | `claude` | Claude Code CLI command |
| `kilo_command` | `CCR_KILO_COMMAND` | `kilo` | Kilo Code CLI command |
| `opencode_command` | `CCR_OPENCODE_COMMAND` | `opencode` | OpenCode CLI command |
| `opencode_web_port` | `CCR_OPENCODE_WEB_PORT` | `8096` | OpenCode Web port |
| `opencode_web_hostname` | `CCR_OPENCODE_WEB_HOSTNAME` | `0.0.0.0` | OpenCode Web bind host |
| `password` | `CCR_PASSWORD` | `changeme` | Login password |
| `jwt_secret` | `CCR_JWT_SECRET` | `change-this-secret-key` | JWT signing secret |
| `jwt_expire_hours` | `CCR_JWT_EXPIRE_HOURS` | `72` | Session expiration hours |
| `db_path` | `CCR_DB_PATH` | `sessions.db` | SQLite database path |
| `allowed_origins` | `CCR_ALLOWED_ORIGINS` | `*` | CORS allowed origins |

## Settings class

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8080
    claude_command: str = "claude"
    kilo_command: str = "kilo"
    opencode_command: str = "opencode"
    opencode_web_port: int = 8096
    opencode_web_hostname: str = "0.0.0.0"
    password: str = "changeme"
    jwt_secret: str = "change-this-secret-key"
    jwt_expire_hours: int = 72
    db_path: str = "sessions.db"
    allowed_origins: str = "*"

    model_config = {"env_prefix": "CCR_", "extra": "ignore"}
```

## Example `.env`

```env
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_KILO_COMMAND=kilo
CCR_OPENCODE_COMMAND=opencode
CCR_OPENCODE_WEB_PORT=8096
CCR_OPENCODE_WEB_HOSTNAME=0.0.0.0
CCR_PASSWORD=replace-me
CCR_JWT_SECRET=replace-with-random-secret
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
CCR_ALLOWED_ORIGINS=https://your-domain.com

# Claude Code provider variables can live in the same file.
# Remote Code ignores them for app settings and passes them to the Claude CLI.
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Claude Code provider variables

You can keep Claude Code provider variables in the same runtime `.env`, including the packaged app runtime file:

- Windows: `%APPDATA%\Remote Code\.env`
- macOS: `~/Library/Application Support/Remote Code/.env`

Remote Code only parses `CCR_*` as its own settings. Variables such as `CLAUDE_CODE_USE_BEDROCK`, `AWS_*`, `ANTHROPIC_*`, and `OPENROUTER_*` are loaded into the process environment and inherited by Claude Code sessions.

## Security notes

- Change `CCR_PASSWORD`
- Change `CCR_JWT_SECRET`
- Restrict `CCR_ALLOWED_ORIGINS` in production
- Prefer HTTPS or a trusted reverse proxy

The backend refuses to start while `CCR_JWT_SECRET` is still the insecure default value.

Kilo sessions use the interactive `kilo` TUI command. Remote Code can launch them, but it does not support true suspend/resume for the Kilo TUI. Reopening a closed or suspended Kilo session launches `kilo` fresh in the same session entry.

## Auth behavior

- Browser login sets an `HttpOnly` cookie named `remote_code_session`
- The frontend does not store auth in `localStorage`
- Browser requests should use `credentials: "same-origin"`

## Frontend localStorage keys

Remote Code stores UI preferences in the browser:

| Key | Description | Default |
| --- | --- | --- |
| `sidebarWidth` | Sidebar width in pixels | `260` |
| `explorerWidth` | File explorer width in pixels | `240` |
| `gitPanelWidth` | Git panel width in pixels | `300` |
| `webFontSize` | Web UI font size | `14` |
| `terminalFontSize` | Terminal font size | `14` |
| `gitFontSize` | Git panel font size | `12` |
| `gitShowCommitMetadata` | Git log metadata visibility | `true` |
| `splitRatio` | Split terminal ratio | `0.5` |

## Deployment notes

### Development

```bash
make dev RUNTIME=web
make dev RUNTIME=chromium
```

### Production

```bash
cd frontend
npm run build
cd ..
make start RUNTIME=web
make start RUNTIME=chromium
```

### Runtime differences

- `web` runtime: starts the FastAPI backend and opens your default browser
- `chromium` runtime: starts the same backend inside an Electron shell with desktop-only integrations

Chromium mode adds:

- protected Claude Code and OpenCode shortcut handling
- native folder picker for project creation
- desktop notifications
- external-link handoff to the system browser
- window position and size restore
- tray/background keep-alive with `Hide to Tray` as the default close behavior
- dedicated project windows and dedicated single-session windows
- recent-project menus in the tray, macOS dock menu, and Windows jump list/tasks
- `Launch at login` and desktop version/update-manifest details in Settings

### Reverse proxy requirements

If you deploy behind nginx, Caddy, Cloudflare Tunnel, or another proxy:

- forward normal HTTP traffic to the backend
- support WebSocket upgrades for `/ws`
- forward `X-Forwarded-Proto` so secure cookies are set correctly on HTTPS deployments

## Database notes

- SQLite WAL mode is enabled automatically
- `CCR_DB_PATH` may be relative or absolute
- The database stores session metadata, not terminal auth state
