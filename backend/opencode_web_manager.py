import logging
import os
import socket
import subprocess
import threading
import time
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)


class OpenCodeWebManager:
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._port: Optional[int] = None
        self._lock = threading.Lock()

    def _is_port_open(self, port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            return False

    def _clear_dead_process(self) -> None:
        if self._process and self._process.poll() is not None:
            logger.info(
                "OpenCode Web process exited with code %s",
                self._process.returncode,
            )
            self._process = None
            self._port = None

    def start(self, port: Optional[int] = None, hostname: Optional[str] = None) -> int:
        port = port or settings.opencode_web_port
        hostname = hostname or settings.opencode_web_hostname

        with self._lock:
            self._clear_dead_process()
            if self._process and self._process.poll() is None:
                return self._port or port

            cmd = [settings.opencode_command, "web", "--port", str(port), "--hostname", hostname]
            env = os.environ.copy()

            popen_kwargs = {
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
                "env": env,
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = (
                    getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                    | getattr(subprocess, "CREATE_NO_WINDOW", 0)
                )
            else:
                env.pop("DISPLAY", None)

            try:
                self._process = subprocess.Popen(cmd, **popen_kwargs)
            except FileNotFoundError as exc:
                raise RuntimeError(
                    f"OpenCode command not found: {settings.opencode_command}"
                ) from exc
            except Exception as exc:
                raise RuntimeError(f"Failed to start OpenCode Web: {exc}") from exc

            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if self._process.poll() is not None:
                    code = self._process.returncode
                    self._process = None
                    self._port = None
                    raise RuntimeError(
                        f"OpenCode Web exited before becoming ready (exit code {code})"
                    )
                if self._is_port_open(port):
                    self._port = port
                    logger.info("OpenCode Web server started on port %s", port)
                    return port
                time.sleep(0.25)

            self.stop()
            raise RuntimeError(f"OpenCode Web did not start listening on port {port}")

    def stop(self) -> None:
        with self._lock:
            process = self._process
            port = self._port
            self._process = None
            self._port = None

            if not process:
                return

            try:
                process.terminate()
                process.wait(timeout=5)
            except Exception as exc:
                logger.warning("Error stopping OpenCode Web server: %s", exc)
                try:
                    process.kill()
                    process.wait(timeout=2)
                except Exception:
                    pass

            if port is not None:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if not self._is_port_open(port):
                        break
                    time.sleep(0.2)

            logger.info("OpenCode Web server stopped")

    def get_status(self) -> dict:
        with self._lock:
            self._clear_dead_process()
            running = bool(self._port and self._is_port_open(self._port))
            if not running and self._process is None:
                self._port = None
            return {
                "running": running,
                "port": self._port if running else None,
            }

    def is_running(self) -> bool:
        status = self.get_status()
        return bool(status["running"])


opencode_web_manager = OpenCodeWebManager()
