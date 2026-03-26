from __future__ import annotations

import os
import sys
from pathlib import Path


def bundled_root() -> Path | None:
    base = getattr(sys, "_MEIPASS", None)
    if not base:
        return None
    return Path(base)


def is_packaged_app() -> bool:
    return bundled_root() is not None or bool(getattr(sys, "frozen", False))


def get_project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def get_runtime_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "Remote Code"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Remote Code"
    return Path.home() / ".local" / "share" / "Remote Code"


def get_config_open_path() -> Path:
    if is_packaged_app():
        return get_runtime_data_dir()
    return get_project_root()


def get_static_dir() -> Path:
    bundled = bundled_root()
    if bundled:
        bundled_static = bundled / "backend" / "static"
        if bundled_static.is_dir():
            return bundled_static
    return Path(__file__).resolve().parent / "static"
