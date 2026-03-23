from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"Launch {APP_NAME}.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    parser.add_argument("--host", help="Bind host override.")
    parser.add_argument("--port", type=int, help="Bind port override.")
    parser.add_argument("--data-dir", help="App data directory override.")
    return parser.parse_args()


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


def configure_environment(args: argparse.Namespace, env_path: Path, data_dir: Path) -> tuple[str, int]:
    os.environ["CCR_ENV_FILE"] = str(env_path)
    load_env_defaults(env_path)
    os.environ["CCR_DB_PATH"] = str(data_dir / "sessions.db")

    host = args.host or os.environ.get("CCR_HOST") or DEFAULT_HOST
    port = args.port or int(os.environ.get("CCR_PORT", str(DEFAULT_PORT)))
    if not 1 <= port <= 65535:
        raise LauncherError(f"포트 값이 올바르지 않습니다: {port}")

    os.environ["CCR_HOST"] = host
    os.environ["CCR_PORT"] = str(port)
    return host, port


def ensure_static_build() -> Path:
    from backend.runtime_paths import get_static_dir

    static_dir = get_static_dir()
    index_path = static_dir / "index.html"
    if not index_path.exists():
        raise LauncherError(
            "정적 파일을 찾을 수 없습니다. `frontend`를 빌드한 뒤 패키징했는지 확인하세요.\n"
            f"확인 경로: {index_path}"
        )
    return static_dir


def ensure_port_available(host: str, port: int) -> None:
    try:
        with socket.create_server((host, port), reuse_port=False):
            return
    except OSError as exc:
        raise LauncherError(
            f"포트 {port}를 사용할 수 없습니다. 다른 프로세스가 이미 사용 중일 수 있습니다.\n"
            "다른 포트로 실행하려면 `--port` 옵션을 사용하세요."
        ) from exc


def healthcheck_ok(port: int) -> bool:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/health")
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def wait_for_health(port: int, thread: threading.Thread, errors: list[BaseException]) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if healthcheck_ok(port):
            return
        if errors:
            raise LauncherError(str(errors[0])) from errors[0]
        if not thread.is_alive():
            raise LauncherError(
                "서버가 시작 중 종료되었습니다. 앱 데이터 폴더의 `.env` 설정과 정적 파일 빌드를 확인하세요."
            )
        time.sleep(0.5)
    raise LauncherError(
        "서버가 시간 내에 시작되지 않았습니다. 포트 충돌 또는 설정 오류가 없는지 확인하세요."
    )


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


def run() -> int:
    args = parse_args()
    data_dir = resolve_data_dir(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    env_path = ensure_env_file(data_dir / ENV_FILENAME, data_dir)
    host, port = configure_environment(args, env_path, data_dir)
    ensure_static_build()
    ensure_port_available(host, port)

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

    try:
        wait_for_health(port, thread, errors)
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{port}", new=2)
        while thread.is_alive():
            thread.join(timeout=0.5)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(timeout=5)
    return 0


def main() -> int:
    try:
        return run()
    except LauncherError as exc:
        show_error(str(exc))
        return 1
    except Exception as exc:  # pragma: no cover
        show_error(f"예상하지 못한 오류가 발생했습니다.\n{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
