import { describe, expect, it } from "vitest";
import {
  getDropZoneAtPoint,
  getDropZoneGeometry,
  isDropZoneInvalid,
} from "./layoutDropGeometry";

describe("layoutDropGeometry", () => {
  it("builds exclusive rects from a shared geometry model", () => {
    const geometry = getDropZoneGeometry({ width: 400, height: 300 });

    expect(geometry.left.left).toBe(10);
    expect(geometry.left.top).toBe(10);
    expect(geometry.top.left).toBeCloseTo(geometry.left.left + geometry.left.width, 5);
    expect(geometry.center.left).toBeCloseTo(geometry.top.left, 5);
    expect(geometry.center.top).toBeCloseTo(geometry.top.top + geometry.top.height, 5);
    expect(geometry.top.width).toBeCloseTo(geometry.center.width, 5);
    expect(geometry.center.width).toBeLessThan(geometry.left.width + geometry.center.width);
  });

  it("recognizes points inside each visible drop zone", () => {
    const size = { width: 480, height: 320 };
    const geometry = getDropZoneGeometry(size);

    expect(getDropZoneAtPoint({
      x: geometry.left.left + geometry.left.width - 1,
      y: geometry.left.top + geometry.left.height / 2,
    }, size)).toBe("left");

    expect(getDropZoneAtPoint({
      x: geometry.right.left + 1,
      y: geometry.right.top + geometry.right.height / 2,
    }, size)).toBe("right");

    expect(getDropZoneAtPoint({
      x: geometry.top.left + geometry.top.width / 2,
      y: geometry.top.top + geometry.top.height - 1,
    }, size)).toBe("top");

    expect(getDropZoneAtPoint({
      x: geometry.bottom.left + geometry.bottom.width / 2,
      y: geometry.bottom.top + 1,
    }, size)).toBe("bottom");

    expect(getDropZoneAtPoint({
      x: geometry.center.left + geometry.center.width / 2,
      y: geometry.center.top + geometry.center.height / 2,
    }, size)).toBe("center");
  });

  it("switches to center immediately outside the visible left and top zones", () => {
    const size = { width: 480, height: 320 };
    const geometry = getDropZoneGeometry(size);

    expect(getDropZoneAtPoint({
      x: geometry.left.left + geometry.left.width + 1,
      y: geometry.center.top + geometry.center.height / 2,
    }, size)).toBe("center");

    expect(getDropZoneAtPoint({
      x: geometry.center.left + geometry.center.width / 2,
      y: geometry.top.top + geometry.top.height + 1,
    }, size)).toBe("center");
  });

  it("does not overlap the corner between left and top zones", () => {
    const size = { width: 480, height: 320 };
    const geometry = getDropZoneGeometry(size);

    expect(getDropZoneAtPoint({
      x: geometry.left.left + 1,
      y: geometry.left.top + 1,
    }, size)).toBe("left");

    expect(getDropZoneAtPoint({
      x: geometry.top.left + 1,
      y: geometry.top.top + 1,
    }, size)).toBe("top");
  });

  it("keeps invalid display rules aligned with drop rules", () => {
    expect(isDropZoneInvalid("left", { width: 400, height: 500 }, 260, 180)).toBe(true);
    expect(isDropZoneInvalid("top", { width: 700, height: 300 }, 260, 180)).toBe(true);
    expect(isDropZoneInvalid("center", { width: 200, height: 120 }, 260, 180)).toBe(false);
  });
});
