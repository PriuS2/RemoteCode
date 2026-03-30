import json
import logging
import uuid
from datetime import datetime, timezone

import aiosqlite

from .config import settings
from .project_layouts import LayoutNode, collect_session_ids, prune_sessions, sanitize_layout

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(settings.db_path)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
    return _db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _column_exists(db: aiosqlite.Connection, table: str, column: str) -> bool:
    cursor = await db.execute(f"PRAGMA table_info({table})")
    rows = await cursor.fetchall()
    return any(row["name"] == column for row in rows)


async def _migrate_sessions_to_projects(db: aiosqlite.Connection) -> None:
    cursor = await db.execute("""
        SELECT id, name, work_path, created_at, last_accessed_at, order_index
        FROM sessions
        WHERE project_id IS NULL OR TRIM(project_id) = ''
        ORDER BY order_index ASC, created_at ASC
    """)
    rows = await cursor.fetchall()
    if not rows:
        return

    cursor = await db.execute("SELECT COALESCE(MAX(order_index), -1) AS max_order FROM projects")
    row = await cursor.fetchone()
    next_order = (row["max_order"] or -1) + 1

    for session in rows:
        project_id = str(uuid.uuid4())
        created_at = session["created_at"] or _now()
        updated_at = session["last_accessed_at"] or created_at
        await db.execute(
            """
            INSERT INTO projects (id, name, work_path, created_at, updated_at, order_index)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                session["name"],
                session["work_path"],
                created_at,
                updated_at,
                next_order,
            ),
        )
        await db.execute(
            "UPDATE sessions SET project_id = ?, order_index = ? WHERE id = ?",
            (project_id, 0, session["id"]),
        )
        next_order += 1

    logger.info("Migrated %s legacy sessions into standalone projects", len(rows))


async def init_db() -> None:
    db = await get_db()
    await db.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            work_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0,
            layout_json TEXT
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            cli_type TEXT NOT NULL DEFAULT 'claude',
            claude_session_id TEXT,
            name TEXT NOT NULL,
            work_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_accessed_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            cli_options TEXT,
            custom_command TEXT,
            custom_exit_command TEXT,
            order_index INTEGER NOT NULL DEFAULT 0
        )
    """)

    if not await _column_exists(db, "sessions", "cli_type"):
        await db.execute("ALTER TABLE sessions ADD COLUMN cli_type TEXT NOT NULL DEFAULT 'claude'")
        logger.info("Migrated database: added sessions.cli_type")

    if not await _column_exists(db, "sessions", "custom_command"):
        await db.execute("ALTER TABLE sessions ADD COLUMN custom_command TEXT")
        logger.info("Migrated database: added sessions.custom_command")

    if not await _column_exists(db, "sessions", "cli_options"):
        await db.execute("ALTER TABLE sessions ADD COLUMN cli_options TEXT")
        logger.info("Migrated database: added sessions.cli_options")

    if not await _column_exists(db, "sessions", "custom_exit_command"):
        await db.execute("ALTER TABLE sessions ADD COLUMN custom_exit_command TEXT")
        logger.info("Migrated database: added sessions.custom_exit_command")

    if not await _column_exists(db, "sessions", "order_index"):
        await db.execute("ALTER TABLE sessions ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0")
        logger.info("Migrated database: added sessions.order_index")

    if not await _column_exists(db, "sessions", "project_id"):
        await db.execute("ALTER TABLE sessions ADD COLUMN project_id TEXT")
        logger.info("Migrated database: added sessions.project_id")

    if not await _column_exists(db, "projects", "layout_json"):
        await db.execute("ALTER TABLE projects ADD COLUMN layout_json TEXT")
        logger.info("Migrated database: added projects.layout_json")

    await _migrate_sessions_to_projects(db)
    await db.commit()
    logger.info("Database initialized")


async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None


async def create_project(name: str, work_path: str) -> dict:
    db = await get_db()
    now = _now()
    cursor = await db.execute("SELECT COALESCE(MAX(order_index), -1) AS max_order FROM projects")
    row = await cursor.fetchone()
    order_index = (row["max_order"] or -1) + 1
    project_id = str(uuid.uuid4())

    await db.execute(
        """
        INSERT INTO projects (id, name, work_path, created_at, updated_at, order_index, layout_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (project_id, name, work_path, now, now, order_index, None),
    )
    await db.commit()
    return {
        "id": project_id,
        "name": name,
        "work_path": work_path,
        "created_at": now,
        "updated_at": now,
        "order_index": order_index,
        "layout_json": None,
        "sessions": [],
    }


async def get_project(project_id: str) -> dict | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    project = dict(row)
    project["sessions"] = await list_project_sessions(project_id)
    return project


async def list_project_sessions(project_id: str) -> list[dict]:
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT *
        FROM sessions
        WHERE project_id = ?
        ORDER BY order_index ASC, created_at ASC
        """,
        (project_id,),
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def list_projects() -> list[dict]:
    db = await get_db()
    project_cursor = await db.execute(
        "SELECT * FROM projects ORDER BY order_index ASC, created_at ASC"
    )
    session_cursor = await db.execute(
        """
        SELECT *
        FROM sessions
        ORDER BY project_id ASC, order_index ASC, created_at ASC
        """
    )
    project_rows = await project_cursor.fetchall()
    session_rows = await session_cursor.fetchall()

    sessions_by_project: dict[str, list[dict]] = {}
    for row in session_rows:
        session = dict(row)
        sessions_by_project.setdefault(session["project_id"], []).append(session)

    projects: list[dict] = []
    for row in project_rows:
        project = dict(row)
        project["sessions"] = sessions_by_project.get(project["id"], [])
        projects.append(project)
    return projects


async def delete_project_record(project_id: str) -> None:
    db = await get_db()
    await db.execute("DELETE FROM sessions WHERE project_id = ?", (project_id,))
    await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    await db.commit()


_PROJECT_ALLOWED_COLUMNS = {"name", "work_path", "updated_at", "order_index"}


async def update_project(project_id: str, **kwargs) -> None:
    if not kwargs:
        return

    db = await get_db()
    sets = []
    values = []
    for key, value in kwargs.items():
        if key not in _PROJECT_ALLOWED_COLUMNS:
            raise ValueError(f"Invalid project column: {key}")
        sets.append(f"{key} = ?")
        values.append(value)
    values.append(project_id)
    await db.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", values)
    await db.commit()


async def update_project_order(ordered_ids: list[str]) -> None:
    db = await get_db()
    for index, project_id in enumerate(ordered_ids):
        await db.execute(
            "UPDATE projects SET order_index = ?, updated_at = ? WHERE id = ?",
            (index, _now(), project_id),
        )
    await db.commit()
    logger.info("Updated order for %s projects", len(ordered_ids))


def _encode_layout_json(layout: LayoutNode | None) -> str | None:
    sanitized = sanitize_layout(layout)
    if sanitized is None:
        return None
    return json.dumps(sanitized, separators=(",", ":"), ensure_ascii=True)


def _decode_layout_json(layout_json: str | None) -> LayoutNode | None:
    if not layout_json:
        return None
    try:
        raw = json.loads(layout_json)
    except json.JSONDecodeError:
        logger.warning("Failed to decode stored layout JSON")
        return None
    return sanitize_layout(raw)


async def list_existing_session_ids(session_ids: list[str] | set[str] | None = None) -> set[str]:
    db = await get_db()
    values: tuple[str, ...] = tuple(session_ids or [])
    if values:
        placeholders = ",".join("?" for _ in values)
        cursor = await db.execute(
            f"SELECT id FROM sessions WHERE id IN ({placeholders})",
            values,
        )
    else:
        cursor = await db.execute("SELECT id FROM sessions")
    rows = await cursor.fetchall()
    return {row["id"] for row in rows}


async def get_project_layout(project_id: str) -> LayoutNode | None:
    db = await get_db()
    cursor = await db.execute("SELECT layout_json FROM projects WHERE id = ?", (project_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    return _decode_layout_json(row["layout_json"])


async def update_project_layout(project_id: str, layout: LayoutNode | None) -> None:
    db = await get_db()
    now = _now()
    await db.execute(
        "UPDATE projects SET layout_json = ?, updated_at = ? WHERE id = ?",
        (_encode_layout_json(layout), now, project_id),
    )
    await db.commit()


async def prune_project_layouts(
    removed_session_ids: set[str],
    *,
    exclude_project_ids: set[str] | None = None,
) -> int:
    if not removed_session_ids:
        return 0

    db = await get_db()
    cursor = await db.execute("SELECT id, layout_json FROM projects")
    rows = await cursor.fetchall()
    excluded = exclude_project_ids or set()
    updated_count = 0

    for row in rows:
        project_id = row["id"]
        if project_id in excluded:
            continue

        layout = _decode_layout_json(row["layout_json"])
        if not layout:
            continue

        referenced_session_ids = set(collect_session_ids(layout))
        if referenced_session_ids.isdisjoint(removed_session_ids):
            continue

        pruned_layout = prune_sessions(layout, removed_session_ids)
        await db.execute(
            "UPDATE projects SET layout_json = ?, updated_at = ? WHERE id = ?",
            (_encode_layout_json(pruned_layout), _now(), project_id),
        )
        updated_count += 1

    if updated_count:
        await db.commit()
        logger.info("Pruned layouts for %s projects after removing %s sessions", updated_count, len(removed_session_ids))
    return updated_count


async def create_session(
    session_id: str,
    project_id: str,
    name: str,
    work_path: str,
    cli_type: str = "claude",
    cli_options: str | None = None,
    custom_command: str | None = None,
    custom_exit_command: str | None = None,
) -> dict:
    db = await get_db()
    now = _now()
    cursor = await db.execute(
        "SELECT COALESCE(MAX(order_index), -1) AS max_order FROM sessions WHERE project_id = ?",
        (project_id,),
    )
    row = await cursor.fetchone()
    order_index = (row["max_order"] or -1) + 1

    await db.execute(
        """
        INSERT INTO sessions (
            id, project_id, cli_type, name, work_path, created_at,
            last_accessed_at, status, cli_options, custom_command, custom_exit_command, order_index
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            project_id,
            cli_type,
            name,
            work_path,
            now,
            now,
            "active",
            cli_options,
            custom_command,
            custom_exit_command,
            order_index,
        ),
    )
    await update_project(project_id, updated_at=now)
    return {
        "id": session_id,
        "project_id": project_id,
        "cli_type": cli_type,
        "claude_session_id": None,
        "name": name,
        "work_path": work_path,
        "created_at": now,
        "last_accessed_at": now,
        "status": "active",
        "cli_options": cli_options,
        "custom_command": custom_command,
        "custom_exit_command": custom_exit_command,
        "order_index": order_index,
    }


async def get_session(session_id: str) -> dict | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if row:
        return dict(row)
    return None


async def list_sessions() -> list[dict]:
    db = await get_db()
    cursor = await db.execute("""
        SELECT s.*
        FROM sessions s
        LEFT JOIN projects p ON p.id = s.project_id
        ORDER BY p.order_index ASC, s.order_index ASC, s.created_at ASC
    """)
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


_SESSION_ALLOWED_COLUMNS = {
    "project_id",
    "cli_type",
    "claude_session_id",
    "name",
    "work_path",
    "last_accessed_at",
    "status",
    "cli_options",
    "custom_command",
    "custom_exit_command",
    "order_index",
}


async def update_session(session_id: str, **kwargs) -> None:
    if not kwargs:
        return

    db = await get_db()
    sets = []
    values = []
    for key, value in kwargs.items():
        if key not in _SESSION_ALLOWED_COLUMNS:
            raise ValueError(f"Invalid session column: {key}")
        sets.append(f"{key} = ?")
        values.append(value)
    values.append(session_id)
    await db.execute(f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", values)
    await db.commit()


async def update_last_accessed(session_id: str) -> None:
    await update_session(session_id, last_accessed_at=_now())


async def delete_session(session_id: str) -> None:
    db = await get_db()
    cursor = await db.execute("SELECT project_id FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    if row and row["project_id"]:
        await db.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            (_now(), row["project_id"]),
        )
    await db.commit()


async def mark_all_active_as_suspended() -> int:
    db = await get_db()
    cursor = await db.execute(
        "UPDATE sessions SET status = 'suspended' WHERE status = 'active'"
    )
    await db.commit()
    count = cursor.rowcount
    if count:
        logger.info("Marked %s active sessions as suspended on startup", count)
    return count


async def update_project_session_order(project_id: str, ordered_ids: list[str]) -> None:
    db = await get_db()
    for index, session_id in enumerate(ordered_ids):
        await db.execute(
            """
            UPDATE sessions
            SET order_index = ?
            WHERE id = ? AND project_id = ?
            """,
            (index, session_id, project_id),
        )
    await db.execute(
        "UPDATE projects SET updated_at = ? WHERE id = ?",
        (_now(), project_id),
    )
    await db.commit()
    logger.info("Updated order for %s sessions in project %s", len(ordered_ids), project_id)
