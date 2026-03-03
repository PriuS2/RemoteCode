import logging
import os
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

    def start(self, port: Optional[int] = None, hostname: Optional[str] = None) -> int:
        port = port or settings.opencode_web_port
        hostname = hostname or settings.opencode_web_hostname

        with self._lock:
            if self._process and self._process.poll() is None:
                return self._port or port

            cmd = ["opencode", "web", "--port", str(port), "--hostname", hostname]

            env = os.environ.copy()

            if os.name == "nt":
                # Windows: PowerShell Start-Process로 브라우저 자동 열기 방지
                ps_cmd = [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    f"Start-Process -FilePath 'opencode' -ArgumentList 'web','--port','{port}','--hostname','{hostname}' -WindowStyle Hidden"
                ]
                self._process = subprocess.Popen(
                    ps_cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            else:
                env.pop("DISPLAY", None)
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=env,
                )

            # 서버가 시작할 때까지 잠시 대기
            time.sleep(2)

            # 포트에서Listening 확인
            import socket
            for _ in range(10):
                try:
                    with socket.create_connection(("localhost", port), timeout=1):
                        break
                except (socket.timeout, ConnectionRefusedError):
                    time.sleep(0.5)

            self._port = port
            logger.info(f"OpenCode Web server started on port {port}")
            return self._port

    def stop(self) -> None:
        with self._lock:
            if self._process:
                try:
                    self._process.terminate()
                    self._process.wait(timeout=5)
                except Exception as e:
                    logger.warning(f"Error stopping OpenCode Web server: {e}")
                    try:
                        self._process.kill()
                    except Exception:
                        pass
                self._process = None
                self._port = None
                logger.info("OpenCode Web server stopped")

    def get_status(self) -> dict:
        import socket
        with self._lock:
            # 실제로 포트에 연결 가능한지 확인
            running = False
            if self._port:
                try:
                    with socket.create_connection(("localhost", self._port), timeout=1):
                        running = True
                except (socket.timeout, ConnectionRefusedError, OSError):
                    running = False
            
            return {
                "running": running,
                "port": self._port,
            }

    def is_running(self) -> bool:
        import socket
        with self._lock:
            if not self._port:
                return False
            try:
                with socket.create_connection(("localhost", self._port), timeout=1):
                    return True
            except (socket.timeout, ConnectionRefusedError, OSError):
                return False


opencode_web_manager = OpenCodeWebManager()
