import asyncio
import logging
import os
import platform
import string
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse

from .auth import (
    create_access_token,
    get_current_user,
    verify_password,
    verify_ws_token,
)
from .config import _INSECURE_JWT_SECRET, settings
from .database import close_db, init_db, mark_all_active_as_suspended
from .pty_manager import pty_manager
from .session_manager import session_manager
from .git_utils import GitError, run_git, is_git_repo
from .websocket import handle_terminal_ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Drive list cache (Windows only, TTL 30s)
_drive_cache: list[str] = []
_drive_cache_time: float = 0
_DRIVE_CACHE_TTL = 30.0


def _get_drives() -> list[str]:
    global _drive_cache, _drive_cache_time
    if os.name != "nt":
        return []
    now = time.monotonic()
    if _drive_cache and (now - _drive_cache_time) < _DRIVE_CACHE_TTL:
        return _drive_cache
    drives = []
    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        if os.path.exists(drive):
            drives.append(drive)
    _drive_cache = drives
    _drive_cache_time = now
    return drives


def get_real_ip(request: Request) -> str:
    """Cloudflare 프록시 뒤의 실제 클라이언트 IP"""
    return (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "127.0.0.1")
    )


limiter = Limiter(key_func=get_real_ip)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.jwt_secret == _INSECURE_JWT_SECRET:
        raise RuntimeError(
            "JWT secret is still the default value. "
            "Set CCR_JWT_SECRET environment variable to a secure random string."
        )
    await init_db()
    await mark_all_active_as_suspended()
    logger.info("Server started")
    yield
    pty_manager.terminate_all()
    await close_db()
    logger.info("Server stopped")


app = FastAPI(title="Remote Code", lifespan=lifespan)
app.state.limiter = limiter

_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
_allow_credentials = True
if "*" in _origins:
    logger.warning(
        "CORS allowed_origins is set to '*'. "
        "Disabling allow_credentials for security. "
        "Set CCR_ALLOWED_ORIGINS to specific origins to enable credentials."
    )
    _allow_credentials = False
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many login attempts. Please try again later."},
    )


# --- Request/Response Models ---

class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CreateSessionRequest(BaseModel):
    work_path: str
    name: str | None = None
    create_folder: bool = False


class RenameSessionRequest(BaseModel):
    name: str


class SessionResponse(BaseModel):
    id: str
    claude_session_id: str | None = None
    name: str
    work_path: str
    created_at: str
    last_accessed_at: str
    status: str


# --- Auth API (인증 불필요) ---

@app.post("/api/auth/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest):
    if not verify_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    token = create_access_token()
    return TokenResponse(access_token=token)


# --- Health Check (인증 불필요) ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# --- Browse API (인증 필요) ---

class UserFolder(BaseModel):
    label: str
    path: str

class BrowseResponse(BaseModel):
    current: str
    parent: str | None = None
    folders: list[str]
    drives: list[str] | None = None
    user_folders: list[UserFolder] | None = None


@app.get("/api/browse", response_model=BrowseResponse)
async def browse_directory(
    path: str = "", _user: str = Depends(get_current_user)
):
    if not path:
        path = os.path.expanduser("~")

    path = os.path.abspath(path)

    drives = _get_drives()

    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    parent = os.path.dirname(path)
    if parent == path:
        parent = None

    folders = []
    try:
        for entry in sorted(os.scandir(path), key=lambda e: e.name.lower()):
            if entry.is_dir():
                try:
                    entry.name.encode("utf-8")
                    folders.append(entry.name)
                except (PermissionError, OSError):
                    pass
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {path}")

    # User preset folders
    home = os.path.expanduser("~")
    user_folders = []
    for label, folder_name in [("Desktop", "Desktop"), ("Documents", "Documents"), ("Downloads", "Downloads")]:
        fp = os.path.join(home, folder_name)
        if os.path.isdir(fp):
            user_folders.append(UserFolder(label=label, path=fp))

    return BrowseResponse(
        current=path, parent=parent, folders=folders,
        drives=drives, user_folders=user_folders or None,
    )


class FileEntry(BaseModel):
    name: str
    type: str           # "file" | "folder"
    size: int | None = None
    modified: str | None = None
    extension: str | None = None


class FilesResponse(BaseModel):
    current: str
    parent: str | None = None
    entries: list[FileEntry] = []
    drives: list[str] | None = None


@app.get("/api/files", response_model=FilesResponse)
async def list_files(
    path: str = "", _user: str = Depends(get_current_user)
):
    if not path:
        path = os.path.expanduser("~")

    path = os.path.abspath(path)

    drives = _get_drives()

    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    parent = os.path.dirname(path)
    if parent == path:
        parent = None

    folders: list[FileEntry] = []
    files: list[FileEntry] = []

    try:
        for entry in sorted(os.scandir(path), key=lambda e: e.name.lower()):
            try:
                entry.name.encode("utf-8")
            except (UnicodeEncodeError, OSError):
                continue

            try:
                stat = entry.stat(follow_symlinks=False)
                modified = datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat()
            except (PermissionError, OSError):
                modified = None

            if entry.is_dir(follow_symlinks=False):
                folders.append(FileEntry(
                    name=entry.name,
                    type="folder",
                    size=None,
                    modified=modified,
                    extension=None,
                ))
            elif entry.is_file(follow_symlinks=False):
                ext = os.path.splitext(entry.name)[1].lower() or None
                try:
                    size = stat.st_size if modified else None
                except Exception:
                    size = None
                files.append(FileEntry(
                    name=entry.name,
                    type="file",
                    size=size,
                    modified=modified,
                    extension=ext,
                ))
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {path}")

    return FilesResponse(
        current=path,
        parent=parent,
        entries=folders + files,
        drives=drives or None,
    )


class OpenExplorerRequest(BaseModel):
    path: str


@app.post("/api/open-explorer")
async def open_in_explorer(
    req: OpenExplorerRequest, _user: str = Depends(get_current_user)
):
    path = os.path.abspath(req.path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(path)
        elif system == "Darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return {"success": True}
    except Exception as e:
        logger.error(f"open_in_explorer error: {e}")
        raise HTTPException(status_code=500, detail="Failed to open explorer")


@app.get("/api/file-content")
async def read_file_content(
    path: str, _user: str = Depends(get_current_user)
):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")

    MAX_SIZE = 512 * 1024  # 512KB
    try:
        size = os.path.getsize(path)
        truncated = size > MAX_SIZE
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(MAX_SIZE)
        return {
            "content": content,
            "size": size,
            "truncated": truncated,
        }
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {path}")
    except Exception as e:
        logger.error(f"read_file_content error: {e}")
        raise HTTPException(status_code=500, detail="Failed to read file")


@app.get("/api/file-raw")
async def raw_file(
    path: str, _user: str = Depends(get_current_user)
):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")
    MAX_SIZE = 20 * 1024 * 1024  # 20MB
    try:
        if os.path.getsize(path) > MAX_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {path}")
    return FileResponse(path)


def _validate_name(name: str) -> None:
    """Validate a file/folder name. Raises HTTPException on invalid input."""
    if sys.platform == "win32":
        _INVALID_CHARS = set('/<>:"\\|?*\0')
        _RESERVED_NAMES = {
            "CON", "PRN", "AUX", "NUL",
            *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10)),
        }
    else:
        _INVALID_CHARS = set('/\0')
        _RESERVED_NAMES: set[str] = set()
    if (
        not name
        or name in (".", "..")
        or any(c in _INVALID_CHARS for c in name)
        or (sys.platform == "win32" and name.upper().split(".")[0] in _RESERVED_NAMES)
        or (sys.platform == "win32" and name.endswith((" ", ".")))
    ):
        raise HTTPException(status_code=400, detail="Invalid name")


class MkdirRequest(BaseModel):
    path: str
    name: str


@app.post("/api/mkdir")
async def make_directory(
    req: MkdirRequest, _user: str = Depends(get_current_user)
):
    parent = os.path.abspath(req.path)
    if not os.path.isdir(parent):
        raise HTTPException(status_code=400, detail=f"Parent not found: {parent}")

    name = req.name.strip()
    _validate_name(name)

    target = os.path.join(parent, name)
    if os.path.exists(target):
        raise HTTPException(status_code=400, detail=f"Already exists: {name}")

    try:
        os.makedirs(target)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {parent}")
    except Exception as e:
        logger.error(f"make_directory error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create directory")

    return {"path": target}


class RenameRequest(BaseModel):
    path: str
    oldName: str
    newName: str


@app.post("/api/rename")
async def rename_entry(
    req: RenameRequest, _user: str = Depends(get_current_user)
):
    parent = os.path.abspath(req.path)
    if not os.path.isdir(parent):
        raise HTTPException(status_code=400, detail=f"Parent not found: {parent}")

    new_name = req.newName.strip()
    _validate_name(new_name)

    old_path = os.path.join(parent, req.oldName)
    if not os.path.exists(old_path):
        raise HTTPException(status_code=400, detail=f"Not found: {req.oldName}")

    new_path = os.path.join(parent, new_name)
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail=f"Already exists: {new_name}")

    try:
        os.rename(old_path, new_path)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {parent}")
    except Exception as e:
        logger.error(f"rename_entry error: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename")

    return {"path": new_path}


class DeleteRequest(BaseModel):
    path: str
    name: str


@app.post("/api/delete")
async def delete_entry(
    req: DeleteRequest, _user: str = Depends(get_current_user)
):
    import shutil

    parent = os.path.abspath(req.path)
    if not os.path.isdir(parent):
        raise HTTPException(status_code=400, detail=f"Parent not found: {parent}")

    target = os.path.join(parent, req.name)
    if not os.path.exists(target):
        raise HTTPException(status_code=400, detail=f"Not found: {req.name}")

    # Prevent deleting the parent directory itself
    if os.path.abspath(target) == parent:
        raise HTTPException(status_code=400, detail="Cannot delete current directory")

    try:
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {target}")
    except Exception as e:
        logger.error(f"delete_entry error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete")

    return {"deleted": req.name}


@app.post("/api/upload")
async def upload_files(
    path: str = Query(...),
    files: list[UploadFile] = File(...),
    _user: str = Depends(get_current_user),
):
    target_dir = os.path.abspath(path)
    if not os.path.isdir(target_dir):
        raise HTTPException(status_code=400, detail=f"Not a directory: {target_dir}")

    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB per file
    uploaded = []
    for f in files:
        if not f.filename:
            continue
        # Sanitize: use only the filename part (no path traversal)
        name = os.path.basename(f.filename)
        if not name:
            continue
        dest = os.path.join(target_dir, name)
        try:
            size = 0
            with open(dest, "wb") as out:
                while chunk := await f.read(64 * 1024):
                    size += len(chunk)
                    if size > MAX_FILE_SIZE:
                        out.close()
                        os.remove(dest)
                        raise HTTPException(
                            status_code=400,
                            detail=f"File too large: {name} (max 100MB)",
                        )
                    out.write(chunk)
            uploaded.append({"name": name, "size": size})
        except HTTPException:
            raise
        except PermissionError:
            raise HTTPException(status_code=403, detail=f"Access denied: {target_dir}")
        except Exception as e:
            logger.error(f"upload_files error: {e}")
            raise HTTPException(status_code=500, detail="Failed to upload file")

    return {"uploaded": uploaded, "count": len(uploaded)}


# --- Session API (인증 필요) ---

@app.get("/api/sessions", response_model=list[SessionResponse])
async def list_sessions(_user: str = Depends(get_current_user)):
    sessions = await session_manager.list_sessions()
    return sessions


@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest, _user: str = Depends(get_current_user)
):
    try:
        session = await session_manager.create_session(
            work_path=req.work_path,
            name=req.name,
            create_folder=req.create_folder,
        )
        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"create_session unexpected error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Failed to create session")


@app.post("/api/sessions/{session_id}/suspend", response_model=SessionResponse)
async def suspend_session(
    session_id: str, _user: str = Depends(get_current_user)
):
    try:
        session = await session_manager.suspend_session(session_id)
        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/sessions/{session_id}/resume", response_model=SessionResponse)
async def resume_session(
    session_id: str, _user: str = Depends(get_current_user)
):
    try:
        session = await session_manager.resume_session(session_id)
        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/sessions/{session_id}/rename")
async def rename_session(
    session_id: str, req: RenameSessionRequest, _user: str = Depends(get_current_user)
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    try:
        from .database import update_session as db_update_session  # noqa: avoid circular import
        await db_update_session(session_id, name=name)
        return {"detail": "Session renamed", "name": name}
    except Exception as e:
        logger.error(f"rename_session error: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename session")


@app.delete("/api/sessions/{session_id}")
async def terminate_or_delete_session(
    session_id: str,
    permanent: bool = False,
    _user: str = Depends(get_current_user),
):
    try:
        if permanent:
            await session_manager.delete_session(session_id)
            return {"detail": "Session deleted"}
        else:
            session = await session_manager.terminate_session(session_id)
            return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- WebSocket (토큰 쿼리 파라미터로 인증) ---

@app.websocket("/ws/terminal/{session_id}")
async def websocket_terminal(
    ws: WebSocket, session_id: str, token: str = Query(default="")
):
    if not verify_ws_token(token):
        await ws.close(code=4001, reason="Unauthorized")
        return
    await handle_terminal_ws(ws, session_id)


# --- Git API Models ---


class GitStatusFile(BaseModel):
    path: str
    status: str  # M/A/D/?/R/C/U
    staged: bool
    old_path: str | None = None


class GitStatusResponse(BaseModel):
    is_git_repo: bool
    branch: str | None = None
    upstream: str | None = None
    ahead: int = 0
    behind: int = 0
    staged: list[GitStatusFile] = []
    unstaged: list[GitStatusFile] = []
    untracked: list[GitStatusFile] = []
    has_conflicts: bool = False
    detached: bool = False


class GitLogEntry(BaseModel):
    hash: str
    short_hash: str
    author_name: str
    author_email: str
    date: str
    message: str
    refs: list[str]
    parents: list[str]


class GitLogResponse(BaseModel):
    commits: list[GitLogEntry]
    has_more: bool


class GitBranchInfo(BaseModel):
    name: str
    is_current: bool
    is_remote: bool
    tracking: str | None = None
    ahead: int = 0
    behind: int = 0


class GitBranchesResponse(BaseModel):
    local: list[GitBranchInfo]
    remote: list[GitBranchInfo]
    current: str | None = None
    detached: bool = False


class GitDiffHunk(BaseModel):
    header: str
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    lines: list[dict]


class GitDiffResponse(BaseModel):
    file_path: str
    old_path: str | None = None
    hunks: list[GitDiffHunk]
    is_binary: bool = False
    additions: int = 0
    deletions: int = 0


class GitCommitRequest(BaseModel):
    path: str
    message: str


class GitStageRequest(BaseModel):
    path: str
    files: list[str]


class GitCheckoutRequest(BaseModel):
    path: str
    branch: str


class GitCreateBranchRequest(BaseModel):
    path: str
    name: str
    checkout: bool = True


class GitPullPushRequest(BaseModel):
    path: str


class GitCommitDetailResponse(BaseModel):
    hash: str
    author_name: str
    author_email: str
    date: str
    message: str
    parents: list[str]
    files: list[GitStatusFile]
    additions: int = 0
    deletions: int = 0


# --- Git API Endpoints ---


def _parse_status_porcelain_v2(output: str) -> dict:
    """Parse git status --porcelain=v2 --branch output."""
    branch = None
    upstream = None
    ahead = 0
    behind = 0
    staged: list[dict] = []
    unstaged: list[dict] = []
    untracked: list[dict] = []
    has_conflicts = False
    detached = False

    for line in output.splitlines():
        if line.startswith("# branch.head "):
            branch = line[len("# branch.head "):]
            if branch == "(detached)":
                detached = True
                branch = None
        elif line.startswith("# branch.upstream "):
            upstream = line[len("# branch.upstream "):]
        elif line.startswith("# branch.ab "):
            parts = line.split()
            for p in parts:
                if p.startswith("+"):
                    try:
                        ahead = int(p)
                    except ValueError:
                        pass
                elif p.startswith("-"):
                    try:
                        behind = abs(int(p))
                    except ValueError:
                        pass
        elif line.startswith("? "):
            file_path = line[2:]
            untracked.append({"path": file_path, "status": "?", "staged": False, "old_path": None})
        elif line.startswith("u "):
            # Conflict entry
            has_conflicts = True
            parts = line.split("\t")
            file_path = parts[-1] if "\t" in line else line.split()[-1]
            staged.append({"path": file_path, "status": "U", "staged": True, "old_path": None})
        elif line.startswith("1 "):
            # Ordinary changed entry: 1 XY sub mH mI mW hH hI path
            parts = line.split(" ", 8)
            if len(parts) < 9:
                continue
            xy = parts[1]
            file_path = parts[8]
            index_status = xy[0]
            worktree_status = xy[1]
            if index_status != ".":
                staged.append({"path": file_path, "status": index_status, "staged": True, "old_path": None})
            if worktree_status != ".":
                unstaged.append({"path": file_path, "status": worktree_status, "staged": False, "old_path": None})
        elif line.startswith("2 "):
            # Rename/copy entry: 2 XY sub mH mI mW hH hI Xscore path\torigPath
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            header_parts = parts[0].split(" ", 9)
            if len(header_parts) < 10:
                continue
            xy = header_parts[1]
            score_and_path = header_parts[9]
            # score_and_path is like "R100 newpath" — but actually the format is:
            # 2 XY sub mH mI mW hH hI Xscore path\torigPath
            new_path = score_and_path
            old_path = parts[1]
            index_status = xy[0]
            worktree_status = xy[1]
            if index_status != ".":
                status_char = "R" if index_status == "R" else index_status
                staged.append({"path": new_path, "status": status_char, "staged": True, "old_path": old_path})
            if worktree_status != ".":
                status_char = "R" if worktree_status == "R" else worktree_status
                unstaged.append({"path": new_path, "status": status_char, "staged": False, "old_path": old_path})

    return {
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "has_conflicts": has_conflicts,
        "detached": detached,
    }


def _parse_diff(diff_output: str, file_path: str) -> dict:
    """Parse unified diff output into hunks."""
    hunks: list[dict] = []
    is_binary = False
    additions = 0
    deletions = 0
    old_path = None

    if not diff_output.strip():
        return {"file_path": file_path, "old_path": old_path, "hunks": [], "is_binary": False, "additions": 0, "deletions": 0}

    if "Binary files" in diff_output and "differ" in diff_output:
        return {"file_path": file_path, "old_path": old_path, "hunks": [], "is_binary": True, "additions": 0, "deletions": 0}

    current_hunk = None
    old_no = 0
    new_no = 0

    for line in diff_output.splitlines():
        if line.startswith("--- a/"):
            old_path = line[6:]
        elif line.startswith("+++ b/"):
            pass  # new path, we already know it
        elif line.startswith("@@"):
            # Save previous hunk
            if current_hunk:
                hunks.append(current_hunk)
            # Parse hunk header: @@ -old_start,old_lines +new_start,new_lines @@
            import re
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)", line)
            if m:
                os_ = int(m.group(1))
                ol = int(m.group(2)) if m.group(2) else 1
                ns = int(m.group(3))
                nl = int(m.group(4)) if m.group(4) else 1
                current_hunk = {
                    "header": line,
                    "old_start": os_,
                    "old_lines": ol,
                    "new_start": ns,
                    "new_lines": nl,
                    "lines": [],
                }
                old_no = os_
                new_no = ns
        elif current_hunk is not None:
            if line.startswith("+"):
                current_hunk["lines"].append({"type": "+", "content": line[1:], "old_no": None, "new_no": new_no})
                new_no += 1
                additions += 1
            elif line.startswith("-"):
                current_hunk["lines"].append({"type": "-", "content": line[1:], "old_no": old_no, "new_no": None})
                old_no += 1
                deletions += 1
            elif line.startswith(" "):
                current_hunk["lines"].append({"type": " ", "content": line[1:], "old_no": old_no, "new_no": new_no})
                old_no += 1
                new_no += 1
            elif line.startswith("\\"):
                # "\ No newline at end of file"
                current_hunk["lines"].append({"type": " ", "content": line, "old_no": None, "new_no": None})

    if current_hunk:
        hunks.append(current_hunk)

    return {
        "file_path": file_path,
        "old_path": old_path if old_path != file_path else None,
        "hunks": hunks,
        "is_binary": is_binary,
        "additions": additions,
        "deletions": deletions,
    }


@app.get("/api/git/status", response_model=GitStatusResponse)
async def git_status(path: str = "", _user: str = Depends(get_current_user)):
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")
    if not await is_git_repo(path):
        return GitStatusResponse(is_git_repo=False)
    try:
        output = await run_git(path, ["status", "--porcelain=v2", "--branch"])
        parsed = _parse_status_porcelain_v2(output)
        return GitStatusResponse(is_git_repo=True, **parsed)
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/log", response_model=GitLogResponse)
async def git_log(
    path: str = "",
    skip: int = 0,
    count: int = 50,
    _user: str = Depends(get_current_user),
):
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        fmt = "COMMIT_START%n%H%n%h%n%an%n%ae%n%aI%n%s%n%P%n%D"
        output = await run_git(path, [
            "log", f"--format={fmt}", "--parents", "--decorate=short",
            f"--max-count={count + 1}", f"--skip={skip}",
        ])
    except GitError as e:
        if "does not have any commits" in str(e) or "bad default revision" in str(e):
            return GitLogResponse(commits=[], has_more=False)
        raise HTTPException(status_code=500, detail=str(e))

    commits: list[dict] = []
    blocks = output.split("COMMIT_START\n")
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        lines = block.split("\n")
        if len(lines) < 7:
            continue
        refs_raw = lines[7] if len(lines) > 7 else ""
        refs = [r.strip() for r in refs_raw.split(",") if r.strip()] if refs_raw else []
        parents_raw = lines[6].strip()
        parents = parents_raw.split() if parents_raw else []
        commits.append({
            "hash": lines[0],
            "short_hash": lines[1],
            "author_name": lines[2],
            "author_email": lines[3],
            "date": lines[4],
            "message": lines[5],
            "refs": refs,
            "parents": parents,
        })

    has_more = len(commits) > count
    if has_more:
        commits = commits[:count]

    return GitLogResponse(commits=commits, has_more=has_more)


@app.get("/api/git/branches", response_model=GitBranchesResponse)
async def git_branches(path: str = "", _user: str = Depends(get_current_user)):
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, [
            "branch", "-a", "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(upstream:track,nobracket)",
        ])
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))

    local: list[dict] = []
    remote: list[dict] = []
    current = None
    detached = False

    for line in output.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        name = parts[0].strip()
        is_current = parts[1].strip() == "*" if len(parts) > 1 else False
        tracking = parts[2].strip() if len(parts) > 2 and parts[2].strip() else None
        track_info = parts[3].strip() if len(parts) > 3 else ""

        ahead = 0
        behind = 0
        if track_info:
            import re
            m_ahead = re.search(r"ahead (\d+)", track_info)
            m_behind = re.search(r"behind (\d+)", track_info)
            if m_ahead:
                ahead = int(m_ahead.group(1))
            if m_behind:
                behind = int(m_behind.group(1))

        is_remote = name.startswith("origin/") or "/" in name
        info = {
            "name": name,
            "is_current": is_current,
            "is_remote": is_remote,
            "tracking": tracking,
            "ahead": ahead,
            "behind": behind,
        }
        if is_remote:
            remote.append(info)
        else:
            local.append(info)
        if is_current:
            current = name

    # Check for detached HEAD
    try:
        head_output = await run_git(path, ["symbolic-ref", "--short", "HEAD"])
        if not head_output.strip():
            detached = True
    except GitError:
        detached = True

    return GitBranchesResponse(local=local, remote=remote, current=current, detached=detached)


@app.get("/api/git/diff", response_model=GitDiffResponse)
async def git_diff(
    path: str = "",
    file: str = "",
    staged: bool = False,
    _user: str = Depends(get_current_user),
):
    if not path or not file:
        raise HTTPException(status_code=400, detail="path and file are required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        args = ["diff"]
        if staged:
            args.append("--cached")
        args += ["--", file]
        output = await run_git(path, args)
        # Check size limit (500KB)
        if len(output) > 500 * 1024:
            return GitDiffResponse(file_path=file, hunks=[], is_binary=False, additions=0, deletions=0)
        parsed = _parse_diff(output, file)
        return GitDiffResponse(**parsed)
    except GitError as e:
        # For untracked files, show full content as addition
        if not staged:
            try:
                full_path = os.path.join(path, file)
                if os.path.isfile(full_path):
                    size = os.path.getsize(full_path)
                    if size > 500 * 1024:
                        return GitDiffResponse(file_path=file, hunks=[], is_binary=False, additions=0, deletions=0)
                    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    lines = content.splitlines()
                    hunk_lines = [{"type": "+", "content": l, "old_no": None, "new_no": i + 1} for i, l in enumerate(lines)]
                    return GitDiffResponse(
                        file_path=file,
                        hunks=[{
                            "header": f"@@ -0,0 +1,{len(lines)} @@",
                            "old_start": 0, "old_lines": 0,
                            "new_start": 1, "new_lines": len(lines),
                            "lines": hunk_lines,
                        }] if hunk_lines else [],
                        additions=len(lines), deletions=0,
                    )
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/commit-detail")
async def git_commit_detail(
    path: str = "",
    hash: str = "",
    _user: str = Depends(get_current_user),
):
    if not path or not hash:
        raise HTTPException(status_code=400, detail="path and hash are required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        fmt = "%H%n%an%n%ae%n%aI%n%B%n---PARENTS---%n%P"
        output = await run_git(path, ["show", f"--format={fmt}", "--stat", hash])
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Split format output from stat output
    parts = output.split("---PARENTS---\n")
    header = parts[0].strip().split("\n")
    rest = parts[1] if len(parts) > 1 else ""

    commit_hash = header[0] if header else hash
    author_name = header[1] if len(header) > 1 else ""
    author_email = header[2] if len(header) > 2 else ""
    date = header[3] if len(header) > 3 else ""
    message_lines = header[4:] if len(header) > 4 else []
    message = "\n".join(message_lines).strip()

    rest_lines = rest.strip().split("\n")
    parents_line = rest_lines[0] if rest_lines else ""
    parents = parents_line.strip().split() if parents_line.strip() else []

    # Parse stat lines for file changes
    files: list[dict] = []
    total_additions = 0
    total_deletions = 0
    import re
    for line in rest_lines[1:]:
        line = line.strip()
        if not line or line.startswith("---PARENTS---"):
            continue
        # Stat line format: " file.txt | 5 ++---" or " 2 files changed, ..."
        m = re.match(r"^\s*(.+?)\s+\|\s+(\d+)\s*([+-]*)\s*$", line)
        if m:
            fname = m.group(1).strip()
            changes = m.group(3)
            adds = changes.count("+")
            dels = changes.count("-")
            total_additions += adds
            total_deletions += dels
            status = "M"
            if "(new)" in line:
                status = "A"
            elif " 0 " in line and dels > 0 and adds == 0:
                status = "D"
            files.append({"path": fname, "status": status, "staged": False, "old_path": None})

    # If stat parsing didn't get files, try --name-status
    if not files:
        try:
            ns_output = await run_git(path, ["diff-tree", "--no-commit-id", "-r", "--name-status", hash])
            for line in ns_output.strip().splitlines():
                parts_ns = line.split("\t")
                if len(parts_ns) >= 2:
                    status_char = parts_ns[0][0] if parts_ns[0] else "M"
                    fpath = parts_ns[1]
                    old_p = parts_ns[2] if len(parts_ns) > 2 else None
                    files.append({"path": fpath, "status": status_char, "staged": False, "old_path": old_p})
        except GitError:
            pass

    # Get accurate stats with --numstat
    try:
        numstat = await run_git(path, ["diff-tree", "--no-commit-id", "-r", "--numstat", hash])
        total_additions = 0
        total_deletions = 0
        for line in numstat.strip().splitlines():
            ns_parts = line.split("\t")
            if len(ns_parts) >= 2:
                try:
                    total_additions += int(ns_parts[0]) if ns_parts[0] != "-" else 0
                    total_deletions += int(ns_parts[1]) if ns_parts[1] != "-" else 0
                except ValueError:
                    pass
    except GitError:
        pass

    return {
        "hash": commit_hash,
        "author_name": author_name,
        "author_email": author_email,
        "date": date,
        "message": message,
        "parents": parents,
        "files": files,
        "additions": total_additions,
        "deletions": total_deletions,
    }


@app.get("/api/git/commit-diff", response_model=GitDiffResponse)
async def git_commit_diff(
    path: str = "",
    hash: str = "",
    file: str = "",
    _user: str = Depends(get_current_user),
):
    if not path or not hash or not file:
        raise HTTPException(status_code=400, detail="path, hash, and file are required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        # Get parent commit
        parents_output = await run_git(path, ["rev-parse", f"{hash}^"], timeout=5)
        parent = parents_output.strip()
        output = await run_git(path, ["diff", f"{parent}..{hash}", "--", file])
    except GitError:
        # If no parent (initial commit), diff against empty tree
        try:
            output = await run_git(path, ["diff", "4b825dc642cb6eb9a060e54bf899d15f3f338fb9", hash, "--", file])
        except GitError as e:
            raise HTTPException(status_code=500, detail=str(e))

    if len(output) > 500 * 1024:
        return GitDiffResponse(file_path=file, hunks=[], is_binary=False, additions=0, deletions=0)
    parsed = _parse_diff(output, file)
    return GitDiffResponse(**parsed)


@app.post("/api/git/stage")
async def git_stage(req: GitStageRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        await run_git(path, ["add", "--"] + req.files)
        return {"success": True}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/unstage")
async def git_unstage(req: GitStageRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        await run_git(path, ["restore", "--staged", "--"] + req.files)
        return {"success": True}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/discard")
async def git_discard(req: GitStageRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        await run_git(path, ["checkout", "--"] + req.files)
        return {"success": True}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/commit")
async def git_commit(req: GitCommitRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Commit message is required")
    try:
        output = await run_git(path, ["commit", "-m", req.message])
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/checkout")
async def git_checkout(req: GitCheckoutRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        await run_git(path, ["switch", req.branch])
        return {"success": True}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/create-branch")
async def git_create_branch(req: GitCreateBranchRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Branch name is required")
    try:
        if req.checkout:
            await run_git(path, ["switch", "-c", name])
        else:
            await run_git(path, ["branch", name])
        return {"success": True, "branch": name}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/pull")
async def git_pull(req: GitPullPushRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, ["pull"], timeout=60)
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/push")
async def git_push(req: GitPullPushRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        # Check if upstream is set
        try:
            await run_git(path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], timeout=5)
            has_upstream = True
        except GitError:
            has_upstream = False

        if has_upstream:
            output = await run_git(path, ["push"], timeout=60)
        else:
            # First push: set upstream to origin
            output = await run_git(path, ["push", "--set-upstream", "origin", "HEAD"], timeout=60)
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


class GitStashRequest(BaseModel):
    path: str
    message: str = ""


@app.get("/api/git/stash-list")
async def git_stash_list(path: str = "", _user: str = Depends(get_current_user)):
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    path = os.path.abspath(path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, ["stash", "list", "--format=%gd\t%gs"])
        stashes = []
        for line in output.strip().splitlines():
            if not line.strip():
                continue
            parts = line.split("\t", 1)
            # stash@{0} -> extract index
            ref = parts[0]
            msg = parts[1] if len(parts) > 1 else ref
            import re
            m = re.search(r"\{(\d+)\}", ref)
            idx = int(m.group(1)) if m else len(stashes)
            stashes.append({"index": idx, "message": msg})
        return {"stashes": stashes}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/stash")
async def git_stash_push(req: GitStashRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        args = ["stash", "push", "--include-untracked"]
        if req.message.strip():
            args += ["-m", req.message.strip()]
        output = await run_git(path, args)
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/stash-pop")
async def git_stash_pop(req: GitPullPushRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, ["stash", "pop"])
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/stash-drop")
async def git_stash_drop(req: GitPullPushRequest, _user: str = Depends(get_current_user)):
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, ["stash", "drop"])
        return {"success": True, "output": output.strip()}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Static Files & SPA Catch-All ---

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_catch_all(request: Request, full_path: str):
        """API/WS 이외의 모든 경로를 index.html로 라우팅 (SPA)."""
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        raise HTTPException(status_code=404, detail="Not found")
