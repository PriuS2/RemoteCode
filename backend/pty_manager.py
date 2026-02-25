import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

from winpty import PtyProcess

from .config import settings

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=20)


@dataclass
class PtyInstance:
    session_id: str
    process: PtyProcess
    work_path: str
    _closed: bool = field(default=False, init=False)

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

    def write(self, data: str) -> None:
        if not self._closed:
            self.process.write(data)

    def resize(self, cols: int, rows: int) -> None:
        if not self._closed:
            try:
                self.process.setwinsize(rows, cols)
            except Exception as e:
                logger.warning(f"Resize failed for {self.session_id}: {e}")

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

        process = PtyProcess.spawn(
            cmd_line,
            cwd=work_path,
            dimensions=(rows, cols),
        )

        instance = PtyInstance(
            session_id=session_id,
            process=process,
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
        loop = asyncio.get_event_loop()
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
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: self.spawn(session_id, work_path, command, args, cols, rows),
        )


pty_manager = PtyManager()
