import aiosqlite
import logging
from datetime import datetime, timezone

from .config import settings

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(settings.db_path)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
    return _db


async def init_db() -> None:
    db = await get_db()
    await db.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            cli_type TEXT NOT NULL DEFAULT 'claude',
            claude_session_id TEXT,
            name TEXT NOT NULL,
            work_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_accessed_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            custom_command TEXT,
            custom_exit_command TEXT,
            order_index INTEGER NOT NULL DEFAULT 0
        )
    """)

    # Migration: Add cli_type column if it doesn't exist (for existing databases)
    try:
        await db.execute("SELECT cli_type FROM sessions LIMIT 1")
    except aiosqlite.OperationalError:
        # Column doesn't exist, add it
        await db.execute("ALTER TABLE sessions ADD COLUMN cli_type TEXT NOT NULL DEFAULT 'claude'")
        logger.info("Migrated database: added cli_type column")

    # Migration: Add custom_command column if it doesn't exist
    try:
        await db.execute("SELECT custom_command FROM sessions LIMIT 1")
    except aiosqlite.OperationalError:
        await db.execute("ALTER TABLE sessions ADD COLUMN custom_command TEXT")
        logger.info("Migrated database: added custom_command column")

    # Migration: Add custom_exit_command column if it doesn't exist
    try:
        await db.execute("SELECT custom_exit_command FROM sessions LIMIT 1")
    except aiosqlite.OperationalError:
        await db.execute("ALTER TABLE sessions ADD COLUMN custom_exit_command TEXT")
        logger.info("Migrated database: added custom_exit_command column")

    # Migration: Add order_index column if it doesn't exist
    try:
        await db.execute("SELECT order_index FROM sessions LIMIT 1")
    except aiosqlite.OperationalError:
        await db.execute("ALTER TABLE sessions ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0")
        logger.info("Migrated database: added order_index column")

    await db.commit()
    logger.info("Database initialized")


async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_session(
    session_id: str,
    name: str,
    work_path: str,
    cli_type: str = "claude",
    custom_command: str | None = None,
    custom_exit_command: str | None = None,
) -> dict:
    db = await get_db()
    now = _now()
    # Get max order_index and place new session at the end
    cursor = await db.execute("SELECT MAX(order_index) as max_order FROM sessions")
    row = await cursor.fetchone()
    order_index = (row["max_order"] or 0) + 1

    await db.execute(
        "INSERT INTO sessions (id, cli_type, name, work_path, created_at, last_accessed_at, status, custom_command, custom_exit_command, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (session_id, cli_type, name, work_path, now, now, "active", custom_command, custom_exit_command, order_index),
    )
    await db.commit()
    return {
        "id": session_id,
        "cli_type": cli_type,
        "claude_session_id": None,
        "name": name,
        "work_path": work_path,
        "created_at": now,
        "last_accessed_at": now,
        "status": "active",
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
    cursor = await db.execute("SELECT * FROM sessions ORDER BY order_index ASC, created_at ASC")
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


_ALLOWED_COLUMNS = {"cli_type", "claude_session_id", "name", "work_path", "last_accessed_at", "status", "custom_command", "custom_exit_command", "order_index"}


async def update_session(session_id: str, **kwargs) -> None:
    db = await get_db()
    sets = []
    values = []
    for key, value in kwargs.items():
        if key not in _ALLOWED_COLUMNS:
            raise ValueError(f"Invalid column: {key}")
        sets.append(f"{key} = ?")
        values.append(value)
    values.append(session_id)
    await db.execute(
        f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?",
        values,
    )
    await db.commit()


async def update_last_accessed(session_id: str) -> None:
    await update_session(session_id, last_accessed_at=_now())


async def delete_session(session_id: str) -> None:
    db = await get_db()
    await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    await db.commit()


async def mark_all_active_as_suspended() -> int:
    db = await get_db()
    cursor = await db.execute(
        "UPDATE sessions SET status = 'suspended' WHERE status = 'active'"
    )
    await db.commit()
    count = cursor.rowcount
    if count:
        logger.info(f"Marked {count} active sessions as suspended on startup")
    return count


async def update_session_order(ordered_ids: list[str]) -> None:
    """Update order_index for multiple sessions based on their position in the list."""
    db = await get_db()
    for index, session_id in enumerate(ordered_ids):
        await db.execute(
            "UPDATE sessions SET order_index = ? WHERE id = ?",
            (index, session_id)
        )
    await db.commit()
    logger.info(f"Updated order for {len(ordered_ids)} sessions")
