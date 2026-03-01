# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Terminal  │  │File Explorer│  │     Git Panel       │  │
│  │  (xterm.js) │  │  (React)    │  │    (React)          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         └─────────────────┴────────────────────┘             │
│                         │                                    │
│                    WebSocket/HTTP                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   Reverse Proxy                            │
│              (cloudflared/ngrok optional)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                     Server (FastAPI)                         │
│  ┌──────────────────────┼───────────────────────────────┐   │
│  │                      ▼                                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │   │
│  │  │  REST    │  │ WebSocket│  │  Static Files    │    │   │
│  │  │  Router  │  │  Router  │  │   (built UI)     │    │   │
│  │  └────┬─────┘  └────┬─────┘  └──────────────────┘    │   │
│  │       └─────────────┴──────────────┐                  │   │
│  │                                    │                   │   │
│  │  ┌──────────────┐  ┌──────────────┬┴┐                 │   │
│  │  │SessionManager│  │  PtyManager  │ │                 │   │
│  │  └──────┬───────┘  └──────┬───────┘ │                 │   │
│  │         │                 │         │                 │   │
│  │         └────────┬────────┘         │                 │   │
│  │                  ▼                  │                 │   │
│  │           ┌────────────┐            │                 │   │
│  │           │  Database  │            │                 │   │
│  │           │ (SQLite)   │            │                 │   │
│  │           └────────────┘            │                 │   │
│  │                                     │                 │
│  │  ┌──────────────────────────────────┴┐                │   │
│  │  │       PTY Processes (claude)      │                │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌──────┐ │                │   │
│  │  │  │Session 1│ │Session 2│ │ ...  │ │                │   │
│  │  │  │(claude) │ │(claude) │ │      │ │                │   │
│  │  │  └─────────┘ └─────────┘ └──────┘ │                │   │
│  │  └───────────────────────────────────┘                │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Backend Components

#### FastAPI Application (`main.py`)
- Entry point for the application
- CORS middleware configuration
- Static file serving (built frontend)
- REST API routes and WebSocket endpoint registration

#### Authentication (`auth.py`)
- JWT-based authentication
- Password verification with HMAC
- Bearer token support for REST API
- Query parameter token support for WebSocket

#### Session Management (`session_manager.py`)
- **create_session()**: 새 세션 생성 및 PTY spawn
- **suspend_session()**: 세션 일시중지 (--resume ID 캡처)
- **resume_session()**: 세션 재개 (--resume 지원)
- **terminate_session()**: 세션 강제 종료
- **delete_session()**: 세션 삭제

#### PTY Management (`pty_manager.py`)
- Platform-specific PTY adapters
  - Windows: pywinpty
  - Linux/macOS: pexpect
- Async read/write operations
- Terminal resize handling
- Output buffering (8KB)

#### WebSocket Handler (`websocket.py`)
- Bidirectional PTY ↔ WebSocket relay
- Session takeover support (single connection per session)
- PTY lifecycle management

#### Database (`database.py`)
- SQLite with WAL mode
- Async operations via aiosqlite
- Session CRUD operations

#### Git Utilities (`git_utils.py`)
- Async git command execution
- Git repository detection
- Error handling

### 2. Frontend Components

#### App (`App.tsx`)
- Global state management (sessions, active sessions, focus)
- Sidebar resize handling
- Split panel management
- Settings panel (font size)

#### Terminal (`components/Terminal.tsx`)
- xterm.js integration
- WebSocket connection via `useWebSocket`
- Activity tracking (idle/processing/done)
- File explorer and Git panel toggle
- Mobile touch scroll handling

#### Session List (`components/SessionList.tsx`)
- Session listing with status colors
- Context menu (right-click / long-press)
- Activity indicators (spinner, done badge)
- Shift+Click split view support

#### File Explorer (`components/FileExplorer.tsx`)
- Directory browsing
- File upload/download
- Syntax-highlighted preview
- Grid/List view modes

#### Git Panel (`components/GitPanel.tsx`)
- Git status display
- Diff viewer
- Branch management
- Commit graph visualization

#### Hooks
- **useWebSocket**: WebSocket connection management with auto-reconnect

## Data Flow

### Session Creation Flow
```
1. User clicks "New Session"
2. POST /api/sessions with work_path
3. SessionManager creates DB entry
4. PtyManager spawns claude process
5. Session appears in SessionList
6. User clicks session to open
7. WebSocket connects to /ws/{session_id}
8. Terminal displays PTY output
```

### Suspend/Resume Flow
```
Suspend:
1. User clicks Suspend button
2. POST /api/sessions/{id}/suspend
3. /exit command sent to PTY
4. --resume UUID captured from output
5. PTY terminated, status -> suspended

Resume:
1. User clicks suspended session
2. POST /api/sessions/{id}/resume
3. New PTY spawned with --resume {uuid}
4. Previous conversation restored
```

### WebSocket Message Flow
```
Client -> Server:
- {"type": "input", "data": "..."}   # Keyboard input
- {"type": "resize", "data": {"cols": 80, "rows": 24}}

Server -> Client:
- {"type": "output", "data": "..."}   # PTY output
- {"type": "status", "data": "closed"} # Session closed
- {"type": "status", "data": "taken_over"} # Session taken over
```

## Security Considerations

1. **JWT Authentication**: All API and WebSocket connections require valid JWT
2. **Password Hashing**: Uses HMAC compare for password verification
3. **CORS**: Configurable allowed origins
4. **Rate Limiting**: Limiter applied to sensitive endpoints
5. **Path Traversal**: Path validation on file operations

## Scalability Notes

- Single-server architecture
- SQLite for simplicity (can be swapped for PostgreSQL)
- PTY processes run on same server
- For multi-server setup, would need:
  - Shared database
  - Session affinity/sticky sessions
  - Shared PTY state or session pinning
