import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from .database import update_last_accessed, update_session
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)


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
            msg = json.loads(raw)

            if msg["type"] == "input":
                instance.write(msg["data"])
            elif msg["type"] == "resize":
                cols = msg["data"]["cols"]
                rows = msg["data"]["rows"]
                instance.resize(cols, rows)
    except WebSocketDisconnect:
        # WS 끊겨도 PTY는 유지 (세션 전환 지원)
        logger.info(f"WebSocket disconnected (ws_to_pty) for session {instance.session_id}")
    except Exception as e:
        logger.error(f"ws_to_pty error for {instance.session_id}: {e}")


async def handle_terminal_ws(ws: WebSocket, session_id: str) -> None:
    """WebSocket ↔ PTY 양방향 중계. WS 끊겨도 PTY는 유지."""
    await ws.accept()

    instance = pty_manager.get(session_id)
    if not instance:
        await ws.send_json({"type": "status", "data": "not_found"})
        await ws.close()
        return

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

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    except Exception as e:
        logger.error(f"handle_terminal_ws error: {e}")
        for task in tasks:
            task.cancel()

    # PTY는 종료하지 않음 - WS 재연결 가능
    logger.info(f"WebSocket handler finished for session {session_id} (PTY kept alive)")
