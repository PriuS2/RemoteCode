from __future__ import annotations

import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import uvicorn


APP_NAME = "Remote Code"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080
INSECURE_JWT_SECRET = "change-this-secret-key"
ENV_FILENAME = ".env"
HEALTH_TIMEOUT_SECONDS = 30


class LauncherError(RuntimeError):
    pass


CLAUDE_PROVIDER_ENV_LINES = [
    "# ============================================================",
    "# Claude Code Provider",
    "# ============================================================",
    "",
    "# --- Option 1: AWS Bedrock ---",
    "# CLAUDE_CODE_USE_BEDROCK=1",
    "# AWS_REGION=us-west-2",
    "# AWS_ACCESS_KEY_ID=your-access-key",
    "# AWS_SECRET_ACCESS_KEY=your-secret-key",
    "# ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0",
    "",
    "# --- Option 2: Anthropic API (Direct) ---",
    "# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
    "# ANTHROPIC_MODEL=claude-sonnet-4-20250514",
    "",
    "# --- Option 3: LM Studio / OpenAI-compatible API ---",
    "# ANTHROPIC_BASE_URL=http://localhost:1234/v1",
    "# ANTHROPIC_API_KEY=lm-studio",
    "# ANTHROPIC_MODEL=your-model-name",
    "",
    "# --- Option 4: OpenRouter ---",
    '# ANTHROPIC_API_KEY=""',
    "# ANTHROPIC_BASE_URL=https://openrouter.ai/api",
    "# OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx",
    "# ANTHROPIC_AUTH_TOKEN=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx",
    "# ANTHROPIC_MODEL=moonshotai/kimi-k2.5",
]


@dataclass
class ServerHandle:
    server: uvicorn.Server
    thread: threading.Thread
    errors: list[BaseException]


# 전역 ServerHandle 저장 (백엔드 모듈에서 접근용)
_server_handle: ServerHandle | None = None


def get_server_handle() -> ServerHandle | None:
    """현재 실행 중인 서버 핸들러 반환"""
    return _server_handle


def default_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


def resolve_data_dir(raw_value: str | None) -> Path:
    base = Path(raw_value).expanduser() if raw_value else default_data_dir()
    return base.resolve()


def read_env_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def env_key_for_line(line: str) -> str | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    return stripped.split("=", 1)[0].strip()


def env_value_for_line(line: str) -> str | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    value = stripped.split("=", 1)[1].strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
    return value


def get_env_value(lines: list[str], key: str) -> str | None:
    for line in lines:
        if env_key_for_line(line) == key:
            return env_value_for_line(line)
    return None


def format_env_value(value: str) -> str:
    if not value:
        return '""'
    if any(char.isspace() for char in value) or any(char in value for char in '#"'):
        return json.dumps(value)
    return value


def upsert_env_value(lines: list[str], key: str, value: str) -> bool:
    entry = f"{key}={format_env_value(value)}"
    for index, line in enumerate(lines):
        if env_key_for_line(line) == key:
            if line == entry:
                return False
            lines[index] = entry
            return True
    lines.append(entry)
    return True


def default_env_lines(data_dir: Path) -> list[str]:
    return [
        "CCR_HOST=127.0.0.1",
        f"CCR_PORT={DEFAULT_PORT}",
        "CCR_CLAUDE_COMMAND=claude",
        "CCR_KILO_COMMAND=kilo",
        "CCR_OPENCODE_COMMAND=opencode",
        "CCR_PASSWORD=changeme",
        f"CCR_JWT_SECRET={secrets.token_hex(32)}",
        "CCR_JWT_EXPIRE_HOURS=72",
        f"CCR_DB_PATH={format_env_value(str(data_dir / 'sessions.db'))}",
        "",
        "# Optional",
        "# CCR_ALLOWED_ORIGINS=http://127.0.0.1:8080",
        "",
        *CLAUDE_PROVIDER_ENV_LINES,
    ]


def ensure_env_file(path: Path, data_dir: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("\n".join(default_env_lines(data_dir)) + "\n", encoding="utf-8")
        return path

    lines = read_env_lines(path)
    changed = False
    defaults = {
        "CCR_HOST": DEFAULT_HOST,
        "CCR_PORT": str(DEFAULT_PORT),
        "CCR_CLAUDE_COMMAND": "claude",
        "CCR_KILO_COMMAND": "kilo",
        "CCR_OPENCODE_COMMAND": "opencode",
        "CCR_PASSWORD": "changeme",
        "CCR_JWT_EXPIRE_HOURS": "72",
    }
    for key, value in defaults.items():
        if get_env_value(lines, key) is None:
            changed = upsert_env_value(lines, key, value) or changed

    changed = upsert_env_value(lines, "CCR_DB_PATH", str(data_dir / "sessions.db")) or changed

    jwt_secret = get_env_value(lines, "CCR_JWT_SECRET")
    if not jwt_secret or jwt_secret == INSECURE_JWT_SECRET:
        changed = upsert_env_value(lines, "CCR_JWT_SECRET", secrets.token_hex(32)) or changed

    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def load_env_defaults(path: Path) -> None:
    for line in read_env_lines(path):
        key = env_key_for_line(line)
        if not key or key in os.environ:
            continue
        value = env_value_for_line(line)
        if value is not None:
            os.environ[key] = value


def configure_environment(host_override: str | None, port_override: int | None, env_path: Path, data_dir: Path) -> tuple[str, int]:
    os.environ["CCR_ENV_FILE"] = str(env_path)
    load_env_defaults(env_path)
    os.environ["CCR_DB_PATH"] = str(data_dir / "sessions.db")

    host = host_override or os.environ.get("CCR_HOST") or DEFAULT_HOST
    port = port_override or int(os.environ.get("CCR_PORT", str(DEFAULT_PORT)))
    if not 1 <= port <= 65535:
        raise LauncherError(f"Invalid port value: {port}")

    os.environ["CCR_HOST"] = host
    os.environ["CCR_PORT"] = str(port)
    return host, port


def ensure_static_build() -> Path:
    from backend.runtime_paths import get_static_dir

    static_dir = get_static_dir()
    index_path = static_dir / "index.html"
    if not index_path.exists():
        raise LauncherError(
            "Static frontend build was not found.\n"
            "Build the frontend before launching the packaged runtime.\n"
            f"Checked path: {index_path}"
        )
    return static_dir


def ensure_port_available(host: str, port: int) -> None:
    try:
        with socket.create_server((host, port), reuse_port=False):
            return
    except OSError as exc:
        raise LauncherError(
            f"Port {port} is already in use.\n"
            "Use a different port with --port or stop the process that is already bound."
        ) from exc


def healthcheck_ok(port: int) -> bool:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/health")
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def start_server_thread(host: str, port: int) -> ServerHandle:
    global _server_handle
    from backend.main import app

    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None
    errors: list[BaseException] = []

    def server_target() -> None:
        try:
            server.run()
        except BaseException as exc:  # pragma: no cover
            errors.append(exc)

    thread = threading.Thread(target=server_target, name="remote-code-server")
    thread.start()
    _server_handle = ServerHandle(server=server, thread=thread, errors=errors)
    return _server_handle


def wait_for_health(port: int, handle: ServerHandle) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if healthcheck_ok(port):
            return
        if handle.errors:
            raise LauncherError(str(handle.errors[0])) from handle.errors[0]
        if not handle.thread.is_alive():
            raise LauncherError(
                "The server stopped before it became healthy.\n"
                "Check your .env values and confirm the frontend static build exists."
            )
        time.sleep(0.5)
    raise LauncherError(
        "The server did not become healthy in time.\n"
        "Check for port conflicts or configuration errors."
    )


def shutdown_server(handle: ServerHandle) -> None:
    handle.server.should_exit = True
    handle.thread.join(timeout=5)


def show_error(message: str) -> None:
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror(APP_NAME, message)
        root.destroy()
    except Exception:
        print(message, file=sys.stderr)
