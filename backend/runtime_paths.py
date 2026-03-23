from __future__ import annotations

import sys
from pathlib import Path


def bundled_root() -> Path | None:
    base = getattr(sys, "_MEIPASS", None)
    if not base:
        return None
    return Path(base)


def get_static_dir() -> Path:
    bundled = bundled_root()
    if bundled:
        bundled_static = bundled / "backend" / "static"
        if bundled_static.is_dir():
            return bundled_static
    return Path(__file__).resolve().parent / "static"
