from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from .language_registry import LanguageDescriptor, get_language_descriptor

logger = logging.getLogger(__name__)


def _encode_message(payload: dict) -> bytes:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    return header + body


async def _read_headers(stream: asyncio.StreamReader) -> Optional[dict[str, str]]:
    headers: dict[str, str] = {}
    while True:
        line = await stream.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            return headers
        decoded = line.decode("ascii", errors="replace").strip()
        if ":" not in decoded:
            continue
        name, value = decoded.split(":", 1)
        headers[name.strip().lower()] = value.strip()


async def _read_message(stream: asyncio.StreamReader) -> Optional[dict]:
    headers = await _read_headers(stream)
    if headers is None:
        return None
    length = int(headers.get("content-length", "0"))
    if length <= 0:
        return None
    body = await stream.readexactly(length)
    return json.loads(body.decode("utf-8"))


@dataclass
class LanguageServerProcess:
    session_id: str
    language_id: str
    root_path: str
    spec: LanguageDescriptor
    process: asyncio.subprocess.Process
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    lifecycle_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    active_ws: WebSocket | None = None
    stderr_task: asyncio.Task | None = None

    def is_running(self) -> bool:
        return self.process.returncode is None


class LanguageServerManager:
    def __init__(self) -> None:
        self._servers: dict[tuple[str, str], LanguageServerProcess] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    def _key(self, session_id: str, language_id: str) -> tuple[str, str]:
        return session_id, language_id

    def _get_lock(self, session_id: str, language_id: str) -> asyncio.Lock:
        key = self._key(session_id, language_id)
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    async def _close_existing_ws(self, server: LanguageServerProcess) -> None:
        if server.active_ws is None:
            return
        try:
            await server.active_ws.close(code=4409, reason="Language server connection taken over")
        except Exception:
            pass
        finally:
            server.active_ws = None

    async def _spawn_server(
        self,
        session_id: str,
        language_id: str,
        root_path: str,
        spec: LanguageDescriptor,
    ) -> LanguageServerProcess:
        if not spec.command:
            raise RuntimeError(f"Language {language_id} does not use an external language server.")

        process = await asyncio.create_subprocess_exec(
            spec.command[0],
            *spec.command[1:],
            cwd=root_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        server = LanguageServerProcess(
            session_id=session_id,
            language_id=language_id,
            root_path=root_path,
            spec=spec,
            process=process,
        )
        server.stderr_task = asyncio.create_task(self._log_stderr(server))
        self._servers[self._key(session_id, language_id)] = server
        logger.info("Started language server %s for session %s", language_id, session_id)
        return server

    async def ensure_server(
        self,
        session_id: str,
        language_id: str,
        root_path: str,
    ) -> LanguageServerProcess:
        spec = get_language_descriptor(language_id)
        if spec is None or spec.transport != "lsp":
            raise RuntimeError(f"Unsupported LSP language: {language_id}")

        available, _ = spec.availability()
        if not available:
            raise RuntimeError(f"{spec.command[0]} is not installed.")

        key = self._key(session_id, language_id)
        async with self._get_lock(session_id, language_id):
            existing = self._servers.get(key)
            if existing and existing.is_running():
                return existing
            if existing:
                await self._terminate_server(existing)
            return await self._spawn_server(session_id, language_id, root_path, spec)

    async def _log_stderr(self, server: LanguageServerProcess) -> None:
        if server.process.stderr is None:
            return
        try:
            while True:
                line = await server.process.stderr.readline()
                if not line:
                    break
                logger.warning(
                    "[LSP:%s:%s] %s",
                    server.session_id,
                    server.language_id,
                    line.decode("utf-8", errors="replace").rstrip(),
                )
        except asyncio.CancelledError:
            pass

    async def _terminate_server(self, server: LanguageServerProcess) -> None:
        async with server.lifecycle_lock:
            await self._close_existing_ws(server)
            if server.is_running():
                server.process.terminate()
                try:
                    await asyncio.wait_for(server.process.wait(), timeout=3)
                except asyncio.TimeoutError:
                    server.process.kill()
                    await server.process.wait()
            if server.stderr_task:
                server.stderr_task.cancel()
            self._servers.pop(self._key(server.session_id, server.language_id), None)
            logger.info("Stopped language server %s for session %s", server.language_id, server.session_id)

    async def close_session(self, session_id: str) -> None:
        servers = [
            server
            for key, server in list(self._servers.items())
            if key[0] == session_id
        ]
        for server in servers:
            await self._terminate_server(server)

    async def proxy_websocket(
        self,
        ws: WebSocket,
        session_id: str,
        language_id: str,
        root_path: str,
    ) -> None:
        server = await self.ensure_server(session_id, language_id, root_path)
        await ws.accept()
        await self._close_existing_ws(server)
        server.active_ws = ws

        reader = asyncio.create_task(self._stdio_to_ws(server, ws))
        writer = asyncio.create_task(self._ws_to_stdio(server, ws))

        try:
            done, pending = await asyncio.wait(
                [reader, writer],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                exc = task.exception()
                if exc and not isinstance(exc, WebSocketDisconnect):
                    raise exc
        except WebSocketDisconnect:
            pass
        finally:
            if server.active_ws is ws:
                server.active_ws = None
            try:
                await ws.close()
            except Exception:
                pass

    async def _ws_to_stdio(self, server: LanguageServerProcess, ws: WebSocket) -> None:
        if server.process.stdin is None:
            return
        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)
            async with server.write_lock:
                server.process.stdin.write(_encode_message(payload))
                await server.process.stdin.drain()

    async def _stdio_to_ws(self, server: LanguageServerProcess, ws: WebSocket) -> None:
        if server.process.stdout is None:
            return
        while True:
            message = await _read_message(server.process.stdout)
            if message is None:
                break
            await ws.send_text(json.dumps(message))


language_server_manager = LanguageServerManager()
