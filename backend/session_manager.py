import asyncio
import logging
import os
import re
import uuid
from typing import Optional

from .config import settings
from .database import (
    create_session as db_create_session,
    delete_session as db_delete_session,
    get_session as db_get_session,
    list_sessions as db_list_sessions,
    update_last_accessed,
    update_session as db_update_session,
)
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)


class SessionManager:
    async def create_session(
        self,
        work_path: str,
        name: Optional[str] = None,
        create_folder: bool = False,
    ) -> dict:
        work_path = os.path.abspath(work_path)

        if create_folder and not os.path.exists(work_path):
            os.makedirs(work_path, exist_ok=True)

        if not os.path.isdir(work_path):
            raise ValueError(f"Directory does not exist: {work_path}")

        session_id = str(uuid.uuid4())
        display_name = name or os.path.basename(work_path)

        # DB에 세션 생성
        session = await db_create_session(session_id, display_name, work_path)

        # PTY 생성 (10초 타임아웃)
        try:
            await asyncio.wait_for(
                pty_manager.async_spawn(
                    session_id=session_id,
                    work_path=work_path,
                    command=settings.claude_command,
                ),
                timeout=10,
            )
        except Exception as e:
            logger.error(f"PTY spawn failed for {session_id}: {e}")
            await db_delete_session(session_id)
            raise ValueError(f"Failed to start terminal: {e}")

        logger.info(f"Session created: {session_id} ({display_name}) at {work_path}")
        return session

    async def list_sessions(self) -> list[dict]:
        return await db_list_sessions()

    async def get_session(self, session_id: str) -> Optional[dict]:
        return await db_get_session(session_id)

    async def suspend_session(self, session_id: str) -> dict:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")
        if session["status"] != "active":
            raise ValueError(f"Session is not active: {session_id}")

        instance = pty_manager.get(session_id)
        if instance and instance.is_alive():
            # /exit 명령을 한 글자씩 보내고, Enter를 딜레이 후 전송
            for ch in "/exit":
                instance.write(ch)
                await asyncio.sleep(0.02)
            await asyncio.sleep(0.3)
            instance.write("\r")
            await asyncio.sleep(0.5)
            instance.write("\r")

            # 종료 대기 (최대 10초) - pty_to_ws가 출력을 버퍼에 저장함
            for _ in range(100):
                if not instance.is_alive():
                    break
                await asyncio.sleep(0.1)

            # 버퍼에서 --resume UUID 추출
            await asyncio.sleep(0.5)  # WebSocket reader가 마지막 출력을 버퍼에 쓸 시간
            output = instance.get_output_buffer()
            resume_pattern = re.compile(r"--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
            match = resume_pattern.search(output)
            if match:
                claude_sid = match.group(1)
                await db_update_session(session_id, claude_session_id=claude_sid)
                logger.info(f"Captured claude_session_id from output: {claude_sid}")
            else:
                logger.warning(f"Could not find --resume UUID in output buffer ({len(output)} chars)")

            # PTY 정리
            pty_manager.remove(session_id)

        await db_update_session(session_id, status="suspended")
        return await db_get_session(session_id)

    async def resume_session(self, session_id: str) -> dict:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")
        if session["status"] not in ("suspended", "closed"):
            raise ValueError(f"Session is not suspended or closed: {session_id}")

        # 기존 PTY 정리
        existing = pty_manager.get(session_id)
        if existing:
            pty_manager.remove(session_id)

        # suspended + claude_session_id가 있으면 --resume으로 대화 이어가기
        args = []
        if session["status"] == "suspended" and session.get("claude_session_id"):
            args = ["--resume", session["claude_session_id"]]

        await pty_manager.async_spawn(
            session_id=session_id,
            work_path=session["work_path"],
            command=settings.claude_command,
            args=args,
        )

        await db_update_session(session_id, status="active")
        await update_last_accessed(session_id)

        logger.info(f"Session resumed: {session_id}")
        return await db_get_session(session_id)

    async def terminate_session(self, session_id: str) -> dict:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # PTY 강제 종료
        pty_manager.remove(session_id)

        await db_update_session(session_id, status="closed")
        logger.info(f"Session terminated: {session_id}")
        return await db_get_session(session_id)

    async def delete_session(self, session_id: str) -> None:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # PTY가 남아있으면 정리
        pty_manager.remove(session_id)

        await db_delete_session(session_id)
        logger.info(f"Session deleted: {session_id}")

session_manager = SessionManager()
