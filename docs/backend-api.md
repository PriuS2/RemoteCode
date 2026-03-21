# Backend API

This document describes the API implemented in `backend/main.py`.

## Authentication model

Remote Code authenticates browser clients with a password login and an `HttpOnly` cookie.

- Primary flow: `POST /api/auth/login` sets the `remote_code_session` cookie.
- Browser requests should use `credentials: "same-origin"`.
- Most endpoints also accept `Authorization: Bearer <token>` because the backend still supports that
  path internally, but the browser app does not rely on it.
- The terminal WebSocket accepts the cookie automatically. A `?token=` query parameter is also
  accepted as a compatibility fallback.

All endpoints except `POST /api/auth/login` and `GET /api/health` require authentication.

## Authentication endpoints

### POST `/api/auth/login`

Authenticate with the configured password.

Request:

```json
{
  "password": "string"
}
```

Response:

```json
{
  "authenticated": true
}
```

Notes:

- Sets the `remote_code_session` cookie.
- Rate limited to `5/minute` per client IP.

### POST `/api/auth/logout`

Clear the auth cookie.

Response:

```json
{
  "authenticated": false
}
```

### GET `/api/auth/session`

Check whether the current cookie/session is valid.

Response:

```json
{
  "authenticated": true
}
```

## Health endpoint

### GET `/api/health`

Response:

```json
{
  "status": "ok"
}
```

## Browse and file endpoints

### GET `/api/browse`

Browse folders for the folder picker UI.

Query parameters:

- `path` optional, defaults to the current user's home directory

Response:

```json
{
  "current": "C:\\Users\\name",
  "parent": "C:\\Users",
  "folders": ["Desktop", "Documents"],
  "drives": ["C:\\", "D:\\"],
  "user_folders": [
    { "label": "Desktop", "path": "C:\\Users\\name\\Desktop" }
  ]
}
```

### GET `/api/files`

List files and folders in a directory.

Query parameters:

- `path` optional, defaults to the current user's home directory

Response:

```json
{
  "current": "C:\\work",
  "parent": "C:\\",
  "entries": [
    {
      "name": "README.md",
      "type": "file",
      "size": 1024,
      "modified": "2026-03-19T01:23:45+00:00",
      "extension": ".md"
    },
    {
      "name": "src",
      "type": "folder",
      "size": null,
      "modified": "2026-03-19T01:23:45+00:00",
      "extension": null
    }
  ],
  "drives": ["C:\\", "D:\\"]
}
```

### GET `/api/file-content`

Read a text file for preview.

Query parameters:

- `path` required
- `start_line` optional, default `1`
- `line_count` optional, default `400`, max `2000`

Behavior:

- Files up to 512 KB return full content.
- Larger files return a line window plus pagination metadata.

Response:

```json
{
  "content": "line 1\nline 2",
  "size": 12345,
  "truncated": true,
  "start_line": 1,
  "end_line": 400,
  "total_lines": 1200,
  "has_prev": false,
  "has_next": true
}
```

### GET `/api/file-raw`

Download or stream a raw file.

Query parameters:

- `path` required

Behavior:

- Rejects files larger than 20 MB.

## IDE endpoints

### GET `/api/ide/sessions/{session_id}/file`

Load a file into an IDE session editor.

Query parameters:

- `path` required

Response:

```json
{
  "path": "C:\\repo\\src\\app.ts",
  "content": "export const ok = true;\n",
  "version": "1742610192000000000:25",
  "readonly": false,
  "too_large": false,
  "language_id": "typescript",
  "size": 25
}
```

Notes:

- The path must stay inside the IDE session project root.
- Files larger than 1 MB are returned with `too_large=true` and `readonly=true`.
- Binary or non-UTF-8 files open read-only with empty editor content.

### PUT `/api/ide/sessions/{session_id}/file`

Save a file from an IDE session editor.

Request:

```json
{
  "path": "C:\\repo\\src\\app.ts",
  "content": "export const ok = false;\n",
  "expected_version": "1742610192000000000:25"
}
```

Response:

```json
{
  "path": "C:\\repo\\src\\app.ts",
  "version": "1742610293000000000:26",
  "size": 26,
  "language_id": "typescript"
}
```

Notes:

- Saves use optimistic concurrency and return `409` with structured detail when the on-disk version differs from `expected_version`.

### GET `/api/ide/sessions/{session_id}/languages`

Return supported IDE language status.

Response:

```json
[
  {
    "language_id": "python",
    "label": "Python",
    "transport": "lsp",
    "available": true,
    "detail": "Uses pyright-langserver over stdio.",
    "extensions": [".py", ".pyi", ".pyw"]
  }
]
```

### POST `/api/mkdir`

Create a directory inside an existing parent directory.

Request:

```json
{
  "path": "C:\\work",
  "name": "new-folder"
}
```

Response:

```json
{
  "path": "C:\\work\\new-folder"
}
```

### POST `/api/rename`

Rename a file or directory within the same parent directory.

Request:

```json
{
  "path": "C:\\work",
  "oldName": "old.txt",
  "newName": "new.txt"
}
```

Response:

```json
{
  "path": "C:\\work\\new.txt"
}
```

### POST `/api/delete`

Delete a file or directory within the supplied parent directory.

Request:

```json
{
  "path": "C:\\work",
  "name": "old.txt"
}
```

Response:

```json
{
  "success": true
}
```

### POST `/api/upload`

Upload one or more files to an existing directory.

Request:

- Query parameter: `path`
- Multipart body: `files`

Response:

```json
{
  "uploaded": [
    { "name": "notes.txt", "size": 5120 }
  ],
  "count": 1
}
```

Limits:

- 100 MB per file

### POST `/api/open-explorer`

Open a folder with the server OS file explorer.

Request:

```json
{
  "path": "C:\\work"
}
```

Response:

```json
{
  "success": true
}
```

## Session endpoints

### Session object

```json
{
  "id": "uuid",
  "claude_session_id": "uuid-or-null",
  "cli_type": "claude",
  "name": "Session Name",
  "work_path": "C:\\work",
  "created_at": "2026-03-19T01:23:45+00:00",
  "last_accessed_at": "2026-03-19T01:23:45+00:00",
  "status": "active",
  "custom_command": null,
  "custom_exit_command": null
}
```

### POST `/api/sessions/preflight`

Validate a session configuration before creation.

Request:

```json
{
  "work_path": "C:\\work",
  "name": "Optional Name",
  "create_folder": false,
  "cli_type": "claude",
  "custom_command": null,
  "custom_exit_command": null
}
```

Response:

```json
{
  "ok": true,
  "code": "ok",
  "message": "Claude Code CLI is available.",
  "resolved_command": "claude"
}
```

Failure uses the same shape with `ok: false`.

### GET `/api/sessions`

List sessions in sidebar order.

Response:

```json
[
  {
    "id": "uuid",
    "claude_session_id": null,
    "cli_type": "claude",
    "name": "Project",
    "work_path": "C:\\work",
    "created_at": "2026-03-19T01:23:45+00:00",
    "last_accessed_at": "2026-03-19T02:00:00+00:00",
    "status": "active",
    "custom_command": null,
    "custom_exit_command": null
  }
]
```

### POST `/api/sessions`

Create a session.

Request:

```json
{
  "work_path": "C:\\work",
  "name": "Project",
  "create_folder": false,
  "cli_type": "claude",
  "custom_command": null,
  "custom_exit_command": null
}
```

Response:

- Session object

Notes:

- `cli_type` may be `claude`, `kilo`, `opencode`, `opencode-web`, `terminal`, or `custom`.
- `kilo` sessions can be created and run, but suspend/resume returns `400` with structured error detail.
- Validation failures return `400` with structured error detail.

Structured error shape used by this endpoint:

```json
{
  "detail": {
    "code": "cli_not_found",
    "message": "Selected CLI was not found."
  }
}
```

### POST `/api/sessions/{session_id}/suspend`

Suspend an active session.

Response:

- Updated session object

### POST `/api/sessions/{session_id}/resume`

Resume a suspended session.

Response:

- Updated session object

### PATCH `/api/sessions/{session_id}/rename`

Rename a session.

Request:

```json
{
  "name": "New Name"
}
```

Response:

```json
{
  "detail": "Session renamed",
  "name": "New Name"
}
```

### DELETE `/api/sessions/{session_id}`

Terminate or permanently delete a session.

Query parameters:

- `permanent=false` default, terminate only
- `permanent=true`, remove from storage

Responses:

- Terminate: updated session object
- Permanent delete:

```json
{
  "detail": "Session deleted"
}
```

### POST `/api/sessions/reorder`

Persist sidebar order.

Request:

```json
{
  "ordered_ids": ["session-1", "session-2", "session-3"]
}
```

Response:

```json
{
  "detail": "Session order updated"
}
```

## Git endpoints

All Git endpoints require a repository `path` unless noted otherwise.

### GET `/api/git/status`

Response:

```json
{
  "is_git_repo": true,
  "branch": "main",
  "upstream": "origin/main",
  "ahead": 0,
  "behind": 0,
  "staged": [],
  "unstaged": [],
  "untracked": [],
  "has_conflicts": false,
  "detached": false
}
```

If the path is not a repository, the backend returns:

```json
{
  "is_git_repo": false
}
```

### GET `/api/git/log`

Query parameters:

- `path` required
- `skip` optional, default `0`
- `count` optional, default `50`

Response:

```json
{
  "commits": [
    {
      "hash": "full-hash",
      "short_hash": "abc1234",
      "author_name": "User",
      "author_email": "user@example.com",
      "date": "2026-03-19T01:23:45+00:00",
      "message": "Commit subject",
      "refs": ["HEAD -> main", "origin/main"],
      "parents": ["parent-hash"]
    }
  ],
  "has_more": true
}
```

### GET `/api/git/branches`

Response:

```json
{
  "local": [
    {
      "name": "main",
      "is_current": true,
      "is_remote": false,
      "tracking": "origin/main",
      "ahead": 0,
      "behind": 0
    }
  ],
  "remote": [],
  "current": "main",
  "detached": false
}
```

### GET `/api/git/diff`

Query parameters:

- `path` required
- `file` required
- `staged` optional, default `false`

Response:

```json
{
  "file_path": "src/app.ts",
  "old_path": null,
  "hunks": [],
  "is_binary": false,
  "additions": 10,
  "deletions": 5
}
```

### GET `/api/git/commit-detail`

Query parameters:

- `path` required
- `hash` required

Response:

```json
{
  "hash": "full-hash",
  "author_name": "User",
  "author_email": "user@example.com",
  "date": "2026-03-19T01:23:45+00:00",
  "message": "Commit subject\n\nBody",
  "parents": ["parent-hash"],
  "files": [
    {
      "path": "src/app.ts",
      "status": "M",
      "staged": false,
      "old_path": null
    }
  ],
  "additions": 10,
  "deletions": 5
}
```

### GET `/api/git/commit-diff`

Query parameters:

- `path` required
- `hash` required
- `file` required

Response shape matches `/api/git/diff`.

### POST `/api/git/stage`

Request:

```json
{
  "path": "C:\\repo",
  "files": ["src/app.ts"]
}
```

Response:

```json
{
  "success": true
}
```

### POST `/api/git/unstage`

Same request and response shape as `/api/git/stage`.

### POST `/api/git/discard`

Same request and response shape as `/api/git/stage`.

### POST `/api/git/commit`

Request:

```json
{
  "path": "C:\\repo",
  "message": "Commit message"
}
```

Response:

```json
{
  "success": true,
  "output": "[main abc1234] Commit message"
}
```

### POST `/api/git/checkout`

Request:

```json
{
  "path": "C:\\repo",
  "branch": "feature/docs"
}
```

Response:

```json
{
  "success": true
}
```

### POST `/api/git/create-branch`

Request:

```json
{
  "path": "C:\\repo",
  "name": "feature/docs",
  "checkout": true
}
```

Response:

```json
{
  "success": true,
  "branch": "feature/docs"
}
```

### POST `/api/git/pull`

Request:

```json
{
  "path": "C:\\repo"
}
```

Response:

```json
{
  "success": true,
  "output": "git pull output"
}
```

### POST `/api/git/push`

Request:

```json
{
  "path": "C:\\repo"
}
```

Response:

```json
{
  "success": true,
  "output": "git push output"
}
```

Notes:

- If no upstream exists, the backend uses `git push --set-upstream origin HEAD`.

### GET `/api/git/stash-list`

Response:

```json
{
  "stashes": [
    {
      "index": 0,
      "message": "WIP on main"
    }
  ]
}
```

### POST `/api/git/stash`

Request:

```json
{
  "path": "C:\\repo",
  "message": "Optional stash message"
}
```

Response:

```json
{
  "success": true,
  "output": "Saved working directory and index state"
}
```

### POST `/api/git/stash-pop`

Request:

```json
{
  "path": "C:\\repo"
}
```

Response:

```json
{
  "success": true,
  "output": "stash pop output"
}
```

### POST `/api/git/stash-drop`

Request:

```json
{
  "path": "C:\\repo"
}
```

Response:

```json
{
  "success": true,
  "output": "Dropped refs/stash@{0}"
}
```

## OpenCode Web endpoints

### GET `/api/opencode-web/status`

Response:

```json
{
  "running": true,
  "port": 8096
}
```

### POST `/api/opencode-web/start`

Response:

```json
{
  "port": 8096
}
```

### POST `/api/opencode-web/stop`

Response:

```json
{
  "success": true
}
```

### `/api/opencode-web/proxy` and `/api/opencode-web/proxy/{path}`

Proxy the locally running OpenCode Web service through the authenticated backend.

Supported methods:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Behavior:

- Requires authentication
- Returns `503` if OpenCode Web is not running
- Rewrites HTML, CSS, and redirect locations so assets stay under the proxy prefix

## WebSocket endpoint

### WS `/ws/terminal/{session_id}`

Authentication:

- Preferred: auth cookie from the browser
- Fallback: `?token=<jwt>`

Close/status behavior:

- `4401`: unauthorized
- `4404`: session not found
- `4409`: session taken over by another client

Client to server messages:

```json
{ "type": "input", "data": "ls\r" }
```

```json
{ "type": "resize", "data": { "cols": 120, "rows": 40 } }
```

```json
{
  "type": "mouse",
  "data": {
    "event": "press",
    "button": 0,
    "x": 10,
    "y": 5,
    "modifiers": { "shift": false, "ctrl": false, "alt": false }
  }
}
```

Server to client messages:

```json
{ "type": "output", "data": "terminal output" }
```

```json
{ "type": "status", "data": "closed" }
```

Other status values:

- `taken_over`
- `not_found`

### WS `/ws/ide/{session_id}/lsp/{language_id}`

Language-server proxy WebSocket for IDE sessions.

Authentication:

- Preferred: auth cookie from the browser
- Fallback: `?token=<jwt>`

Behavior:

- Only available for `cli_type="ide"` sessions.
- Accepts JSON-RPC request/notification payloads from the browser and relays them to the language server stdio process.
- Returns `4404` when the session is not an IDE session or the requested language server is unavailable.

## Error responses

Most endpoints return:

```json
{
  "detail": "Error message"
}
```

Session creation uses structured validation errors when possible:

```json
{
  "detail": {
    "code": "cli_not_found",
    "message": "Selected CLI was not found."
  }
}
```

Common status codes:

- `400` invalid request or invalid state
- `401` authentication required or expired
- `403` access denied
- `404` resource not found
- `422` validation error
- `429` login rate limit exceeded
- `500` internal server error
- `503` OpenCode Web proxy target unavailable
