import asyncio
import logging
import mimetypes
import os
import platform
import string
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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
    AUTH_COOKIE_NAME,
    create_access_token,
    get_current_user,
    verify_password,
    verify_ws_token,
)
from .config import _INSECURE_JWT_SECRET, settings
from .database import close_db, init_db, mark_all_active_as_suspended
from .language_registry import detect_language_id, list_language_statuses
from .language_server import language_server_manager
from .pty_manager import pty_manager
from .runtime_paths import get_config_open_path, get_static_dir
from .session_manager import SessionValidationError, session_manager
from .git_utils import GitError, run_git, is_git_repo
from .websocket import handle_terminal_ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Desktop survival check (auto-shutdown if desktop stops pinging)
DESKTOP_PING_TIMEOUT_SEC = 15.0
desktop_last_ping: float = 0.0
desktop_monitor_task: asyncio.Task | None = None

# Drive list cache (Windows only, TTL 30s)
_drive_cache: list[str] = []
_drive_cache_time: float = 0
_DRIVE_CACHE_TTL = 30.0
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogv", ".ogg", ".m4v", ".mov"}
_IDE_MAX_FILE_SIZE = 1024 * 1024


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
    global desktop_last_ping, desktop_monitor_task

    if settings.jwt_secret == _INSECURE_JWT_SECRET:
        raise RuntimeError(
            "JWT secret is still the default value. "
            "Set CCR_JWT_SECRET environment variable to a secure random string."
        )
    await init_db()
    await mark_all_active_as_suspended()

    # ServerHandle에서 server 인스턴스 저장 (graceful shutdown용)
    try:
        import remote_code_bootstrap

        handle = remote_code_bootstrap.get_server_handle()
        if handle:
            app.state.server = handle.server
    except Exception:
        pass

    # 데스크탑 모니터링 시작
    desktop_last_ping = time.monotonic()
    desktop_monitor_task = asyncio.create_task(_monitor_desktop())

    logger.info("Server started")
    yield

    # 모니터링 중지
    if desktop_monitor_task and not desktop_monitor_task.done():
        desktop_monitor_task.cancel()
        try:
            await desktop_monitor_task
        except asyncio.CancelledError:
            pass

    pty_manager.terminate_all()
    await close_db()
    logger.info("Server stopped")


async def _monitor_desktop() -> None:
    """데스크탑에서 15초 이상 ping이 없으면 자동 종료"""
    global desktop_last_ping
    while True:
        await asyncio.sleep(5)
        elapsed = time.monotonic() - desktop_last_ping
        if elapsed > DESKTOP_PING_TIMEOUT_SEC:
            logger.info(f"Desktop ping timeout ({elapsed:.1f}s) - initiating self-shutdown")
            await _graceful_shutdown()
            return


async def _graceful_shutdown() -> None:
    """Uvicorn 서버 graceful shutdown"""
    # app.state.server에 저장된 Uvicorn server 인스턴스로 graceful 종료
    try:
        if hasattr(app.state, "server") and app.state.server:
            app.state.server.should_exit = True
            logger.info("Graceful shutdown initiated via server.should_exit = True")
    except Exception as e:
        logger.error(f"Error during graceful shutdown: {e}")


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


def _is_secure_request(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def _set_auth_cookie(response: JSONResponse, request: Request, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.jwt_expire_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=_is_secure_request(request),
        path="/",
    )


def _clear_auth_cookie(response: JSONResponse, request: Request) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=_is_secure_request(request),
        path="/",
    )


def _compute_file_version(path: str) -> str:
    stat = os.stat(path)
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def _is_within_root(root_path: str, target_path: str) -> bool:
    root_real = os.path.realpath(os.path.abspath(root_path))
    target_real = os.path.realpath(os.path.abspath(target_path))
    try:
        return os.path.commonpath([root_real, target_real]) == root_real
    except ValueError:
        return False


def _resolve_ide_path(root_path: str, requested_path: str, *, allow_missing: bool) -> str:
    candidate = requested_path.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="path is required")

    if os.path.isabs(candidate):
        resolved = os.path.abspath(candidate)
    else:
        resolved = os.path.abspath(os.path.join(root_path, candidate))

    if not _is_within_root(root_path, resolved):
        raise HTTPException(status_code=403, detail="Path is outside the project root")

    if not allow_missing and not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail=f"File not found: {resolved}")

    return resolved


def _read_utf8_text(path: str) -> tuple[str, bool]:
    with open(path, "rb") as f:
        raw = f.read()
    if b"\x00" in raw:
        return "", False
    try:
        return raw.decode("utf-8"), True
    except UnicodeDecodeError:
        return "", False


async def _get_ide_session(session_id: str) -> dict:
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("cli_type") != "ide":
        raise HTTPException(status_code=400, detail="Session is not an IDE session")
    return session


# --- Request/Response Models ---

class LoginRequest(BaseModel):
    password: str


class AuthSessionResponse(BaseModel):
    authenticated: bool


class CreateProjectRequest(BaseModel):
    work_path: str
    name: str | None = None
    create_folder: bool = False


class SessionPreflightRequest(BaseModel):
    work_path: str
    create_folder: bool = False
    cli_type: str = "claude"
    cli_options: str | None = None
    custom_command: str | None = None
    

class CreateProjectSessionRequest(BaseModel):
    name: str | None = None
    cli_type: str = "claude"
    cli_options: str | None = None
    custom_command: str | None = None
    custom_exit_command: str | None = None


class RenameSessionRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


class ApiErrorDetail(BaseModel):
    code: str
    message: str


class SessionPreflightResponse(BaseModel):
    ok: bool
    code: str
    message: str
    resolved_command: str | None = None


class SessionResponse(BaseModel):
    id: str
    project_id: str
    claude_session_id: str | None = None
    cli_type: str
    name: str
    work_path: str
    created_at: str
    last_accessed_at: str
    status: str
    cli_options: str | None = None
    custom_command: str | None = None
    custom_exit_command: str | None = None
    order_index: int


class IdeFileResponse(BaseModel):
    path: str
    content: str
    version: str | None = None
    readonly: bool
    too_large: bool
    language_id: str
    size: int


class IdeSaveFileRequest(BaseModel):
    path: str
    content: str
    expected_version: str | None = None


class IdeSaveFileResponse(BaseModel):
    path: str
    version: str
    size: int
    language_id: str


class IdeLanguageStatusResponse(BaseModel):
    language_id: str
    label: str
    transport: str
    available: bool
    detail: str | None = None
    extensions: list[str]


class ProjectResponse(BaseModel):
    id: str
    name: str
    work_path: str
    created_at: str
    updated_at: str
    order_index: int
    sessions: list[SessionResponse]


class ProjectLayoutResponse(BaseModel):
    layout: dict[str, Any] | None = None


class UpdateProjectLayoutRequest(BaseModel):
    layout: dict[str, Any] | None = None


# --- Auth API (인증 불필요) ---

@app.post("/api/auth/login", response_model=AuthSessionResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest):
    if not verify_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    token = create_access_token()
    response = JSONResponse(content=AuthSessionResponse(authenticated=True).model_dump())
    _set_auth_cookie(response, request, token)
    return response


@app.post("/api/auth/logout", response_model=AuthSessionResponse)
async def logout(request: Request):
    response = JSONResponse(content=AuthSessionResponse(authenticated=False).model_dump())
    _clear_auth_cookie(response, request)
    return response


@app.get("/api/auth/session", response_model=AuthSessionResponse)
async def auth_session(_user: str = Depends(get_current_user)):
    return AuthSessionResponse(authenticated=True)


# --- Health Check (인증 불필요) ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# --- Desktop Desktop Survival Check (인증 불필요, localhost만) ---

@app.post("/api/desktop/ping")
async def desktop_ping(request: Request):
    """데스크탑에서 5초 간격으로 호출하여 생존 신호 전송"""
    global desktop_last_ping
    # 로컬 요청만 허용
    client_host = request.client.host if request.client else None
    if client_host not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(status_code=403, detail="Only localhost allowed")
    desktop_last_ping = time.monotonic()
    return {"ok": True}


@app.delete("/api/desktop/session")
async def desktop_shutdown(request: Request):
    """데스크탑 정상 종료 시 호출 - 즉시 종료"""
    # 로컬 요청만 허용
    client_host = request.client.host if request.client else None
    if client_host not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(status_code=403, detail="Only localhost allowed")
    logger.info("Desktop requested graceful shutdown")
    asyncio.create_task(_graceful_shutdown())
    return {"ok": True, "status": "shutting_down"}


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


def _open_directory_in_system(path: str) -> None:
    system = platform.system()
    if system == "Windows":
        os.startfile(path)
    elif system == "Darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


@app.post("/api/open-explorer")
async def open_in_explorer(
    req: OpenExplorerRequest, _user: str = Depends(get_current_user)
):
    path = os.path.abspath(req.path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    try:
        _open_directory_in_system(path)
        return {"success": True}
    except Exception as e:
        logger.error(f"open_in_explorer error: {e}")
        raise HTTPException(status_code=500, detail="Failed to open explorer")


@app.post("/api/open-config-path")
async def open_config_path(_user: str = Depends(get_current_user)):
    path = get_config_open_path().resolve()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    try:
        _open_directory_in_system(str(path))
        return {"success": True, "path": str(path)}
    except Exception as e:
        logger.error(f"open_config_path error: {e}")
        raise HTTPException(status_code=500, detail="Failed to open config path")


@app.get("/api/file-content")
async def read_file_content(
    path: str,
    start_line: int = Query(default=1, ge=1),
    line_count: int = Query(default=400, ge=1, le=2000),
    _user: str = Depends(get_current_user),
):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")

    MAX_SIZE = 512 * 1024  # 512KB
    try:
        size = os.path.getsize(path)
        if size <= MAX_SIZE:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            total_lines = len(content.split("\n"))
            return {
                "content": content,
                "size": size,
                "truncated": False,
                "start_line": 1,
                "end_line": total_lines,
                "total_lines": total_lines,
                "has_prev": False,
                "has_next": False,
            }

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            total_lines = sum(1 for _ in f)
        if total_lines == 0:
            total_lines = 1

        effective_start = min(start_line, total_lines)
        effective_end = min(total_lines, effective_start + line_count - 1)
        selected_lines: list[str] = []
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line_number, raw_line in enumerate(f, start=1):
                if line_number < effective_start:
                    continue
                if line_number > effective_end:
                    break
                selected_lines.append(raw_line.rstrip("\n"))

        content = "\n".join(selected_lines)
        return {
            "content": content,
            "size": size,
            "truncated": True,
            "start_line": effective_start,
            "end_line": effective_start + max(len(selected_lines) - 1, 0),
            "total_lines": total_lines,
            "has_prev": effective_start > 1,
            "has_next": effective_end < total_lines,
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


@app.get("/api/video-stream")
async def video_stream(
    path: str, _user: str = Depends(get_current_user)
):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")

    extension = os.path.splitext(path)[1].lower()
    if extension not in _VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video format")

    try:
        media_type, _ = mimetypes.guess_type(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {path}")

    return FileResponse(path, media_type=media_type or "application/octet-stream")


def _validate_name(name: str) -> None:
    """Validate a file/folder name. Raises HTTPException on invalid input."""
    if os.path.isabs(name) or os.path.splitdrive(name)[0]:
        raise HTTPException(status_code=400, detail="Invalid name")

    if sys.platform == "win32":
        _INVALID_CHARS = set('/<>:"\\|?*\0')
        _RESERVED_NAMES = {
            "CON", "PRN", "AUX", "NUL",
            *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10)),
        }
    else:
        _INVALID_CHARS = set('/\\\0')
        _RESERVED_NAMES: set[str] = set()
    if (
        not name
        or name in (".", "..")
        or any(c in _INVALID_CHARS for c in name)
        or (sys.platform == "win32" and name.upper().split(".")[0] in _RESERVED_NAMES)
        or (sys.platform == "win32" and name.endswith((" ", ".")))
    ):
        raise HTTPException(status_code=400, detail="Invalid name")


def _resolve_child_path(parent: str, name: str) -> tuple[str, str]:
    """Resolve a child entry and ensure it stays inside the parent directory."""
    normalized_name = name.strip()
    _validate_name(normalized_name)

    parent_real = os.path.realpath(os.path.abspath(parent))
    target_real = os.path.realpath(os.path.join(parent_real, normalized_name))

    try:
        is_within_parent = os.path.commonpath([parent_real, target_real]) == parent_real
    except ValueError:
        is_within_parent = False

    if not is_within_parent or os.path.dirname(target_real) != parent_real:
        raise HTTPException(status_code=400, detail="Invalid name")

    return normalized_name, target_real


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

    name, target = _resolve_child_path(parent, req.name)
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

    old_name, old_path = _resolve_child_path(parent, req.oldName)
    new_name, new_path = _resolve_child_path(parent, req.newName)
    if not os.path.exists(old_path):
        raise HTTPException(status_code=400, detail=f"Not found: {old_name}")

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

    name, target = _resolve_child_path(parent, req.name)
    if not os.path.exists(target):
        raise HTTPException(status_code=400, detail=f"Not found: {name}")

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

    return {"deleted": name}


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


@app.get("/api/ide/sessions/{session_id}/file", response_model=IdeFileResponse)
async def ide_get_file(
    session_id: str,
    path: str = Query(...),
    _user: str = Depends(get_current_user),
):
    session = await _get_ide_session(session_id)
    resolved = _resolve_ide_path(session["work_path"], path, allow_missing=False)

    if not os.path.isfile(resolved):
        raise HTTPException(status_code=400, detail=f"Not a file: {resolved}")

    try:
        size = os.path.getsize(resolved)
        readonly = not os.access(resolved, os.W_OK)
        language_id = detect_language_id(resolved)

        if size > _IDE_MAX_FILE_SIZE:
            return IdeFileResponse(
                path=resolved,
                content="",
                version=_compute_file_version(resolved),
                readonly=True,
                too_large=True,
                language_id=language_id,
                size=size,
            )

        content, is_text = _read_utf8_text(resolved)
        return IdeFileResponse(
            path=resolved,
            content=content if is_text else "",
            version=_compute_file_version(resolved),
            readonly=readonly or not is_text,
            too_large=False,
            language_id=language_id,
            size=size,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {resolved}")


@app.put("/api/ide/sessions/{session_id}/file", response_model=IdeSaveFileResponse)
async def ide_save_file(
    session_id: str,
    req: IdeSaveFileRequest,
    _user: str = Depends(get_current_user),
):
    session = await _get_ide_session(session_id)
    resolved = _resolve_ide_path(session["work_path"], req.path, allow_missing=True)
    parent = os.path.dirname(resolved) or session["work_path"]

    if not _is_within_root(session["work_path"], parent):
        raise HTTPException(status_code=403, detail="Path is outside the project root")
    if not os.path.isdir(parent):
        raise HTTPException(status_code=400, detail=f"Parent directory does not exist: {parent}")
    if os.path.exists(resolved) and not os.path.isfile(resolved):
        raise HTTPException(status_code=400, detail=f"Not a file: {resolved}")

    encoded = req.content.encode("utf-8")
    if len(encoded) > _IDE_MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File is too large to save through the IDE")

    current_version = _compute_file_version(resolved) if os.path.exists(resolved) else None
    if req.expected_version != current_version:
        raise HTTPException(
            status_code=409,
            detail=ApiErrorDetail(
                code="version_conflict",
                message="The file changed on disk. Reload before saving.",
            ).model_dump(),
        )

    try:
        with tempfile.NamedTemporaryFile("wb", delete=False, dir=parent) as temp_file:
            temp_file.write(encoded)
            temp_path = temp_file.name
        os.replace(temp_path, resolved)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {resolved}")
    finally:
        if "temp_path" in locals() and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

    return IdeSaveFileResponse(
        path=resolved,
        version=_compute_file_version(resolved),
        size=len(encoded),
        language_id=detect_language_id(resolved),
    )


@app.get("/api/ide/sessions/{session_id}/languages", response_model=list[IdeLanguageStatusResponse])
async def ide_list_languages(
    session_id: str,
    _user: str = Depends(get_current_user),
):
    await _get_ide_session(session_id)
    return [IdeLanguageStatusResponse(**item) for item in list_language_statuses()]


# --- Session API (인증 필요) ---

@app.post("/api/sessions/preflight", response_model=SessionPreflightResponse)
async def preflight_session(
    req: SessionPreflightRequest, _user: str = Depends(get_current_user)
):
    try:
        result = session_manager.preflight_session(
            work_path=req.work_path,
            create_folder=req.create_folder,
            cli_type=req.cli_type,
            cli_options=req.cli_options,
            custom_command=req.custom_command,
        )
        return SessionPreflightResponse(**result)
    except SessionValidationError as e:
        return SessionPreflightResponse(
            ok=False,
            code=e.code,
            message=e.message,
            resolved_command=None,
        )

@app.get("/api/projects", response_model=list[ProjectResponse])
async def list_projects(_user: str = Depends(get_current_user)):
    return await session_manager.list_projects()


@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(
    req: CreateProjectRequest, _user: str = Depends(get_current_user)
):
    try:
        project = await session_manager.create_project(
            work_path=req.work_path,
            name=req.name,
            create_folder=req.create_folder,
        )
        return project
    except SessionValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code=e.code, message=e.message).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )
    except Exception as e:
        logger.error(f"create_project unexpected error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=ApiErrorDetail(code="project_create_failed", message="Failed to create project").model_dump(),
        )


@app.patch("/api/projects/{project_id}", response_model=ProjectResponse)
async def rename_project(
    project_id: str, req: RenameProjectRequest, _user: str = Depends(get_current_user)
):
    try:
        name = req.name.strip()
        if not name:
            raise HTTPException(
                status_code=400,
                detail=ApiErrorDetail(code="invalid_request", message="Name cannot be empty").model_dump(),
            )
        return await session_manager.rename_project(project_id, name)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


@app.get("/api/projects/{project_id}/layout", response_model=ProjectLayoutResponse)
async def get_project_layout(
    project_id: str,
    _user: str = Depends(get_current_user),
):
    try:
        layout = await session_manager.get_project_layout(project_id)
        return ProjectLayoutResponse(layout=layout)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


@app.put("/api/projects/{project_id}/layout", response_model=ProjectLayoutResponse)
async def update_project_layout(
    project_id: str,
    req: UpdateProjectLayoutRequest,
    _user: str = Depends(get_current_user),
):
    try:
        layout = await session_manager.save_project_layout(project_id, req.layout)
        return ProjectLayoutResponse(layout=layout)
    except SessionValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code=e.code, message=e.message).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: str, _user: str = Depends(get_current_user)
):
    try:
        await session_manager.delete_project(project_id)
        return {"detail": "Project deleted"}
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


class UpdateProjectOrderRequest(BaseModel):
    ordered_ids: list[str]


@app.post("/api/projects/reorder")
async def reorder_projects(
    req: UpdateProjectOrderRequest, _user: str = Depends(get_current_user)
):
    try:
        await session_manager.update_project_order(req.ordered_ids)
        return {"detail": "Project order updated"}
    except Exception as e:
        logger.error(f"reorder_projects error: {e}")
        raise HTTPException(status_code=500, detail="Failed to update project order")


@app.post("/api/projects/{project_id}/sessions", response_model=SessionResponse)
async def create_project_session(
    project_id: str,
    req: CreateProjectSessionRequest,
    _user: str = Depends(get_current_user),
):
    try:
        return await session_manager.create_session(
            project_id=project_id,
            name=req.name,
            cli_type=req.cli_type,
            cli_options=req.cli_options,
            custom_command=req.custom_command,
            custom_exit_command=req.custom_exit_command,
        )
    except SessionValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code=e.code, message=e.message).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )
    except Exception as e:
        logger.error(f"create_project_session unexpected error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=ApiErrorDetail(code="spawn_failed", message="Failed to create session").model_dump(),
        )


class UpdateProjectSessionOrderRequest(BaseModel):
    ordered_ids: list[str]


@app.post("/api/projects/{project_id}/sessions/reorder")
async def reorder_project_sessions(
    project_id: str,
    req: UpdateProjectSessionOrderRequest,
    _user: str = Depends(get_current_user),
):
    try:
        await session_manager.update_project_session_order(project_id, req.ordered_ids)
        return {"detail": "Project session order updated"}
    except Exception as e:
        logger.error(f"reorder_project_sessions error: {e}")
        raise HTTPException(status_code=500, detail="Failed to update project session order")


@app.get("/api/sessions", response_model=list[SessionResponse])
async def list_sessions(_user: str = Depends(get_current_user)):
    sessions = await session_manager.list_sessions()
    return sessions


@app.post("/api/sessions/{session_id}/suspend", response_model=SessionResponse)
async def suspend_session(
    session_id: str, _user: str = Depends(get_current_user)
):
    try:
        session = await session_manager.suspend_session(session_id)
        return session
    except SessionValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code=e.code, message=e.message).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


@app.post("/api/sessions/{session_id}/resume", response_model=SessionResponse)
async def resume_session(
    session_id: str, _user: str = Depends(get_current_user)
):
    try:
        session = await session_manager.resume_session(session_id)
        return session
    except SessionValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code=e.code, message=e.message).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ApiErrorDetail(code="invalid_request", message=str(e)).model_dump(),
        )


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
    if not verify_ws_token(ws, token):
        await ws.accept()
        await ws.close(code=4401, reason="Unauthorized")
        return
    await handle_terminal_ws(ws, session_id)


@app.websocket("/ws/ide/{session_id}/lsp/{language_id}")
async def websocket_ide_lsp(
    ws: WebSocket,
    session_id: str,
    language_id: str,
    token: str = Query(default=""),
):
    if not verify_ws_token(ws, token):
        await ws.accept()
        await ws.close(code=4401, reason="Unauthorized")
        return

    session = await session_manager.get_session(session_id)
    if not session or session.get("cli_type") != "ide":
        await ws.accept()
        await ws.close(code=4404, reason="IDE session not found")
        return

    try:
        await language_server_manager.proxy_websocket(
            ws,
            session_id=session_id,
            language_id=language_id,
            root_path=session["work_path"],
        )
    except RuntimeError as e:
        await ws.accept()
        await ws.close(code=4404, reason=str(e))


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


@app.post("/api/git/patch")
async def git_patch(req: GitPullPushRequest, _user: str = Depends(get_current_user)):
    """Generate a patch (git diff) for the working directory or a specific target."""
    path = os.path.abspath(req.path)
    if not await is_git_repo(path):
        raise HTTPException(status_code=400, detail="Not a git repository")
    try:
        output = await run_git(path, ["diff", "HEAD"])
        return {"success": True, "patch": output}
    except GitError as e:
        raise HTTPException(status_code=500, detail=str(e))



# --- Static Files & SPA Catch-All ---

STATIC_DIR = get_static_dir()

if STATIC_DIR.is_dir():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def spa_catch_all(request: Request, full_path: str):
        """API/WS 이외의 모든 경로를 index.html로 라우팅 (SPA)."""
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        raise HTTPException(status_code=404, detail="Not found")
else:
    logger.warning("Static files not found at %s", STATIC_DIR)
