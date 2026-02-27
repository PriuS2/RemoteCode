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
            claude_session_id TEXT,
            name TEXT NOT NULL,
            work_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_accessed_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        )
    """)
    await db.commit()
    logger.info("Database initialized")


async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_session(session_id: str, name: str, work_path: str) -> dict:
    db = await get_db()
    now = _now()
    await db.execute(
        "INSERT INTO sessions (id, name, work_path, created_at, last_accessed_at, status) VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, name, work_path, now, now, "active"),
    )
    await db.commit()
    return {
        "id": session_id,
        "claude_session_id": None,
        "name": name,
        "work_path": work_path,
        "created_at": now,
        "last_accessed_at": now,
        "status": "active",
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
    cursor = await db.execute("SELECT * FROM sessions ORDER BY last_accessed_at DESC")
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


_ALLOWED_COLUMNS = {"claude_session_id", "name", "work_path", "last_accessed_at", "status"}


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
