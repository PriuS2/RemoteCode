from __future__ import annotations

from typing import Any


LayoutNode = dict[str, Any]


class LayoutValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _clamp_ratio(value: Any) -> float:
    if not isinstance(value, (int, float)):
        return 0.5
    return max(0.1, min(0.9, float(value)))


def sanitize_layout(value: Any) -> LayoutNode | None:
    if value is None:
        return None

    seen_sessions: set[str] = set()
    seen_panes: set[str] = set()
    seen_splits: set[str] = set()

    def _sanitize(node: Any) -> LayoutNode:
        if not isinstance(node, dict):
            raise LayoutValidationError("invalid_layout", "Layout node must be an object.")

        node_type = node.get("type")
        if node_type == "leaf":
            pane_id = node.get("paneId")
            session_id = node.get("sessionId")
            if not isinstance(pane_id, str) or not pane_id.strip():
                raise LayoutValidationError("invalid_layout", "Leaf paneId is required.")
            if not isinstance(session_id, str) or not session_id.strip():
                raise LayoutValidationError("invalid_layout", "Leaf sessionId is required.")
            if pane_id in seen_panes:
                raise LayoutValidationError("invalid_layout", f"Duplicate paneId: {pane_id}")
            if session_id in seen_sessions:
                raise LayoutValidationError("invalid_layout", f"Duplicate sessionId: {session_id}")
            seen_panes.add(pane_id)
            seen_sessions.add(session_id)
            return {
                "type": "leaf",
                "paneId": pane_id,
                "sessionId": session_id,
            }

        if node_type == "split":
            split_id = node.get("splitId")
            direction = node.get("direction")
            if not isinstance(split_id, str) or not split_id.strip():
                raise LayoutValidationError("invalid_layout", "Split splitId is required.")
            if split_id in seen_splits:
                raise LayoutValidationError("invalid_layout", f"Duplicate splitId: {split_id}")
            if direction not in {"row", "column"}:
                raise LayoutValidationError("invalid_layout", "Split direction must be 'row' or 'column'.")
            seen_splits.add(split_id)
            return {
                "type": "split",
                "splitId": split_id,
                "direction": direction,
                "ratio": _clamp_ratio(node.get("ratio")),
                "first": _sanitize(node.get("first")),
                "second": _sanitize(node.get("second")),
            }

        raise LayoutValidationError("invalid_layout", "Unknown layout node type.")

    return _sanitize(value)


def collect_session_ids(layout: LayoutNode | None) -> list[str]:
    if not layout:
        return []
    if layout.get("type") == "leaf":
        session_id = layout.get("sessionId")
        return [session_id] if isinstance(session_id, str) and session_id else []
    return collect_session_ids(layout.get("first")) + collect_session_ids(layout.get("second"))


def prune_sessions(layout: LayoutNode | None, removed_session_ids: set[str]) -> LayoutNode | None:
    if not layout:
        return None

    if layout.get("type") == "leaf":
        session_id = layout.get("sessionId")
        if isinstance(session_id, str) and session_id in removed_session_ids:
            return None
        return layout

    first = prune_sessions(layout.get("first"), removed_session_ids)
    second = prune_sessions(layout.get("second"), removed_session_ids)

    if not first and not second:
        return None
    if not first:
        return second
    if not second:
        return first

    if first == layout.get("first") and second == layout.get("second"):
        return layout

    return {
        "type": "split",
        "splitId": layout.get("splitId"),
        "direction": layout.get("direction"),
        "ratio": _clamp_ratio(layout.get("ratio")),
        "first": first,
        "second": second,
    }
