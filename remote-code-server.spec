from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.building.build_main import Analysis, EXE, PYZ
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules, copy_metadata


project_root = Path(SPECPATH)
static_dir = project_root / "backend" / "static"

datas = []
if static_dir.is_dir():
    datas.append((str(static_dir), "backend/static"))

for package_name in ("fastapi", "pydantic", "pydantic_settings", "slowapi", "starlette", "uvicorn", "websockets"):
    datas += copy_metadata(package_name)

hiddenimports = collect_submodules("uvicorn")
hiddenimports += collect_submodules("backend")

binaries = []

if sys.platform == "win32":
    hiddenimports += collect_submodules("winpty")
    datas += collect_data_files("winpty")
    binaries += collect_dynamic_libs("winpty")
else:
    hiddenimports += collect_submodules("pexpect")

a = Analysis(
    ["remote_code_server.py"],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="remote-code-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
