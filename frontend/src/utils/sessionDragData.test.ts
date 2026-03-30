import { describe, expect, it } from "vitest";
import {
  getSessionDragData,
  hasSessionDragData,
  SESSION_DRAG_MIME,
  setSessionDragData,
} from "./sessionDragData";

function createDataTransferMock() {
  const store = new Map<string, string>();
  return {
    get types() {
      return Array.from(store.keys());
    },
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
  } as unknown as DataTransfer;
}

describe("sessionDragData", () => {
  it("stores and reads the custom session drag payload", () => {
    const dataTransfer = createDataTransferMock();

    setSessionDragData(dataTransfer, "session-123");

    expect(dataTransfer.getData(SESSION_DRAG_MIME)).toBe("session-123");
    expect(hasSessionDragData(dataTransfer)).toBe(true);
    expect(getSessionDragData(dataTransfer)).toBe("session-123");
  });

  it("ignores plain text drags without the custom session type", () => {
    const dataTransfer = createDataTransferMock();
    dataTransfer.setData("text/plain", "session-123");

    expect(hasSessionDragData(dataTransfer)).toBe(false);
    expect(getSessionDragData(dataTransfer)).toBeNull();
  });
});
