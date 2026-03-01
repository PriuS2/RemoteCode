# Database Schema

## Overview

Remote Code uses SQLite with WAL (Write-Ahead Logging) mode for concurrent read/write operations. The database is managed through `aiosqlite` for async support.

## Tables

### sessions

Main table storing session information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID v4 session identifier |
| `claude_session_id` | TEXT | NULLABLE | Claude CLI session ID for --resume |
| `name` | TEXT | NOT NULL | Display name for the session |
| `work_path` | TEXT | NOT NULL | Working directory path |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp (UTC) |
| `last_accessed_at` | TEXT | NOT NULL | ISO 8601 timestamp (UTC) |
| `status` | TEXT | NOT NULL DEFAULT 'active' | Session status |
| `cli_type` | TEXT | NOT NULL DEFAULT 'claude' | CLI type (claude, opencode, terminal, custom) |
| `custom_command` | TEXT | NULLABLE | Custom command for custom CLI type |
| `custom_exit_command` | TEXT | NULLABLE | Custom exit command for custom CLI type |
| `order_index` | INTEGER | NOT NULL DEFAULT 0 | Display order in sidebar (ascending) |

**Status Values:**
- `active`: Session is running with PTY
- `suspended`: Session was suspended (--resume ID captured)
- `closed`: Session was terminated

**CLI Types:**
- `claude`: Claude Code CLI
- `opencode`: OpenCode CLI
- `terminal`: System terminal (PowerShell on Windows, bash on Linux/macOS)
- `custom`: Custom user-defined command

**Schema SQL:**
```sql
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    claude_session_id TEXT,
    name TEXT NOT NULL,
    work_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    cli_type TEXT NOT NULL DEFAULT 'claude',
    custom_command TEXT,
    custom_exit_command TEXT,
    order_index INTEGER NOT NULL DEFAULT 0
);
```

## Database Operations

### Initialization

```python
async def init_db() -> None:
    db = await get_db()
    await db.execute("""
        CREATE TABLE IF NOT EXISTS sessions (...)
    """)
    await db.execute("PRAGMA journal_mode=WAL")
    await db.commit()
```

WAL mode enables concurrent reads while writing, improving performance for the web interface.

### CRUD Operations

#### Create Session
```python
async def create_session(
    session_id: str,
    name: str,
    work_path: str
) -> dict:
    # Generates timestamps automatically
    # Returns complete session dict
```

#### Get Session
```python
async def get_session(session_id: str) -> dict | None:
    # Returns session dict or None if not found
```

#### List Sessions
```python
async def list_sessions() -> list[dict]:
    # Returns all sessions ordered by order_index ASC, created_at ASC
```

#### Update Session Order
```python
async def update_session_order(ordered_ids: list[str]) -> None:
    # Updates order_index for multiple sessions based on list position
    # Each session's index in the list becomes its order_index
```

#### Update Session
```python
async def update_session(session_id: str, **kwargs) -> None:
    # Allowed columns: claude_session_id, name, work_path, last_accessed_at, status
    # Raises ValueError for invalid columns
```

#### Update Last Accessed
```python
async def update_last_accessed(session_id: str) -> None:
    # Sets last_accessed_at to current UTC time
```

#### Delete Session
```python
async def delete_session(session_id: str) -> None:
    # Permanently removes session from database
```

### Lifecycle Operations

#### Mark All Active as Suspended

Called on server startup to handle crash recovery:

```python
async def mark_all_active_as_suspended() -> int:
    # UPDATE sessions SET status = 'suspended' WHERE status = 'active'
    # Returns count of affected sessions
```

This ensures that sessions from a previous server run are properly marked as suspended since their PTY processes are gone.

## Data Types

### Timestamps

All timestamps are stored as ISO 8601 formatted strings in UTC:
```python
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
```

Example: `"2024-01-15T08:30:00+00:00"`

### UUIDs

Session IDs are standard UUID v4 strings:
```python
session_id = str(uuid.uuid4())
# Example: "550e8400-e29b-41d4-a716-446655440000"
```

### Paths

Paths are stored as-is from the OS:
- Windows: `C:\Users\name\project`
- Linux/macOS: `/home/user/project`

Path normalization is handled at the application layer, not the database.

## Connection Management

### Global Connection

```python
_db: aiosqlite.Connection | None = None

async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(settings.db_path)
        _db.row_factory = aiosqlite.Row
    return _db
```

A single global connection is used throughout the application lifecycle.

### Cleanup

```python
async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None
```

Called during application shutdown.

## Configuration

Database path is configurable via environment variable:

```python
# config.py
class Settings(BaseSettings):
    db_path: str = "sessions.db"  # Default
    # Can be overridden with CCR_DB_PATH env var
```

## Migration Notes

Currently, the application uses auto-migration (CREATE TABLE IF NOT EXISTS). For future schema changes:

1. Add new columns with DEFAULT values
2. Use ALTER TABLE for schema modifications
3. Consider using a proper migration tool like `alembic` for complex changes

## Backup Recommendations

The SQLite database file (`sessions.db`) and its WAL file (`sessions.db-wal`) should be backed up together:

```bash
# Safe backup while running
sqlite3 sessions.db ".backup '/backup/sessions.db'"

# Or copy with WAL
rsync -av sessions.db sessions.db-wal sessions.db-shm /backup/
```

## Performance Considerations

1. **Indexing**: The `last_accessed_at` column is used for ordering. Consider adding an index if the table grows large:
   ```sql
   CREATE INDEX idx_sessions_last_accessed ON sessions(last_accessed_at DESC);
   ```

2. **WAL Mode**: Enabled for better concurrent performance

3. **Row Factory**: `aiosqlite.Row` allows dict-like access to columns

4. **Connection Reuse**: Single global connection reduces connection overhead
