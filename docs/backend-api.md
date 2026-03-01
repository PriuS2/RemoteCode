# Backend API

## Authentication

All API endpoints (except `/api/login` and `/api/health`) require JWT Bearer token in the Authorization header.

```
Authorization: Bearer <token>
```

Tokens are obtained via the `/api/login` endpoint and expire after 72 hours (configurable).

## Endpoints

### Authentication

#### POST `/api/login`
Login and obtain JWT token.

**Request:**
```json
{
  "password": "string"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401 Unauthorized`: Invalid password

#### GET `/api/verify`
Verify token validity.

**Response:**
```json
{
  "valid": true
}
```

### Sessions

#### GET `/api/sessions`
List all sessions ordered by `order_index` (custom user order), then by creation time.

**Response:**
```json
[
  {
    "id": "uuid",
    "claude_session_id": "uuid or null",
    "name": "Session Name",
    "work_path": "/path/to/project",
    "created_at": "2024-01-01T00:00:00+00:00",
    "last_accessed_at": "2024-01-01T00:00:00+00:00",
    "status": "active",
    "cli_type": "claude",
    "custom_command": null,
    "custom_exit_command": null,
    "order_index": 0
  }
]
```

**Fields:**
- `order_index`: User-defined display order (0 = first, ascending). Sessions can be reordered via drag-and-drop in the sidebar.

#### POST `/api/sessions`
Create a new session.

**Request:**
```json
{
  "work_path": "/path/to/project",
  "name": "Optional Name",
  "create_folder": false
}
```

**Response:**
```json
{
  "id": "uuid",
  "claude_session_id": null,
  "name": "Session Name",
  "work_path": "/path/to/project",
  "created_at": "2024-01-01T00:00:00+00:00",
  "last_accessed_at": "2024-01-01T00:00:00+00:00",
  "status": "active"
}
```

**Errors:**
- `400 Bad Request`: Directory does not exist
- `500 Internal Server Error`: PTY spawn failed

#### GET `/api/sessions/{session_id}`
Get session details.

**Response:** Same as session object above.

**Errors:**
- `404 Not Found`: Session not found

#### PATCH `/api/sessions/{session_id}/rename`
Rename a session.

**Request:**
```json
{
  "name": "New Name"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "New Name",
  ...
}
```

#### POST `/api/sessions/{session_id}/suspend`
Suspend an active session.

Sends `/exit` command to claude, captures the `--resume` UUID from output, and terminates the PTY process.

**Response:** Updated session object with `status: "suspended"`

**Errors:**
- `400 Bad Request`: Session not active
- `404 Not Found`: Session not found

#### POST `/api/sessions/{session_id}/resume`
Resume a suspended session.

Spawns a new PTY with `--resume {claude_session_id}` if available.

**Response:** Updated session object with `status: "active"`

**Errors:**
- `400 Bad Request`: Session not suspended/closed
- `404 Not Found`: Session not found

#### DELETE `/api/sessions/{session_id}`
Terminate or delete a session.

**Query Parameters:**
- `permanent` (bool): If true, permanently delete from database. If false, just terminate PTY.

**Response:** Deleted/terminated session object

**Errors:**
- `404 Not Found`: Session not found

#### POST `/api/sessions/reorder`
Update the order of sessions. Sessions are displayed in the sidebar according to this order.

**Request:**
```json
{
  "ordered_ids": ["session-id-1", "session-id-2", "session-id-3"]
}
```

The array should contain all session IDs in the desired order.

**Response:**
```json
{
  "detail": "Session order updated"
}
```

**Errors:**
- `500 Internal Server Error`: Failed to update order

### Files

#### GET `/api/files`
List directory contents.

**Query Parameters:**
- `path` (string): Directory path to list

**Response:**
```json
{
  "current": "/current/path",
  "parent": "/parent/path",
  "entries": [
    {
      "name": "filename",
      "type": "file|folder",
      "size": 1024,
      "modified": "2024-01-01T00:00:00",
      "extension": ".txt"
    }
  ],
  "drives": ["C:\\", "D:\\"] // Windows only
}
```

#### GET `/api/files/download`
Download a file.

**Query Parameters:**
- `path` (string): File path

**Response:** File content with appropriate content-type

**Errors:**
- `400 Bad Request`: Path is a directory
- `404 Not Found`: File not found

#### POST `/api/files/upload`
Upload a file.

**Request:** Multipart form data
- `file`: File content
- `path`: Target directory path (query parameter)

**Response:**
```json
{
  "filename": "uploaded.txt",
  "path": "/target/path/uploaded.txt",
  "size": 1024
}
```

### Git

#### GET `/api/git/status`
Get git status for a path.

**Query Parameters:**
- `path` (string): Working directory path

**Response:**
```json
{
  "is_git_repo": true,
  "branch": "main",
  "upstream": "origin/main",
  "ahead": 0,
  "behind": 0,
  "staged": [...],
  "unstaged": [...],
  "untracked": [...],
  "has_conflicts": false,
  "detached": false
}
```

#### GET `/api/git/diff`
Get diff for a file.

**Query Parameters:**
- `path` (string): File path
- `staged` (bool): Show staged changes

**Response:**
```json
{
  "file_path": "file.txt",
  "old_path": null,
  "hunks": [...],
  "is_binary": false,
  "additions": 10,
  "deletions": 5
}
```

#### GET `/api/git/branches`
List branches.

**Query Parameters:**
- `path` (string): Working directory path

**Response:**
```json
{
  "local": [...],
  "remote": [...],
  "current": "main",
  "detached": false
}
```

#### GET `/api/git/log`
Get commit log.

**Query Parameters:**
- `path` (string): Working directory path
- `max_count` (int): Maximum number of commits (default 50)

**Response:**
```json
{
  "commits": [...],
  "has_more": true
}
```

#### POST `/api/git/checkout`
Checkout a branch.

**Request:**
```json
{
  "path": "/working/path",
  "branch": "branch-name"
}
```

#### POST `/api/git/{command}`
Other git commands:
- `add`, `reset`, `discard`, `commit`, `push`, `pull`, `fetch`

See `backend/main.py` for detailed request/response schemas.

### Health

#### GET `/api/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## WebSocket

### Connection

Connect to `/ws/{session_id}?token={jwt_token}`

### Client -> Server Messages

#### Input
```json
{
  "type": "input",
  "data": "keyboard input"
}
```

#### Resize
```json
{
  "type": "resize",
  "data": {
    "cols": 80,
    "rows": 24
  }
}
```

### Server -> Client Messages

#### Output
```json
{
  "type": "output",
  "data": "terminal output"
}
```

#### Status
```json
{
  "type": "status",
  "data": "closed|taken_over"
}
```

## Error Handling

All errors follow the format:

```json
{
  "detail": "Error message"
}
```

Common HTTP status codes:
- `200 OK`: Success
- `400 Bad Request`: Invalid request
- `401 Unauthorized`: Authentication required
- `404 Not Found`: Resource not found
- `422 Validation Error`: Pydantic validation error
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error
