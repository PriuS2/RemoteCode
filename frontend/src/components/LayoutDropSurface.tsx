import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { PaneDropZone } from "../utils/layout";
import {
  DROP_ZONE_RENDER_ORDER,
  getDropZoneAtPoint,
  getDropZoneGeometry,
  isDropZoneInvalid,
  type DropZoneRect,
} from "../utils/layoutDropGeometry";
import { getSessionDragData, hasSessionDragData } from "../utils/sessionDragData";

export interface LayoutDropIndicator {
  targetPaneId: string | null;
  zone: PaneDropZone;
  invalid: boolean;
}

interface LayoutDropSurfaceProps {
  paneId: string;
  size: { width: number; height: number };
  dragging: boolean;
  draggedSessionId: string | null;
  indicator: LayoutDropIndicator | null;
  minPaneWidth: number;
  minPaneHeight: number;
  onIndicatorChange: (indicator: LayoutDropIndicator | null) => void;
  onDropIndicator: (sessionId: string, indicator: LayoutDropIndicator) => void;
  children: ReactNode;
}

function zoneClassName(
  zone: PaneDropZone,
  activeZone: PaneDropZone | null,
  activeInvalid: boolean,
  size: { width: number; height: number },
  minPaneWidth: number,
  minPaneHeight: number,
): string {
  const invalid = isDropZoneInvalid(zone, size, minPaneWidth, minPaneHeight);
  const classes = ["pane-drop-overlay__zone", `pane-drop-overlay__zone--${zone}`];
  if (zone === activeZone) {
    classes.push(activeInvalid ? "is-invalid" : "is-active");
  } else if (invalid) {
    classes.push("is-disabled");
  }
  return classes.join(" ");
}

function zoneStyle(rect: DropZoneRect): CSSProperties {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function getIndicatorAtPoint(
  paneId: string,
  size: { width: number; height: number },
  minPaneWidth: number,
  minPaneHeight: number,
  point: { x: number; y: number },
): LayoutDropIndicator | null {
  const zone = getDropZoneAtPoint(point, size);
  if (!zone) {
    return null;
  }
  return {
    targetPaneId: paneId,
    zone,
    invalid: isDropZoneInvalid(zone, size, minPaneWidth, minPaneHeight),
  };
}

export default function LayoutDropSurface({
  paneId,
  size,
  dragging,
  draggedSessionId,
  indicator,
  minPaneWidth,
  minPaneHeight,
  onIndicatorChange,
  onDropIndicator,
  children,
}: LayoutDropSurfaceProps) {
  const activeZone = indicator?.targetPaneId === paneId ? indicator.zone : null;
  const activeInvalid = indicator?.targetPaneId === paneId ? indicator.invalid : false;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastIndicatorRef = useRef<LayoutDropIndicator | null>(null);
  const geometry = useMemo(
    () => getDropZoneGeometry(size),
    [size.height, size.width],
  );

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }

    const handleDragOver = (event: DragEvent) => {
      if (!hasSessionDragData(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const nextIndicator = getIndicatorAtPoint(
        paneId,
        size,
        minPaneWidth,
        minPaneHeight,
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
      );
      if (!nextIndicator) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "none";
        }
        lastIndicatorRef.current = null;
        onIndicatorChange(null);
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = nextIndicator.invalid ? "none" : "move";
      }
      lastIndicatorRef.current = nextIndicator;
      onIndicatorChange(nextIndicator);
    };

    const handleDragLeave = (event: DragEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && element.contains(nextTarget)) {
        return;
      }
      lastIndicatorRef.current = null;
      onIndicatorChange(null);
    };

    const handleDrop = (event: DragEvent) => {
      const sessionId = getSessionDragData(event.dataTransfer) ?? draggedSessionId;
      if (!sessionId) {
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
        const rect = element.getBoundingClientRect();
        return getIndicatorAtPoint(
          paneId,
          size,
          minPaneWidth,
          minPaneHeight,
          {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          },
        );
      })();

      lastIndicatorRef.current = null;
      onIndicatorChange(null);
      if (nextIndicator && !nextIndicator.invalid) {
        onDropIndicator(sessionId, nextIndicator);
      }
    };

    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("dragleave", handleDragLeave);
    element.addEventListener("drop", handleDrop);

    return () => {
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("dragleave", handleDragLeave);
      element.removeEventListener("drop", handleDrop);
    };
  }, [
    draggedSessionId,
    indicator,
    minPaneHeight,
    minPaneWidth,
    onDropIndicator,
    onIndicatorChange,
    paneId,
    size,
  ]);

  return (
    <div
      ref={surfaceRef}
      className="pane-drop-surface"
      data-pane-drop-surface={paneId}
    >
      {children}
      {dragging && (
        <div className="pane-drop-overlay" aria-hidden="true">
          {DROP_ZONE_RENDER_ORDER.map((zone) => (
            <div
              key={zone}
              data-drop-zone={zone}
              className={zoneClassName(zone, activeZone, activeInvalid, size, minPaneWidth, minPaneHeight)}
              style={zoneStyle(geometry[zone])}
            />
          ))}
        </div>
      )}
    </div>
  );
}
