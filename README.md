# Remote Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

Remote Code is a self-hosted web app for running terminal-based coding workflows from the browser.
It provides persistent PTY-backed sessions, file browsing, Git tooling, Monaco-based IDE sessions, and
OpenCode Web proxying on top of a FastAPI backend and React frontend.

## Features

- Web terminal powered by xterm.js
- Monaco IDE session with multi-tab editing, save/reload, and language-aware diagnostics
- Multiple persistent sessions with suspend, resume, rename, reorder, and split view
- CLI types: `claude`, `kilo`, `opencode`, `terminal`, `custom`, `folder`, `git`, and `ide`
- File explorer with preview, upload, download, rename, delete, mkdir, and server-side open
- Git status, diff, history, branch, commit, stash, pull, and push actions
- Password login backed by an `HttpOnly` session cookie
- Optional Cloudflare Tunnel or reverse-proxy deployment

## Architecture

```text
Browser (React + xterm.js)
    <-> HTTP / WebSocket
FastAPI backend
    <-> PTY manager (pywinpty / pexpect)
CLI process
```

| Layer | Stack |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, xterm.js |
| Backend | FastAPI, Uvicorn, WebSocket |
| PTY | pywinpty on Windows, pexpect on Linux/macOS |
| Storage | SQLite via aiosqlite |
| Auth | Password login + JWT-backed `HttpOnly` cookie |

## Requirements

- Python 3.10+
- Node.js 18+
- At least one CLI available in `PATH`
  - `claude` for Claude Code sessions
  - `kilo` for Kilo Code sessions
  - `opencode` for OpenCode and OpenCode Web sessions

## Quick Start

### 1. Setup

```bash
# Windows
.\setup.ps1

# Linux / macOS
chmod +x *.sh
./setup.sh

# Or Make
make setup
```

### 2. Configure `.env`

The first run creates a `.env` file. Change the security-sensitive defaults before exposing the app.

```env
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_KILO_COMMAND=kilo
CCR_OPENCODE_COMMAND=opencode
CCR_OPENCODE_WEB_PORT=8096
CCR_OPENCODE_WEB_HOSTNAME=0.0.0.0
CCR_PASSWORD=changeme
CCR_JWT_SECRET=change-this-secret-key
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://your-domain.com
```

The server refuses to start while `CCR_JWT_SECRET` is left at the insecure default.

### 3. Run

```bash
# Development mode
# Windows
.\start-dev.ps1

# Linux / macOS
./start-dev.sh

# Or Make
make dev
```

```bash
# Production mode
cd frontend && npm run build && cd ..

# Windows
.\start.ps1

# Linux / macOS
./start.sh

# Or Make
make start
```

### 4. Access

- Development: `http://localhost:5173`
- Production: `http://localhost:8080`

Log in with the password from `CCR_PASSWORD`. The backend sets an `HttpOnly` cookie and the frontend
uses `credentials: "same-origin"` for authenticated requests.

## Supported Session Types

| CLI type | Description |
| --- | --- |
| `claude` | Claude Code CLI session |
| `kilo` | Kilo Code CLI session |
| `opencode` | OpenCode terminal session |
| `opencode-web` | OpenCode Web launched through the backend proxy |
| `terminal` | Plain shell session |
| `custom` | User-provided command with optional custom exit command |
| `folder` | Saved file explorer panel |
| `git` | Saved Git panel |
| `ide` | Monaco-based editor panel with built-in web IntelliSense and Python LSP support |

## API Overview

Remote Code uses cookie-authenticated REST APIs plus a terminal WebSocket endpoint.

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

### Files and folders

- `GET /api/browse`
- `GET /api/files`
- `GET /api/file-content`
- `GET /api/file-raw`
- `POST /api/mkdir`
- `POST /api/rename`
- `POST /api/delete`
- `POST /api/upload`
- `POST /api/open-explorer`

### Sessions

- `POST /api/sessions/preflight`
- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/sessions/{session_id}/suspend`
- `POST /api/sessions/{session_id}/resume`
- `PATCH /api/sessions/{session_id}/rename`
- `DELETE /api/sessions/{session_id}`
- `POST /api/sessions/reorder`
- `WS /ws/terminal/{session_id}`

### IDE

- `GET /api/ide/sessions/{session_id}/file`
- `PUT /api/ide/sessions/{session_id}/file`
- `GET /api/ide/sessions/{session_id}/languages`
- `WS /ws/ide/{session_id}/lsp/{language_id}`

### Git

- `GET /api/git/status`
- `GET /api/git/log`
- `GET /api/git/branches`
- `GET /api/git/diff`
- `GET /api/git/commit-detail`
- `GET /api/git/commit-diff`
- `POST /api/git/stage`
- `POST /api/git/unstage`
- `POST /api/git/discard`
- `POST /api/git/commit`
- `POST /api/git/checkout`
- `POST /api/git/create-branch`
- `POST /api/git/pull`
- `POST /api/git/push`
- `GET /api/git/stash-list`
- `POST /api/git/stash`
- `POST /api/git/stash-pop`
- `POST /api/git/stash-drop`

### OpenCode Web

- `GET /api/opencode-web/status`
- `POST /api/opencode-web/start`
- `POST /api/opencode-web/stop`
- `ANY /api/opencode-web/proxy`
- `ANY /api/opencode-web/proxy/{path}`

For request and response details, see [docs/backend-api.md](docs/backend-api.md).

## Cloudflare Tunnel

For external access you can use the bundled helper scripts:

```bash
# Temporary tunnel
make tunnel-quick

# Named tunnel
make tunnel
```

See [docs/deployment.md](docs/deployment.md) for deployment details.

## Project Structure

```text
backend/
  main.py
  auth.py
  config.py
  database.py
  git_utils.py
  opencode_web_manager.py
  pty_manager.py
  session_manager.py
  websocket.py
frontend/
  src/
docs/
```

## Documentation

- [docs/README.md](docs/README.md) - documentation index
- [docs/backend-api.md](docs/backend-api.md) - REST and WebSocket reference
- [docs/configuration.md](docs/configuration.md) - environment variables and runtime settings
- [docs/websocket-protocol.md](docs/websocket-protocol.md) - terminal WebSocket behavior
- [docs/verification-checklist.md](docs/verification-checklist.md) - basic manual verification flow

## Security Notes

- Change `CCR_PASSWORD`
- Change `CCR_JWT_SECRET`
- Restrict `CCR_ALLOWED_ORIGINS` in production
- Prefer HTTPS or a trusted tunnel when exposing the app

## License

MIT
