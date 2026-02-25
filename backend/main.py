import asyncio
import logging
import os
from pathlib import Path

from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import (
    create_access_token,
    get_current_user,
    verify_password,
    verify_ws_token,
)
from .database import close_db, init_db, mark_all_active_as_suspended
from .pty_manager import pty_manager
from .session_manager import session_manager
from .websocket import handle_terminal_ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await mark_all_active_as_suspended()
    logger.info("Server started")
    yield
    pty_manager.terminate_all()
    await close_db()
    logger.info("Server stopped")


app = FastAPI(title="Claude Code Remote", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
async def login(req: LoginRequest):
    if not verify_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    token = create_access_token()
    return TokenResponse(access_token=token)


# --- Health Check (인증 불필요) ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# --- Browse API (인증 필요) ---

class BrowseResponse(BaseModel):
    current: str
    parent: str | None = None
    folders: list[str]
    drives: list[str] | None = None


@app.get("/api/browse", response_model=BrowseResponse)
async def browse_directory(
    path: str = "", _user: str = Depends(get_current_user)
):
    if not path:
        path = os.path.expanduser("~")

    path = os.path.abspath(path)

    # Windows 드라이브 목록
    drives = []
    if os.name == "nt":
        import string
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                drives.append(drive)

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

    return BrowseResponse(current=path, parent=parent, folders=folders, drives=drives)


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
    if not name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    target = os.path.join(parent, name)
    if os.path.exists(target):
        raise HTTPException(status_code=400, detail=f"Already exists: {name}")

    try:
        os.makedirs(target)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Access denied: {parent}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"path": target}


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
        raise HTTPException(status_code=500, detail=str(e))


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
