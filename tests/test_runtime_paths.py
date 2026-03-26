import unittest
from pathlib import Path
from unittest import mock

from backend import runtime_paths


class RuntimePathTests(unittest.TestCase):
    def test_config_path_uses_project_root_in_source_mode(self) -> None:
        with mock.patch("backend.runtime_paths.bundled_root", return_value=None):
            with mock.patch.object(runtime_paths.sys, "frozen", False, create=True):
                self.assertEqual(runtime_paths.get_config_open_path(), runtime_paths.get_project_root())

    def test_config_path_uses_runtime_data_dir_in_packaged_mode(self) -> None:
        bundled = Path("C:/tmp/_MEIPASS")
        with mock.patch("backend.runtime_paths.bundled_root", return_value=bundled):
            with mock.patch("backend.runtime_paths.get_runtime_data_dir", return_value=Path("C:/Users/test/AppData/Roaming/Remote Code")):
                self.assertEqual(
                    runtime_paths.get_config_open_path(),
                    Path("C:/Users/test/AppData/Roaming/Remote Code"),
                )


if __name__ == "__main__":
    unittest.main()
