# Git Integration

## Overview

Remote Code provides comprehensive Git integration through the Git Panel component and backend Git utilities. All Git operations are performed asynchronously using subprocess calls.

## Backend Git Utilities

### GitError Exception

```python
class GitError(Exception):
    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode
```

### Core Functions

#### run_git
Execute a git command asynchronously.

```python
async def run_git(
    work_path: str,
    args: list[str],
    timeout: int = 30
) -> str
```

**Environment:**
- `GIT_TERMINAL_PROMPT=0`: Disable interactive prompts
- `GIT_ASKPASS=""`: Disable credential prompts
- `GIT_PAGER=""`: Disable pager

**Example:**
```python
output = await run_git("/project", ["status", "--porcelain=v2"])
```

#### is_git_repo
Check if a path is inside a git repository.

```python
async def is_git_repo(work_path: str) -> bool
```

#### get_git_root
Get the root directory of the git repository.

```python
async def get_git_root(work_path: str) -> str
```

## Git API Endpoints

### GET /api/git/status

Get comprehensive git status.

**Response:**
```json
{
  "is_git_repo": true,
  "branch": "main",
  "upstream": "origin/main",
  "ahead": 2,
  "behind": 0,
  "staged": [
    {
      "path": "file.txt",
      "status": "modified",
      "staged": true,
      "old_path": null
    }
  ],
  "unstaged": [...],
  "untracked": [...],
  "has_conflicts": false,
  "detached": false
}
```

### GET /api/git/diff

Get diff for a file.

**Query Parameters:**
- `path`: File path
- `staged`: Boolean, show staged changes

**Response:**
```json
{
  "file_path": "file.txt",
  "old_path": null,
  "hunks": [
    {
      "header": "@@ -1,5 +1,5 @@",
      "old_start": 1,
      "old_lines": 5,
      "new_start": 1,
      "new_lines": 5,
      "lines": [
        {
          "type": "context",
          "content": "line 1",
          "old_no": 1,
          "new_no": 1
        },
        {
          "type": "removal",
          "content": "old line",
          "old_no": 2,
          "new_no": null
        },
        {
          "type": "addition",
          "content": "new line",
          "old_no": null,
          "new_no": 2
        }
      ]
    }
  ],
  "is_binary": false,
  "additions": 1,
  "deletions": 1
}
```

### GET /api/git/branches

List all branches.

**Response:**
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
  "remote": [
    {
      "name": "origin/main",
      "is_current": false,
      "is_remote": true,
      "tracking": null,
      "ahead": 0,
      "behind": 0
    }
  ],
  "current": "main",
  "detached": false
}
```

### GET /api/git/log

Get commit history.

**Query Parameters:**
- `path`: Working directory
- `max_count`: Maximum commits (default 50)

**Response:**
```json
{
  "commits": [
    {
      "hash": "abc123",
      "parents": ["def456"],
      "author_name": "User Name",
      "author_email": "user@example.com",
      "date": "2024-01-01T00:00:00",
      "message": "Commit message",
      "ref_names": ["HEAD -> main"]
    }
  ],
  "has_more": true
}
```

### POST /api/git/checkout

Checkout a branch.

**Request:**
```json
{
  "path": "/working/path",
  "branch": "feature-branch"
}
```

**Response:** Same as branch info

### POST /api/git/add

Stage files.

**Request:**
```json
{
  "path": "/working/path",
  "files": ["file1.txt", "file2.txt"]
}
```

### POST /api/git/reset

Unstage files.

**Request:**
```json
{
  "path": "/working/path",
  "files": ["file1.txt"]
}
```

### POST /api/git/discard

Discard changes (git checkout --).

**Request:**
```json
{
  "path": "/working/path",
  "files": ["file1.txt"]
}
```

**Warning:** This permanently discards local changes!

### POST /api/git/commit

Create a commit.

**Request:**
```json
{
  "path": "/working/path",
  "message": "Commit message"
}
```

**Response:**
```json
{
  "success": true,
  "hash": "abc123def..."
}
```

### POST /api/git/push

Push to remote.

**Request:**
```json
{
  "path": "/working/path",
  "remote": "origin",
  "branch": "main"
}
```

### POST /api/git/pull

Pull from remote.

**Request:**
```json
{
  "path": "/working/path"
}
```

### POST /api/git/fetch

Fetch from remote.

**Request:**
```json
{
  "path": "/working/path",
  "remote": "origin"
}
```

## Frontend Git Panel

### Component Structure

```
GitPanel
├── Header (branch name, ahead/behind)
├── Action Bar (Pull, Push, Fetch)
├── Section: Conflicts (if any)
├── Section: Staged Changes
├── Section: Unstaged Changes
├── Section: Untracked Files
└── Commit Input (message + commit button)
```

### Features

#### Status Display
- Branch name with ahead/behind counts
- Detached HEAD indicator
- Conflict warnings

#### File Lists
- Checkboxes for staging/unstaging
- Click to view diff
- File icons based on extension

#### Diff Viewer
- Syntax-highlighted diff
- Line numbers (old/new)
- Hunk headers
- Addition/removal highlighting

#### Branch Management
- List local and remote branches
- Checkout with confirmation for uncommitted changes
- Current branch indicator

#### Commit Graph
- Visual commit history graph
- Branch/merge visualization
- Commit details on hover/click

### Graph Layout Algorithm

The commit graph uses a custom layout algorithm (`utils/gitGraph.ts`):

```typescript
interface GitLogEntry {
  hash: string;
  parents: string[];
  // ...
}

interface GraphNode {
  commit: GitLogEntry;
  x: number;  // Column (branch lane)
  y: number;  // Row (commit order)
  color: string;
}

export function computeGraphLayout(commits: GitLogEntry[]): GraphNode[]
```

**Algorithm Overview:**
1. Process commits in chronological order (newest first)
2. Assign each commit to a column (branch lane)
3. Track active branches and merge points
4. Assign colors to distinguish branches

## Git Workflow Integration

### Typical Workflow

1. **Check Status**
   - Open Git Panel
   - Review staged/unstaged changes

2. **Stage Changes**
   - Click checkbox next to modified files
   - Or click "Stage All"

3. **Review Diff**
   - Click filename to view diff
   - Check additions/deletions

4. **Commit**
   - Enter commit message
   - Click "Commit"

5. **Push/Pull**
   - Fetch to check for updates
   - Pull if behind
   - Push if ahead

### Conflict Resolution

When conflicts exist:
1. Warning banner displayed
2. Conflicted files listed separately
3. User must resolve in terminal (claude)
4. Refresh Git Panel to see resolved status

## Error Handling

Common Git errors:
- `GitError`: Command failed with stderr
- `TimeoutError`: Command exceeded timeout
- `FileNotFoundError`: Git not installed

Frontend displays user-friendly error messages.

## Performance Considerations

1. **Async Operations**: All git commands run in thread pool
2. **Timeouts**: Default 30s, configurable per command
3. **Caching**: No caching; fresh data on each API call
4. **Large Repositories**: Consider increasing timeout for large diffs
