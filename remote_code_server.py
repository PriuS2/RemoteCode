from __future__ import annotations

import argparse

from remote_code_bootstrap import (
    ENV_FILENAME,
    LauncherError,
    configure_environment,
    ensure_env_file,
    ensure_port_available,
    ensure_static_build,
    resolve_data_dir,
    show_error,
    shutdown_server,
    start_server_thread,
    wait_for_health,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the Remote Code backend without opening a browser.")
    parser.add_argument("--host", help="Bind host override.")
    parser.add_argument("--port", type=int, help="Bind port override.")
    parser.add_argument("--data-dir", help="App data directory override.")
    return parser.parse_args()


def run() -> int:
    args = parse_args()
    data_dir = resolve_data_dir(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    env_path = ensure_env_file(data_dir / ENV_FILENAME, data_dir)
    host, port = configure_environment(args.host, args.port, env_path, data_dir)
    ensure_static_build()
    ensure_port_available(host, port)
    handle = start_server_thread(host, port)

    try:
        wait_for_health(port, handle)
        print(f"Remote Code backend ready on http://127.0.0.1:{port}", flush=True)
        while handle.thread.is_alive():
            handle.thread.join(timeout=0.5)
    except KeyboardInterrupt:
        shutdown_server(handle)
    return 0


def main() -> int:
    try:
        return run()
    except LauncherError as exc:
        show_error(str(exc))
        return 1
    except Exception as exc:  # pragma: no cover
        show_error(f"Unexpected launcher error.\n{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
