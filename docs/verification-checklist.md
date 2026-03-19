# Verification Checklist

Use this checklist after feature work, release prep, or documentation changes that touch user flows.

## Preconditions

- `.env` is configured with a non-default `CCR_JWT_SECRET`
- Required CLI commands are available in `PATH`
- Python and frontend dependencies are installed

## 1. Frontend build

Run:

```bash
cd frontend
npm run build
```

Expect:

- build completes without TypeScript or Vite errors

## 2. Backend startup

Run the app in your normal dev or production mode.

Examples:

```bash
make dev
```

or

```bash
make start
```

Expect:

- backend starts successfully
- login page is reachable
- no immediate startup crash from config or DB initialization

## 3. Authentication

Check:

- login succeeds with `CCR_PASSWORD`
- page refresh preserves the logged-in session
- logout clears the session and returns to the login screen
- unauthenticated access to protected APIs returns `401`

Recommended spot checks:

- `GET /api/auth/session`
- `GET /api/sessions`
- `GET /api/opencode-web/status`

## 4. Session creation

From the New Session modal, verify:

- a normal `claude` session can be created
- if `kilo` is installed, a `kilo` session can be created
- a `terminal` session can be created
- if `opencode` is installed, an `opencode` session can be created
- preflight validation shows a clear failure when a required CLI is unavailable

Check session actions:

- open session
- rename session
- suspend session
- resume session
- delete session
- reorder sessions in the sidebar
- a suspended or closed `kilo` session shows that resume is unsupported and should be recreated

## 5. Terminal and WebSocket behavior

Check:

- terminal output appears after connecting
- typing input reaches the PTY
- resize updates terminal dimensions
- refreshing the page allows reconnecting to the same live session
- opening the same session in another tab causes the previous tab to show a takeover state

## 6. File explorer

Check:

- browse folders
- open a file preview
- download a file
- upload one or more files
- create a folder
- rename a file or folder
- delete a file or folder
- "Open Server Folder" launches the server-side file explorer action

Preview spot checks:

- text file via `/api/file-content`
- image or audio file via `/api/file-raw`
- large text file windowing still works

## 7. Git panel

Inside a Git repository, verify:

- status loads
- staged, unstaged, and untracked sections render
- diff view opens
- branch list loads
- checkout works
- create branch works
- commit works
- pull and push return output
- stash list, stash, stash-pop, and stash-drop work

Outside a Git repository, verify:

- the panel shows the non-repository empty state without breaking layout

## 8. OpenCode Web

If `opencode` is installed, verify:

- `POST /api/opencode-web/start` starts the service
- `/api/opencode-web/proxy/` opens successfully in a new tab
- proxied assets load correctly through the backend path
- `POST /api/opencode-web/stop` stops the service
- unauthenticated access to the proxy is rejected

## 9. Documentation spot check

Before closing the task, verify:

- README commands still match the actual scripts
- documented API paths match `backend/main.py`
- auth documentation describes cookie-based browser login
- newly added docs are linked from `docs/README.md`
