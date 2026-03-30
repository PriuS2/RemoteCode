import unittest

from backend.project_layouts import LayoutValidationError, prune_sessions, sanitize_layout


def sample_split_layout() -> dict:
    return {
        "type": "split",
        "splitId": "split-root",
        "direction": "row",
        "ratio": 0.5,
        "first": {
            "type": "leaf",
            "paneId": "pane-left",
            "sessionId": "session-left",
        },
        "second": {
            "type": "leaf",
            "paneId": "pane-right",
            "sessionId": "session-right",
        },
    }


class ProjectLayoutTests(unittest.TestCase):
    def test_sanitize_layout_accepts_valid_tree(self) -> None:
        layout = sanitize_layout(sample_split_layout())
        self.assertEqual(layout, sample_split_layout())

    def test_sanitize_layout_rejects_duplicate_session_ids(self) -> None:
        layout = sample_split_layout()
        layout["second"]["sessionId"] = "session-left"

        with self.assertRaises(LayoutValidationError) as cm:
            sanitize_layout(layout)

        self.assertEqual(cm.exception.code, "invalid_layout")
        self.assertIn("Duplicate sessionId", cm.exception.message)

    def test_sanitize_layout_rejects_duplicate_pane_ids(self) -> None:
        layout = sample_split_layout()
        layout["second"]["paneId"] = "pane-left"

        with self.assertRaises(LayoutValidationError) as cm:
            sanitize_layout(layout)

        self.assertEqual(cm.exception.code, "invalid_layout")
        self.assertIn("Duplicate paneId", cm.exception.message)

    def test_sanitize_layout_rejects_duplicate_split_ids(self) -> None:
        layout = {
            "type": "split",
            "splitId": "split-root",
            "direction": "column",
            "ratio": 0.5,
            "first": sample_split_layout(),
            "second": {
                "type": "leaf",
                "paneId": "pane-bottom",
                "sessionId": "session-bottom",
            },
        }
        layout["first"]["splitId"] = "split-root"

        with self.assertRaises(LayoutValidationError) as cm:
            sanitize_layout(layout)

        self.assertEqual(cm.exception.code, "invalid_layout")
        self.assertIn("Duplicate splitId", cm.exception.message)

    def test_prune_sessions_collapses_single_child_splits(self) -> None:
        pruned = prune_sessions(sample_split_layout(), {"session-right"})
        self.assertEqual(
            pruned,
            {
                "type": "leaf",
                "paneId": "pane-left",
                "sessionId": "session-left",
            },
        )

    def test_prune_sessions_removes_entire_layout_when_all_sessions_deleted(self) -> None:
        pruned = prune_sessions(sample_split_layout(), {"session-left", "session-right"})
        self.assertIsNone(pruned)


if __name__ == "__main__":
    unittest.main()
