import { describe, expect, it } from "vitest";
import {
  collectSessionIds,
  createSingleLayout,
  placeSessionInPane,
  restoreLayout,
  updateSplitRatio,
} from "./layout";

describe("layout utils", () => {
  it("places a session to the left of an existing pane", () => {
    const root = createSingleLayout("session-a", "pane-a");
    const next = placeSessionInPane(root, "session-b", "pane-a", "left");

    expect(next).toEqual({
      type: "split",
      splitId: expect.any(String),
      direction: "row",
      ratio: 0.5,
      first: {
        type: "leaf",
        paneId: expect.any(String),
        sessionId: "session-b",
      },
      second: {
        type: "leaf",
        paneId: "pane-a",
        sessionId: "session-a",
      },
    });
  });

  it("replaces the target pane when dropped in the center", () => {
    const root = createSingleLayout("session-a", "pane-a");
    const next = placeSessionInPane(root, "session-b", "pane-a", "center");

    expect(next).toEqual({
      type: "leaf",
      paneId: "pane-a",
      sessionId: "session-b",
    });
  });

  it("dedupes a session already open in another pane", () => {
    const root = placeSessionInPane(createSingleLayout("session-a", "pane-a"), "session-b", "pane-a", "right");
    const moved = placeSessionInPane(root, "session-a", "pane-a", "bottom");

    const sessionIds = collectSessionIds(moved);
    expect(sessionIds.sort()).toEqual(["session-a", "session-b"]);
    expect(sessionIds.filter((sessionId) => sessionId === "session-a")).toHaveLength(1);
  });

  it("clamps updated split ratios", () => {
    const root = placeSessionInPane(createSingleLayout("session-a", "pane-a"), "session-b", "pane-a", "right");
    if (!root || root.type !== "split") {
      throw new Error("expected split layout");
    }

    const next = updateSplitRatio(root, root.splitId, 2);
    expect(next && next.type === "split" ? next.ratio : null).toBe(0.9);
  });

  it("rejects invalid serialized layouts", () => {
    const restored = restoreLayout({
      type: "split",
      splitId: "split-root",
      direction: "row",
      ratio: 0.5,
      first: {
        type: "leaf",
        paneId: "pane-a",
        sessionId: "session-a",
      },
      second: {
        type: "leaf",
        paneId: "pane-a",
        sessionId: "session-b",
      },
    });

    expect(restored).toBeNull();
  });
});
