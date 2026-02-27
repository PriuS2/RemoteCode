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


app = FastAPI(title="Claude Code Remote", lifespan=lifespan)
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
        raise HTTPException(status_code=400, detail="Invalid folder name")

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
