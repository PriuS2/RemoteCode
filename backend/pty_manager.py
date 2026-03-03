import asyncio
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=20)

# ---------------------------------------------------------------------------
# Platform-specific PTY adapters
# ---------------------------------------------------------------------------

if sys.platform == "win32":
    from winpty import PtyProcess as _WinPtyProcess

    class _PtyAdapter:
        """Adapter wrapping pywinpty.PtyProcess (Windows)."""

        def __init__(self, process: _WinPtyProcess) -> None:
            self._proc = process

        def read(self, length: int = 4096) -> str:
            return self._proc.read(length)

        def write(self, data: str) -> None:
            self._proc.write(data)

        def setwinsize(self, rows: int, cols: int) -> None:
            self._proc.setwinsize(rows, cols)

        def isalive(self) -> bool:
            return self._proc.isalive()

        def terminate(self) -> None:
            self._proc.terminate()

    def _create_pty(
        command: str,
        args: list[str],
        cwd: str,
        rows: int,
        cols: int,
    ) -> _PtyAdapter:
        full_args = [command] + args
        cmd_line = " ".join(full_args)
        proc = _WinPtyProcess.spawn(cmd_line, cwd=cwd, dimensions=(rows, cols))
        return _PtyAdapter(proc)

else:
    import pexpect  # type: ignore[import-untyped]

    class _PtyAdapter:  # type: ignore[no-redef]
        """Adapter wrapping pexpect.spawn (Linux / macOS)."""

        def __init__(self, process: pexpect.spawn) -> None:
            self._proc = process

        def read(self, length: int = 4096) -> str:
            try:
                data = self._proc.read_nonblocking(size=length, timeout=1)
                if isinstance(data, bytes):
                    return data.decode("utf-8", errors="replace")
                return data
            except pexpect.TIMEOUT:
                return ""
            except pexpect.EOF:
                raise EOFError("PTY process exited")

        def write(self, data: str) -> None:
            self._proc.send(data)

        def setwinsize(self, rows: int, cols: int) -> None:
            self._proc.setwinsize(rows, cols)

        def isalive(self) -> bool:
            return self._proc.isalive()

        def terminate(self) -> None:
            self._proc.terminate(force=True)

    def _create_pty(
        command: str,
        args: list[str],
        cwd: str,
        rows: int,
        cols: int,
    ) -> _PtyAdapter:
        proc = pexpect.spawn(
            command,
            args=args,
            cwd=cwd,
            dimensions=(rows, cols),
            encoding="utf-8",
        )
        return _PtyAdapter(proc)


# ---------------------------------------------------------------------------
# PTY instance & manager (platform-agnostic)
# ---------------------------------------------------------------------------

@dataclass
class PtyInstance:
    session_id: str
    process: object  # _PtyAdapter (Windows or Unix)
    work_path: str
    _closed: bool = field(default=False, init=False)
    _output_buffer: str = field(default="", init=False)

    def read(self, length: int = 4096) -> Optional[str]:
        """Blocking read. Returns data, empty string (transient), or None (dead)."""
        if self._closed:
            return None
        try:
            data = self.process.read(length)
            return data if data else ""
        except EOFError:
            logger.info(f"[READ] {self.session_id}: EOFError -> PTY dead")
            self._closed = True
            return None
        except Exception as e:
            logger.warning(f"[READ] {self.session_id}: {type(e).__name__}: {e}")
            self._closed = True
            return None

    def append_output(self, data: str) -> None:
        """최근 출력을 버퍼에 저장 (최대 8KB)."""
        self._output_buffer += data
        if len(self._output_buffer) > 8192:
            self._output_buffer = self._output_buffer[-8192:]

    def get_output_buffer(self) -> str:
        return self._output_buffer

    def write(self, data: str) -> None:
        if not self._closed:
            self.process.write(data)

    def resize(self, cols: int, rows: int) -> None:
        if not self._closed:
            try:
                self.process.setwinsize(rows, cols)
            except Exception as e:
                logger.warning(f"Resize failed for {self.session_id}: {e}")

    def encode_mouse_event(self, event_data: dict) -> Optional[str]:
        """마우스 이벤트를 SGR 마우스 시퀀스로 변환합니다."""
        event = event_data.get("event")
        button = event_data.get("button", 0)
        x = event_data.get("x", 1)
        y = event_data.get("y", 1)
        modifiers = event_data.get("modifiers", {})
        
        shift = modifiers.get("shift", False)
        ctrl = modifiers.get("ctrl", False)
        alt = modifiers.get("alt", False)
        
        modifier_flag = (shift << 2) | (ctrl << 1) | (alt << 0)
        
        if event == "scroll":
            if button == 64:
                return f"\x1b[<64;{x + 1};{y + 1}M"
            elif button == 65:
                return f"\x1b[<65;{x + 1};{y + 1}M"
            return None
        
        if event == "press":
            sgr_button = button | modifier_flag
            return f"\x1b[<{sgr_button};{x + 1};{y + 1}M"
        elif event == "release":
            sgr_button = button | modifier_flag
            return f"\x1b[<{sgr_button};{x + 1};{y + 1}m"
        elif event == "move":
            sgr_button = 3 | modifier_flag | 32
            return f"\x1b[<{sgr_button};{x + 1};{y + 1}M"
        elif event == "drag":
            sgr_button = button | modifier_flag | 32
            return f"\x1b[<{sgr_button};{x + 1};{y + 1}M"
        
        return None

    def is_alive(self) -> bool:
        if self._closed:
            return False
        return self.process.isalive()

    def terminate(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                if self.process.isalive():
                    self.process.terminate()
            except Exception as e:
                logger.warning(f"Terminate failed for {self.session_id}: {e}")


class PtyManager:
    def __init__(self) -> None:
        self._instances: dict[str, PtyInstance] = {}

    def spawn(
        self,
        session_id: str,
        work_path: str,
        command: Optional[str] = None,
        args: Optional[list[str]] = None,
        cols: int = 120,
        rows: int = 30,
    ) -> PtyInstance:
        cmd = command or settings.claude_command
        cmd_args = args or []

        full_args = [cmd] + cmd_args
        cmd_line = " ".join(full_args)

        logger.info(f"[SPAWN] {session_id}: {cmd_line} in {work_path}")

        adapter = _create_pty(
            command=cmd,
            args=cmd_args,
            cwd=work_path,
            rows=rows,
            cols=cols,
        )

        instance = PtyInstance(
            session_id=session_id,
            process=adapter,
            work_path=work_path,
        )
        self._instances[session_id] = instance
        logger.info(f"[SPAWN] {session_id}: OK, total instances: {len(self._instances)}")
        return instance

    def get(self, session_id: str) -> Optional[PtyInstance]:
        return self._instances.get(session_id)

    def remove(self, session_id: str) -> None:
        instance = self._instances.pop(session_id, None)
        if instance:
            logger.warning(f"[REMOVE] {session_id}: removing from manager, remaining: {len(self._instances)}")
            instance.terminate()
        else:
            logger.warning(f"[REMOVE] {session_id}: NOT FOUND in manager")

    def terminate_all(self) -> None:
        for session_id in list(self._instances.keys()):
            self.remove(session_id)
        logger.info("All PTY instances terminated")

    async def async_read(self, instance: PtyInstance) -> Optional[str]:
        """Returns data string or None if PTY is dead."""
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(_executor, instance.read)
        if data is None:
            return None
        if data == "":
            # Transient empty read - small delay then retry once
            await asyncio.sleep(0.05)
            data = await loop.run_in_executor(_executor, instance.read)
            return data
        return data

    async def async_spawn(
        self,
        session_id: str,
        work_path: str,
        command: Optional[str] = None,
        args: Optional[list[str]] = None,
        cols: int = 120,
        rows: int = 30,
    ) -> PtyInstance:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: self.spawn(session_id, work_path, command, args, cols, rows),
        )


pty_manager = PtyManager()
