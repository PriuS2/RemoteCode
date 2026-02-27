"""Async git subprocess utilities."""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)


class GitError(Exception):
    """Git command execution error."""

    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode


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
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_path,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise GitError(f"Git command timed out after {timeout}s: git {' '.join(args)}")
    except FileNotFoundError:
        raise GitError("Git is not installed or not found in PATH")

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        raise GitError(err_msg or f"git {args[0]} failed", proc.returncode)

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
