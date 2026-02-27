"""Async git subprocess utilities."""

import asyncio
import logging
import os
import subprocess

logger = logging.getLogger(__name__)


class GitError(Exception):
    """Git command execution error."""

    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode


def _run_git_sync(cmd: list[str], work_path: str, env: dict, timeout: int) -> tuple[bytes, bytes, int]:
    """Run git command synchronously (called via asyncio.to_thread)."""
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=work_path,
            env=env,
            timeout=timeout,
        )
        return proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired:
        raise TimeoutError()


async def run_git(work_path: str, args: list[str], timeout: int = 30) -> str:
    """Run a git command asynchronously and return stdout.

    Args:
        work_path: Working directory for the git command.
        args: List of git arguments (e.g. ["status", "--porcelain=v2"]).
        timeout: Timeout in seconds (default 30).

    Returns:
        stdout as a string.

    Raises:
        GitError: If the command fails or times out.
    """
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = ""
    # Prevent git from using a pager
    env["GIT_PAGER"] = ""

    cmd = ["git"] + args

    try:
        stdout, stderr, returncode = await asyncio.to_thread(
            _run_git_sync, cmd, work_path, env, timeout
        )
    except TimeoutError:
        raise GitError(f"Git command timed out after {timeout}s: git {' '.join(args)}")
    except FileNotFoundError:
        raise GitError("Git is not installed or not found in PATH")

    if returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        raise GitError(err_msg or f"git {args[0]} failed", returncode)

    return stdout.decode("utf-8", errors="replace")


async def is_git_repo(work_path: str) -> bool:
    """Check if the given path is inside a git repository."""
    try:
        await run_git(work_path, ["rev-parse", "--is-inside-work-tree"], timeout=5)
        return True
    except GitError:
        return False


async def get_git_root(work_path: str) -> str:
    """Get the root directory of the git repository."""
    result = await run_git(work_path, ["rev-parse", "--show-toplevel"], timeout=5)
    return result.strip()
