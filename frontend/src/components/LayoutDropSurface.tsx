import { useRef, type DragEvent, type ReactNode } from "react";
import type { PaneDropZone } from "../utils/layout";

export interface LayoutDropIndicator {
  targetPaneId: string | null;
  zone: PaneDropZone;
  invalid: boolean;
}

interface LayoutDropSurfaceProps {
  paneId: string;
  size: { width: number; height: number };
  dragging: boolean;
  indicator: LayoutDropIndicator | null;
  minPaneWidth: number;
  minPaneHeight: number;
  onIndicatorChange: (indicator: LayoutDropIndicator | null) => void;
  onDropIndicator: (indicator: LayoutDropIndicator) => void;
  children: ReactNode;
}

function getBandSize(length: number): number {
  return Math.max(56, Math.min(96, length * 0.25));
}

function getZone(rect: DOMRect, clientX: number, clientY: number): PaneDropZone {
  const leftBand = getBandSize(rect.width);
  const topBand = getBandSize(rect.height);
  const candidates: Array<{ zone: PaneDropZone; distance: number }> = [];

  const left = clientX - rect.left;
  const right = rect.right - clientX;
  const top = clientY - rect.top;
  const bottom = rect.bottom - clientY;

  if (left <= leftBand) {
    candidates.push({ zone: "left", distance: left / leftBand });
  }
  if (right <= leftBand) {
    candidates.push({ zone: "right", distance: right / leftBand });
  }
  if (top <= topBand) {
    candidates.push({ zone: "top", distance: top / topBand });
  }
  if (bottom <= topBand) {
    candidates.push({ zone: "bottom", distance: bottom / topBand });
  }

  if (candidates.length === 0) {
    return "center";
  }

  candidates.sort((leftCandidate, rightCandidate) => leftCandidate.distance - rightCandidate.distance);
  return candidates[0].zone;
}

function isInvalidZone(
  zone: PaneDropZone,
  size: { width: number; height: number },
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

function zoneClassName(
  zone: PaneDropZone,
  activeZone: PaneDropZone | null,
  activeInvalid: boolean,
  size: { width: number; height: number },
  minPaneWidth: number,
  minPaneHeight: number,
): string {
  const invalid = isInvalidZone(zone, size, minPaneWidth, minPaneHeight);
  const classes = ["pane-drop-overlay__zone", `pane-drop-overlay__zone--${zone}`];
  if (zone === activeZone) {
    classes.push(activeInvalid ? "is-invalid" : "is-active");
  } else if (invalid) {
    classes.push("is-disabled");
  }
  return classes.join(" ");
}

export default function LayoutDropSurface({
  paneId,
  size,
  dragging,
  indicator,
  minPaneWidth,
  minPaneHeight,
  onIndicatorChange,
  onDropIndicator,
  children,
}: LayoutDropSurfaceProps) {
  const activeZone = indicator?.targetPaneId === paneId ? indicator.zone : null;
  const activeInvalid = indicator?.targetPaneId === paneId ? indicator.invalid : false;
  const lastIndicatorRef = useRef<LayoutDropIndicator | null>(null);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const zone = getZone(rect, event.clientX, event.clientY);
    const invalid = isInvalidZone(zone, size, minPaneWidth, minPaneHeight);
    event.dataTransfer.dropEffect = invalid ? "none" : "move";
    const nextIndicator: LayoutDropIndicator = {
      targetPaneId: paneId,
      zone,
      invalid,
    };
    lastIndicatorRef.current = nextIndicator;
    onIndicatorChange(nextIndicator);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    lastIndicatorRef.current = null;
    onIndicatorChange(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextIndicator = (
      indicator?.targetPaneId === paneId
        ? indicator
        : lastIndicatorRef.current?.targetPaneId === paneId
          ? lastIndicatorRef.current
          : null
    ) ?? (() => {
      const rect = event.currentTarget.getBoundingClientRect();
      const zone = getZone(rect, event.clientX, event.clientY);
      const invalid = isInvalidZone(zone, size, minPaneWidth, minPaneHeight);
      return {
        targetPaneId: paneId,
        zone,
        invalid,
      } satisfies LayoutDropIndicator;
    })();

    lastIndicatorRef.current = null;
    onIndicatorChange(null);
    if (!nextIndicator.invalid) {
      onDropIndicator(nextIndicator);
    }
  };

  return (
    <div
      className="pane-drop-surface"
      data-pane-drop-surface={paneId}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="pane-drop-overlay" aria-hidden="true">
          <div data-drop-zone="left" className={zoneClassName("left", activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)} />
          <div data-drop-zone="right" className={zoneClassName("right", activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)} />
          <div data-drop-zone="top" className={zoneClassName("top", activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)} />
          <div data-drop-zone="bottom" className={zoneClassName("bottom", activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)} />
          <div data-drop-zone="center" className={zoneClassName("center", activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)} />
        </div>
      )}
    </div>
  );
}
