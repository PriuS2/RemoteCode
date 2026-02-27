import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from .database import update_last_accessed, update_session
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)

# 세션당 활성 WebSocket 연결 추적: session_id -> (WebSocket, list[Task])
_active_connections: dict[str, tuple[WebSocket, list[asyncio.Task]]] = {}


async def pty_to_ws(ws: WebSocket, instance: PtyInstance) -> None:
    """PTY 출력을 WebSocket으로 전달."""
    try:
        while True:
            data = await pty_manager.async_read(instance)
            if data is None:
                logger.info(f"[PTY->WS] {instance.session_id}: PTY dead, cleaning up")
                pty_manager.remove(instance.session_id)
                try:
                    await update_session(instance.session_id, status="closed")
                except Exception:
                    pass
                break
            if data:
                instance.append_output(data)
                await ws.send_json({"type": "output", "data": data})
        await ws.send_json({"type": "status", "data": "closed"})
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"[PTY->WS] {instance.session_id}: {type(e).__name__}: {e}")


async def ws_to_pty(ws: WebSocket, instance: PtyInstance) -> None:
    """WebSocket 입력을 PTY로 전달."""
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"ws_to_pty: invalid JSON from {instance.session_id}")
                continue

            msg_type = msg.get("type")
            msg_data = msg.get("data")

            if msg_type == "input":
                if isinstance(msg_data, str):
                    instance.write(msg_data)
            elif msg_type == "resize":
                if isinstance(msg_data, dict):
                    cols = msg_data.get("cols")
                    rows = msg_data.get("rows")
                    if (
                        isinstance(cols, int) and isinstance(rows, int)
                        and 1 <= cols <= 500 and 1 <= rows <= 200
                    ):
                        instance.resize(cols, rows)
    except WebSocketDisconnect:
        # WS 끊겨도 PTY는 유지 (세션 전환 지원)
        logger.info(f"WebSocket disconnected (ws_to_pty) for session {instance.session_id}")
    except Exception as e:
        logger.error(f"ws_to_pty error for {instance.session_id}: {e}")


async def _close_existing_connection(session_id: str) -> None:
    """기존 연결이 있으면 종료시킨다 (마지막 요청자가 세션을 차지)."""
    prev = _active_connections.pop(session_id, None)
    if prev is None:
        return
    prev_ws, prev_tasks = prev
    for task in prev_tasks:
        task.cancel()
    try:
        await prev_ws.send_json({"type": "status", "data": "taken_over"})
        await prev_ws.close(code=4001, reason="Session taken over by another client")
    except Exception:
        pass
    logger.info(f"Evicted previous connection for session {session_id}")


async def handle_terminal_ws(ws: WebSocket, session_id: str) -> None:
    """WebSocket ↔ PTY 양방향 중계. WS 끊겨도 PTY는 유지."""
    await ws.accept()

    instance = pty_manager.get(session_id)
    if not instance:
        await ws.send_json({"type": "status", "data": "not_found"})
        await ws.close()
        return

    # 기존 연결이 있으면 끊고 새 연결이 차지
    await _close_existing_connection(session_id)

    logger.info(f"WebSocket connected for session {session_id}")

    # last_accessed 업데이트
    try:
        await update_last_accessed(session_id)
    except Exception:
        pass

    # 양방향 동시 중계
    tasks = [
        asyncio.create_task(pty_to_ws(ws, instance)),
        asyncio.create_task(ws_to_pty(ws, instance)),
    ]

    # 활성 연결 등록
    _active_connections[session_id] = (ws, tasks)

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    except Exception as e:
        logger.error(f"handle_terminal_ws error: {e}")
        for task in tasks:
            task.cancel()
    finally:
        # 자기 자신이 아직 활성 연결이면 정리
        if _active_connections.get(session_id, (None,))[0] is ws:
            _active_connections.pop(session_id, None)

    # PTY는 종료하지 않음 - WS 재연결 가능
    logger.info(f"WebSocket handler finished for session {session_id} (PTY kept alive)")
