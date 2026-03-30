import asyncio
import logging
import os
import re
import shlex
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional

from .config import settings
from .database import (
    create_project as db_create_project,
    create_session as db_create_session,
    delete_project_record as db_delete_project_record,
    delete_session as db_delete_session,
    get_project_layout as db_get_project_layout,
    get_project as db_get_project,
    list_existing_session_ids as db_list_existing_session_ids,
    get_session as db_get_session,
    list_project_sessions as db_list_project_sessions,
    list_projects as db_list_projects,
    list_sessions as db_list_sessions,
    prune_project_layouts as db_prune_project_layouts,
    update_last_accessed,
    update_project_layout as db_update_project_layout,
    update_project as db_update_project,
    update_project_order as db_update_project_order,
    update_project_session_order as db_update_project_session_order,
    update_session as db_update_session,
)
from .language_server import language_server_manager
from .pty_manager import PtyInstance, pty_manager
from .project_layouts import (
    LayoutNode,
    LayoutValidationError,
    collect_session_ids,
    prune_sessions,
    sanitize_layout,
)

logger = logging.getLogger(__name__)

NON_PTY_CLI_TYPES = {"folder", "git", "ide"}
SUPPORTED_CLI_TYPES = {"claude", "kilo", "opencode", "terminal", "custom", "folder", "git", "ide"}
CLI_TYPES_WITH_OPTIONS = {"claude", "kilo", "opencode", "terminal"}


class SessionValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SessionManager:
    def _validate_cli_type(self, cli_type: str) -> None:
        if cli_type not in SUPPORTED_CLI_TYPES:
            raise SessionValidationError("invalid_command", f"Unsupported session type: {cli_type}")

    def _normalize_cli_options(self, cli_type: str, cli_options: Optional[str] = None) -> Optional[str]:
        normalized = cli_options.strip() if cli_options and cli_options.strip() else None
        if normalized and cli_type not in CLI_TYPES_WITH_OPTIONS:
            raise SessionValidationError(
                "invalid_command",
                f"Options are not supported for {cli_type} sessions.",
            )
        return normalized

    def _default_command(self, cli_type: str, custom_command: Optional[str] = None) -> Optional[str]:
        self._validate_cli_type(cli_type)
        if cli_type == "kilo":
            return settings.kilo_command
        if cli_type == "opencode":
            return settings.opencode_command
        if cli_type == "terminal":
            if os.name == "nt":
                return "powershell.exe"
            return os.environ.get("SHELL", "/bin/bash")
        if cli_type == "custom":
            if not custom_command or not custom_command.strip():
                raise SessionValidationError(
                    "custom_command_missing",
                    "Custom command is required for Custom CLI.",
                )
            return custom_command.strip()
        if cli_type in NON_PTY_CLI_TYPES:
            return None
        return settings.claude_command

    def _command_parts(
        self,
        cli_type: str,
        custom_command: Optional[str] = None,
        cli_options: Optional[str] = None,
    ) -> list[str]:
        normalized_options = self._normalize_cli_options(cli_type, cli_options)
        command = self._default_command(cli_type, custom_command)
        if command is None:
            return []

        parts = self._split_command(command)
        if normalized_options:
            parts.extend(self._split_command(normalized_options))
        return parts

    def _split_command(self, command: str) -> list[str]:
        try:
            parts = shlex.split(command, posix=os.name != "nt")
        except ValueError as exc:
            raise SessionValidationError("invalid_command", f"Invalid command syntax: {exc}") from exc
        if not parts:
            raise SessionValidationError("invalid_command", "Command is empty.")
        return parts

    def _validate_command_parts(self, parts: list[str]) -> list[str]:
        if not parts:
            raise SessionValidationError("invalid_command", "Command is empty.")

        executable = parts[0]

        resolved = shutil.which(executable)
        if resolved:
            return parts

        has_path_separator = any(sep in executable for sep in (os.sep, "/", "\\"))
        if has_path_separator or os.path.isabs(executable):
            candidate = os.path.abspath(executable)
            if os.path.exists(candidate) and not os.access(candidate, os.X_OK):
                raise SessionValidationError(
                    "permission_denied",
                    f"Permission denied: {candidate}",
                )

        raise SessionValidationError("cli_not_found", f"CLI not found: {executable}")

    def _validate_work_path(self, work_path: str, create_folder: bool) -> str:
        normalized = work_path.strip()
        if not normalized:
            raise SessionValidationError("work_path_missing", "Work path is required.")

        absolute_path = os.path.abspath(normalized)
        if os.path.exists(absolute_path):
            if not os.path.isdir(absolute_path):
                raise SessionValidationError(
                    "directory_not_found",
                    f"Directory does not exist: {absolute_path}",
                )
            if not os.access(absolute_path, os.R_OK | os.W_OK | os.X_OK):
                raise SessionValidationError(
                    "permission_denied",
                    f"Permission denied: {absolute_path}",
                )
            return absolute_path

        if not create_folder:
            raise SessionValidationError(
                "directory_not_found",
                f"Directory does not exist: {absolute_path}",
            )

        parent = os.path.dirname(absolute_path) or absolute_path
        while parent and not os.path.exists(parent):
            next_parent = os.path.dirname(parent)
            if next_parent == parent:
                break
            parent = next_parent

        if parent and os.path.exists(parent) and not os.access(parent, os.W_OK | os.X_OK):
            raise SessionValidationError(
                "permission_denied",
                f"Permission denied: {parent}",
            )

        return absolute_path

    def _validate_command_available(self, command: str) -> list[str]:
        return self._validate_command_parts(self._split_command(command))

    def preflight_session(
        self,
        work_path: str,
        create_folder: bool = False,
        cli_type: str = "claude",
        cli_options: Optional[str] = None,
        custom_command: Optional[str] = None,
    ) -> dict:
        validated_path = self._validate_work_path(work_path, create_folder)
        parts = self._command_parts(cli_type, custom_command, cli_options)

        if not parts:
            ready_messages = {
                "folder": "Folder session is ready.",
                "git": "Git session is ready.",
                "ide": "IDE session is ready.",
            }
            return {
                "ok": True,
                "code": "ok",
                "message": ready_messages.get(cli_type, "Session is ready."),
                "resolved_command": None,
                "work_path": validated_path,
            }

        parts = self._validate_command_parts(parts)
        resolved_command = " ".join(parts)
        ready_messages = {
            "claude": "Claude Code CLI is available.",
            "kilo": "Kilo CLI is available.",
            "opencode": "OpenCode CLI is available.",
        }
        return {
            "ok": True,
            "code": "ok",
            "message": ready_messages.get(cli_type, f"{parts[0]} is available."),
            "resolved_command": resolved_command,
            "work_path": validated_path,
        }

    async def create_project(
        self,
        work_path: str,
        name: Optional[str] = None,
        create_folder: bool = False,
    ) -> dict:
        validated_path = self._validate_work_path(work_path, create_folder)
        if create_folder and not os.path.exists(validated_path):
            os.makedirs(validated_path, exist_ok=True)

        if not os.path.isdir(validated_path):
            raise SessionValidationError("directory_not_found", f"Directory does not exist: {validated_path}")

        display_name = name or os.path.basename(validated_path)
        project = await db_create_project(display_name, validated_path)
        logger.info(f"Project created: {project['id']} ({display_name}) at {validated_path}")
        return project

    async def list_projects(self) -> list[dict]:
        projects = await db_list_projects()
        for project in projects:
            project["sessions"] = [
                session for session in project.get("sessions", [])
                if session.get("cli_type") in SUPPORTED_CLI_TYPES
            ]
        return projects

    async def rename_project(self, project_id: str, name: str) -> dict:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")
        await db_update_project(project_id, name=name.strip(), updated_at=self._timestamp())
        return await db_get_project(project_id)

    async def _prune_missing_sessions_from_layout(self, layout: LayoutNode | None) -> LayoutNode | None:
        if not layout:
            return None

        referenced_session_ids = collect_session_ids(layout)
        if not referenced_session_ids:
            return None

        existing_session_ids = await db_list_existing_session_ids(referenced_session_ids)
        removed_session_ids = set(referenced_session_ids) - existing_session_ids
        if not removed_session_ids:
            return layout
        return prune_sessions(layout, removed_session_ids)

    async def get_project_layout(self, project_id: str) -> LayoutNode | None:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        layout = await db_get_project_layout(project_id)
        if not layout:
            return None

        pruned_layout = await self._prune_missing_sessions_from_layout(layout)
        if pruned_layout != layout:
            await db_update_project_layout(project_id, pruned_layout)
        return pruned_layout

    async def save_project_layout(self, project_id: str, layout: LayoutNode | None) -> LayoutNode | None:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        if layout is None:
            await db_update_project_layout(project_id, None)
            return None

        try:
            sanitized_layout = sanitize_layout(layout)
        except LayoutValidationError as exc:
            raise SessionValidationError(exc.code, exc.message) from exc

        pruned_layout = await self._prune_missing_sessions_from_layout(sanitized_layout)
        await db_update_project_layout(project_id, pruned_layout)
        return pruned_layout

    async def delete_project(self, project_id: str) -> None:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        sessions = await db_list_project_sessions(project_id)
        removed_session_ids = {session["id"] for session in sessions}
        for session in sessions:
            if session.get("cli_type", "claude") not in NON_PTY_CLI_TYPES:
                pty_manager.remove(session["id"])
            elif session.get("cli_type") == "ide":
                await language_server_manager.close_session(session["id"])

        await db_delete_project_record(project_id)
        await db_prune_project_layouts(removed_session_ids, exclude_project_ids={project_id})
        logger.info(f"Project deleted: {project_id}")

    async def update_project_order(self, ordered_ids: list[str]) -> None:
        await db_update_project_order(ordered_ids)

    async def update_project_session_order(self, project_id: str, ordered_ids: list[str]) -> None:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")
        await db_update_project_session_order(project_id, ordered_ids)

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    async def create_session(
        self,
        project_id: str,
        name: Optional[str] = None,
        cli_type: str = "claude",
        cli_options: Optional[str] = None,
        custom_command: Optional[str] = None,
        custom_exit_command: Optional[str] = None,
    ) -> dict:
        project = await db_get_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        work_path = project["work_path"]
        preflight = self.preflight_session(
            work_path=work_path,
            create_folder=False,
            cli_type=cli_type,
            cli_options=cli_options,
            custom_command=custom_command,
        )
        work_path = preflight["work_path"]

        if not os.path.isdir(work_path):
            raise SessionValidationError("directory_not_found", f"Directory does not exist: {work_path}")

        session_id = str(uuid.uuid4())
        display_name = name or f"{project['name']} Session"

        parts = self._command_parts(cli_type, custom_command, cli_options)
        command = None
        command_args: list[str] = []
        if parts:
            parts = self._validate_command_parts(parts)
            command = parts[0]
            command_args = parts[1:]

        # DB에 세션 생성
        session = await db_create_session(
            session_id,
            project_id,
            display_name,
            work_path,
            cli_type,
            self._normalize_cli_options(cli_type, cli_options),
            custom_command,
            custom_exit_command,
        )

        # Non-PTY session types only persist state and render dedicated UI panels.
        if cli_type in NON_PTY_CLI_TYPES:
            logger.info(f"Session created: {session_id} ({display_name}) at {work_path} ({cli_type}, no PTY)")
            return session

        # PTY 생성 (10초 타임아웃)
        try:
            await asyncio.wait_for(
                pty_manager.async_spawn(
                    session_id=session_id,
                    work_path=work_path,
                    command=command,
                    args=command_args,
                ),
                timeout=10,
            )
        except Exception as e:
            logger.error(f"PTY spawn failed for {session_id}: {e}")
            await db_delete_session(session_id)
            raise SessionValidationError("spawn_failed", f"Failed to start terminal: {e}") from e

        logger.info(f"Session created: {session_id} ({display_name}) at {work_path}")
        return session

    async def list_sessions(self) -> list[dict]:
        return [
            session for session in await db_list_sessions()
            if session.get("cli_type") in SUPPORTED_CLI_TYPES
        ]

    async def get_session(self, session_id: str) -> Optional[dict]:
        return await db_get_session(session_id)

    async def suspend_session(self, session_id: str) -> dict:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")
        if session["status"] != "active":
            raise ValueError(f"Session is not active: {session_id}")

        cli_type = session.get("cli_type", "claude")
        if cli_type == "kilo":
            raise SessionValidationError(
                "suspend_not_supported",
                "Kilo sessions cannot be suspended in Remote Code. Create a new Kilo session instead.",
            )

        if cli_type in NON_PTY_CLI_TYPES:
            if cli_type == "ide":
                await language_server_manager.close_session(session_id)
            await db_update_session(session_id, status="suspended")
            return await db_get_session(session_id)

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

        cli_type = session.get("cli_type", "claude")
        if cli_type in NON_PTY_CLI_TYPES:
            await db_update_session(session_id, status="active")
            await update_last_accessed(session_id)
            logger.info(f"Session resumed: {session_id} ({cli_type})")
            return await db_get_session(session_id)

        # 기존 PTY 정리
        existing = pty_manager.get(session_id)
        if existing:
            pty_manager.remove(session_id)

        parts = self._validate_command_parts(
            self._command_parts(
                cli_type,
                custom_command=session.get("custom_command"),
                cli_options=session.get("cli_options"),
            ),
        )
        command = parts[0]
        command_args = parts[1:]

        args: list[str] = []
        if session["status"] == "suspended" and session.get("claude_session_id"):
            if cli_type == "opencode":
                args = ["-s", session["claude_session_id"]]
            elif cli_type == "claude":
                args = ["--resume", session["claude_session_id"]]

        await pty_manager.async_spawn(
            session_id=session_id,
            work_path=session["work_path"],
            command=command,
            args=command_args + args,
        )

        await db_update_session(session_id, status="active")
        await update_last_accessed(session_id)

        logger.info(f"Session resumed: {session_id}")
        return await db_get_session(session_id)

        # Determine which command to use based on cli_type
        cli_type = session.get("cli_type", "claude")
        if cli_type == "kilo":
            command = settings.kilo_command
            command_args: list[str] = []
        elif cli_type == "opencode":
            command = settings.opencode_command
            command_args: list[str] = []
        elif cli_type == "terminal":
            # OS별 기본 터미널 선택
            if os.name == "nt":
                command = "powershell.exe"  # Windows
            else:
                command = os.environ.get("SHELL", "/bin/bash")  # Linux/macOS
            command_args = []
        elif cli_type == "custom":
            custom = session.get("custom_command")
            if not custom:
                raise SessionValidationError("custom_command_missing", "Custom command is required for Custom CLI.")
            parts = self._validate_command_available(custom)
            command = parts[0]
            command_args = parts[1:]
        else:
            parts = self._validate_command_parts(
                self._command_parts(
                    cli_type,
                    custom_command=session.get("custom_command"),
                    cli_options=session.get("cli_options"),
                ),
            )
            command = parts[0]
            command_args = parts[1:]

        # suspended + claude_session_id가 있으면 resume으로 대화 이어가기
        args = []
        if session["status"] == "suspended" and session.get("claude_session_id"):
            if cli_type == "opencode":
                # OpenCode: -s <session_id>
                args = ["-s", session["claude_session_id"]]
            elif cli_type == "kilo":
                # Kilo sessions relaunch fresh rather than resuming prior TUI state.
                args = []
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
            args=command_args + args,
        )

        await db_update_session(session_id, status="active")
        await update_last_accessed(session_id)

        logger.info(f"Session resumed: {session_id}")
        return await db_get_session(session_id)

    async def terminate_session(self, session_id: str) -> dict:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        cli_type = session.get("cli_type", "claude")

        if cli_type not in NON_PTY_CLI_TYPES:
            pty_manager.remove(session_id)
        elif cli_type == "ide":
            await language_server_manager.close_session(session_id)

        await db_update_session(session_id, status="closed")
        logger.info(f"Session terminated: {session_id}")
        return await db_get_session(session_id)

    async def delete_session(self, session_id: str) -> None:
        session = await db_get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        cli_type = session.get("cli_type", "claude")

        if cli_type not in NON_PTY_CLI_TYPES:
            pty_manager.remove(session_id)
        elif cli_type == "ide":
            await language_server_manager.close_session(session_id)

        await db_delete_session(session_id)
        await db_prune_project_layouts({session_id})
        logger.info(f"Session deleted: {session_id}")

session_manager = SessionManager()
