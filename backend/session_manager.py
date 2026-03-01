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
    update_session_order as db_update_session_order,
)
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)


class SessionManager:
    async def create_session(
        self,
        work_path: str,
        name: Optional[str] = None,
        create_folder: bool = False,
        cli_type: str = "claude",
        custom_command: Optional[str] = None,
        custom_exit_command: Optional[str] = None,
    ) -> dict:
        work_path = os.path.abspath(work_path)

        if create_folder and not os.path.exists(work_path):
            os.makedirs(work_path, exist_ok=True)

        if not os.path.isdir(work_path):
            raise ValueError(f"Directory does not exist: {work_path}")

        session_id = str(uuid.uuid4())
        display_name = name or os.path.basename(work_path)

        # Determine which command to use based on cli_type
        if cli_type == "opencode":
            command = settings.opencode_command
        elif cli_type == "terminal":
            # OS별 기본 터미널 선택
            if os.name == "nt":
                command = "powershell.exe"  # Windows
            else:
                command = os.environ.get("SHELL", "/bin/bash")  # Linux/macOS
        elif cli_type == "custom":
            if not custom_command:
                raise ValueError("Custom command is required for custom CLI type")
            command = custom_command
        else:
            command = settings.claude_command

        # DB에 세션 생성
        session = await db_create_session(
            session_id, display_name, work_path, cli_type, custom_command, custom_exit_command
        )

        # PTY 생성 (10초 타임아웃)
        try:
            await asyncio.wait_for(
                pty_manager.async_spawn(
                    session_id=session_id,
                    work_path=work_path,
                    command=command,
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
            # 종료 명령어 결정
            cli_type = session.get("cli_type", "claude")
            if cli_type == "custom" and session.get("custom_exit_command"):
                exit_cmd = session["custom_exit_command"]
            elif cli_type == "terminal":
                exit_cmd = "exit"  # 터미널은 exit 명령어 사용
            elif cli_type == "opencode":
                exit_cmd = "/exit"
            else:
                exit_cmd = "/exit"

            #명령을 한 글자씩 보내고, Enter를 딜레이 후 전송
            for ch in exit_cmd:
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

            # 버퍼에서 세션 ID 추출 (CLI 타입별로 다른 패턴 사용)
            await asyncio.sleep(0.5)  # WebSocket reader가 마지막 출력을 버퍼에 쓸 시간
            output = instance.get_output_buffer()

            if cli_type == "opencode":
                # OpenCode: "opencode -s (ses_[A-Za-z0-9]+)" 패턴
                resume_pattern = re.compile(r"opencode\s+-s\s+(ses_[A-Za-z0-9]+)")
            elif cli_type == "terminal":
                # Terminal: 세션 ID 추출 안 함
                resume_pattern = None
            elif cli_type == "custom":
                # Custom CLI: 세션 ID 추출 안 함
                resume_pattern = None
            else:
                # Claude Code: "--resume ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})" 패턴
                resume_pattern = re.compile(r"--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")

            match = resume_pattern.search(output) if resume_pattern else None
            if match:
                cli_sid = match.group(1)
                await db_update_session(session_id, claude_session_id=cli_sid)
                logger.info(f"Captured session_id from output: {cli_sid} [cli_type={cli_type}]")
            else:
                logger.warning(f"Could not find resume ID in output buffer ({len(output)} chars) [cli_type={cli_type}]")

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

        # Determine which command to use based on cli_type
        cli_type = session.get("cli_type", "claude")
        if cli_type == "opencode":
            command = settings.opencode_command
        elif cli_type == "terminal":
            # OS별 기본 터미널 선택
            if os.name == "nt":
                command = "powershell.exe"  # Windows
            else:
                command = os.environ.get("SHELL", "/bin/bash")  # Linux/macOS
        elif cli_type == "custom":
            command = session.get("custom_command") or "echo 'No custom command set'"
        else:
            command = settings.claude_command

        # suspended + claude_session_id가 있으면 resume으로 대화 이어가기
        args = []
        if session["status"] == "suspended" and session.get("claude_session_id"):
            if cli_type == "opencode":
                # OpenCode: -s <session_id>
                args = ["-s", session["claude_session_id"]]
            elif cli_type == "terminal":
                # Terminal: resume args not supported
                args = []
            elif cli_type == "custom":
                # Custom CLI: resume args not supported
                args = []
            else:
                # Claude: --resume <session_id>
                args = ["--resume", session["claude_session_id"]]

        await pty_manager.async_spawn(
            session_id=session_id,
            work_path=session["work_path"],
            command=command,
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

    async def update_session_order(self, ordered_ids: list[str]) -> None:
        """Update the order of sessions."""
        await db_update_session_order(ordered_ids)

session_manager = SessionManager()
