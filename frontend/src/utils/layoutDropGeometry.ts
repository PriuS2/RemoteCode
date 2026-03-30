import type { PaneDropZone } from "./layout";

export interface DropZoneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DropZoneSize {
  width: number;
  height: number;
}

export interface DropZonePoint {
  x: number;
  y: number;
}

export interface DropZoneGeometryOptions {
  insetPx?: number;
  bandRatio?: number;
  minBandPx?: number;
}

export const DROP_ZONE_RENDER_ORDER: PaneDropZone[] = ["left", "right", "top", "bottom", "center"];
export const DEFAULT_DROP_ZONE_INSET_PX = 10;
export const DEFAULT_DROP_ZONE_BAND_RATIO = 0.23;
export const DEFAULT_DROP_ZONE_MIN_BAND_PX = 56;

function normalizeLength(length: number): number {
  return Number.isFinite(length) ? Math.max(0, length) : 0;
}

function clampBandSize(length: number, bandSize: number): number {
  return Math.max(0, Math.min(bandSize, length / 2));
}

export function getDropZoneGeometry(
  size: DropZoneSize,
  options: DropZoneGeometryOptions = {},
): Record<PaneDropZone, DropZoneRect> {
  const width = normalizeLength(size.width);
  const height = normalizeLength(size.height);
  const insetPx = options.insetPx ?? DEFAULT_DROP_ZONE_INSET_PX;
  const bandRatio = options.bandRatio ?? DEFAULT_DROP_ZONE_BAND_RATIO;
  const minBandPx = options.minBandPx ?? DEFAULT_DROP_ZONE_MIN_BAND_PX;

  const innerWidth = Math.max(0, width - insetPx * 2);
  const innerHeight = Math.max(0, height - insetPx * 2);
  const sideBandWidth = clampBandSize(innerWidth, Math.max(minBandPx, innerWidth * bandRatio));
  const topBandHeight = clampBandSize(innerHeight, Math.max(minBandPx, innerHeight * bandRatio));
  const middleWidth = Math.max(0, innerWidth - sideBandWidth * 2);
  const middleHeight = Math.max(0, innerHeight - topBandHeight * 2);

  return {
    left: {
      left: insetPx,
      top: insetPx,
      width: sideBandWidth,
      height: innerHeight,
    },
    right: {
      left: insetPx + innerWidth - sideBandWidth,
      top: insetPx,
      width: sideBandWidth,
      height: innerHeight,
    },
    top: {
      left: insetPx + sideBandWidth,
      top: insetPx,
      width: middleWidth,
      height: topBandHeight,
    },
    bottom: {
      left: insetPx + sideBandWidth,
      top: insetPx + innerHeight - topBandHeight,
      width: middleWidth,
      height: topBandHeight,
    },
    center: {
      left: insetPx + sideBandWidth,
      top: insetPx + topBandHeight,
      width: middleWidth,
      height: middleHeight,
    },
  };
}

export function pointInDropZoneRect(point: DropZonePoint, rect: DropZoneRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  return (
    point.x >= rect.left
    && point.x < rect.left + rect.width
    && point.y >= rect.top
    && point.y < rect.top + rect.height
  );
}

export function getDropZoneAtPoint(
  point: DropZonePoint,
  size: DropZoneSize,
  options: DropZoneGeometryOptions = {},
): PaneDropZone | null {
  const geometry = getDropZoneGeometry(size, options);
  for (const zone of DROP_ZONE_RENDER_ORDER) {
    if (pointInDropZoneRect(point, geometry[zone])) {
      return zone;
    }
  }
  return null;
}

export function isDropZoneInvalid(
  zone: PaneDropZone,
  size: DropZoneSize,
  minPaneWidth: number,
  minPaneHeight: number,
): boolean {
  if (zone === "left" || zone === "right") {
    return size.width < minPaneWidth * 2;
  }
  if (zone === "top" || zone === "bottom") {
    return size.height < minPaneHeight * 2;
  }
  return false;
}
