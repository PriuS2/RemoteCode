import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from pydantic import ValidationError

from backend.config import Settings
from backend.pty_manager import pty_manager
from remote_code_launcher import load_env_defaults


class RuntimeEnvTests(unittest.TestCase):
    def test_settings_ignore_provider_variables_in_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "CCR_HOST=127.0.0.1",
                        "ANTHROPIC_BASE_URL=https://openrouter.ai/api",
                        "OPENROUTER_API_KEY=sk-or-v1-test",
                        "ANTHROPIC_AUTH_TOKEN=sk-or-v1-test",
                        "ANTHROPIC_MODEL=moonshotai/kimi-k2.5",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                settings = Settings(_env_file=env_path)

            self.assertEqual(settings.host, "127.0.0.1")

    def test_settings_still_validate_invalid_ccr_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text("CCR_PORT=abc\n", encoding="utf-8")

            with mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaises(ValidationError):
                    Settings(_env_file=env_path)

    def test_load_env_defaults_includes_provider_variables(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(
                "ANTHROPIC_MODEL=test-model\nOPENROUTER_API_KEY=sk-or-v1-test\n",
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                load_env_defaults(env_path)
                self.assertEqual(os.environ["ANTHROPIC_MODEL"], "test-model")
                self.assertEqual(os.environ["OPENROUTER_API_KEY"], "sk-or-v1-test")

    def test_pty_child_process_inherits_provider_variables(self) -> None:
        session_id = "test-runtime-env"
        python_code = "import os; print(os.environ.get('ANTHROPIC_MODEL', 'missing'))"
        with tempfile.TemporaryDirectory() as temp_dir:
            instance = None
            try:
                with mock.patch.dict(os.environ, {"ANTHROPIC_MODEL": "test-model"}, clear=False):
                    instance = pty_manager.spawn(
                        session_id=session_id,
                        work_path=temp_dir,
                        command=sys.executable,
                        args=["-c", python_code],
                    )

                    chunks: list[str] = []
                    deadline = time.time() + 5
                    while time.time() < deadline:
                        data = instance.read()
                        if data is None:
                            break
                        if data:
                            chunks.append(data)
                            if "test-model" in data:
                                break
                        else:
                            time.sleep(0.05)

                    output = "".join(chunks)
                    self.assertIn("test-model", output)
            finally:
                if instance is not None:
                    pty_manager.remove(session_id)


if __name__ == "__main__":
    unittest.main()
