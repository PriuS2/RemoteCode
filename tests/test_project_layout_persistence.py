import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import database
from backend.session_manager import session_manager


class ProjectLayoutPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "layouts.db"
        await database.close_db()
        self.settings_patch = mock.patch.object(database.settings, "db_path", str(self.db_path))
        self.settings_patch.start()
        await database.init_db()

        self.project_a = await database.create_project("Project A", "C:/work/project-a")
        self.project_b = await database.create_project("Project B", "C:/work/project-b")
        await database.create_session("session-a1", self.project_a["id"], "A1", self.project_a["work_path"], "folder")
        await database.create_session("session-a2", self.project_a["id"], "A2", self.project_a["work_path"], "folder")
        await database.create_session("session-b1", self.project_b["id"], "B1", self.project_b["work_path"], "folder")

    async def asyncTearDown(self) -> None:
        await database.close_db()
        self.settings_patch.stop()
        self.temp_dir.cleanup()

    async def test_save_and_get_layout_round_trip_with_foreign_project_session(self) -> None:
        layout = {
            "type": "split",
            "splitId": "split-root",
            "direction": "row",
            "ratio": 0.4,
            "first": {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
            "second": {
                "type": "leaf",
                "paneId": "pane-b1",
                "sessionId": "session-b1",
            },
        }

        saved = await session_manager.save_project_layout(self.project_a["id"], layout)
        loaded = await session_manager.get_project_layout(self.project_a["id"])

        self.assertEqual(saved, layout)
        self.assertEqual(loaded, layout)

    async def test_save_layout_prunes_missing_sessions(self) -> None:
        layout = {
            "type": "split",
            "splitId": "split-root",
            "direction": "row",
            "ratio": 0.5,
            "first": {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
            "second": {
                "type": "leaf",
                "paneId": "pane-missing",
                "sessionId": "session-missing",
            },
        }

        saved = await session_manager.save_project_layout(self.project_a["id"], layout)

        self.assertEqual(
            saved,
            {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
        )

    async def test_delete_session_prunes_other_project_layouts(self) -> None:
        layout = {
            "type": "split",
            "splitId": "split-root",
            "direction": "row",
            "ratio": 0.5,
            "first": {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
            "second": {
                "type": "leaf",
                "paneId": "pane-b1",
                "sessionId": "session-b1",
            },
        }
        await session_manager.save_project_layout(self.project_a["id"], layout)

        await session_manager.delete_session("session-b1")
        loaded = await session_manager.get_project_layout(self.project_a["id"])

        self.assertEqual(
            loaded,
            {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
        )

    async def test_delete_project_prunes_cross_project_session_references(self) -> None:
        await database.create_session("session-b2", self.project_b["id"], "B2", self.project_b["work_path"], "folder")
        layout = {
            "type": "split",
            "splitId": "split-root",
            "direction": "column",
            "ratio": 0.6,
            "first": {
                "type": "leaf",
                "paneId": "pane-b1",
                "sessionId": "session-b1",
            },
            "second": {
                "type": "split",
                "splitId": "split-nested",
                "direction": "row",
                "ratio": 0.5,
                "first": {
                    "type": "leaf",
                    "paneId": "pane-a1",
                    "sessionId": "session-a1",
                },
                "second": {
                    "type": "leaf",
                    "paneId": "pane-b2",
                    "sessionId": "session-b2",
                },
            },
        }
        await session_manager.save_project_layout(self.project_a["id"], layout)

        await session_manager.delete_project(self.project_b["id"])
        loaded = await session_manager.get_project_layout(self.project_a["id"])

        self.assertEqual(
            loaded,
            {
                "type": "leaf",
                "paneId": "pane-a1",
                "sessionId": "session-a1",
            },
        )


if __name__ == "__main__":
    unittest.main()
