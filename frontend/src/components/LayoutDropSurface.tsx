import { useMemo, useRef, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { PaneDropZone } from "../utils/layout";
import {
  DROP_ZONE_RENDER_ORDER,
  getDropZoneAtPoint,
  getDropZoneGeometry,
  isDropZoneInvalid,
  type DropZoneRect,
} from "../utils/layoutDropGeometry";

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
  const geometry = useMemo(
    () => getDropZoneGeometry(size),
    [size.height, size.width],
  );

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const zone = getDropZoneAtPoint(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      { width: rect.width, height: rect.height },
    );
    if (!zone) {
      event.dataTransfer.dropEffect = "none";
      lastIndicatorRef.current = null;
      onIndicatorChange(null);
      return;
    }
    const invalid = isDropZoneInvalid(zone, size, minPaneWidth, minPaneHeight);
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
      const zone = getDropZoneAtPoint(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        { width: rect.width, height: rect.height },
      );
      if (!zone) {
        return null;
      }
      const invalid = isDropZoneInvalid(zone, size, minPaneWidth, minPaneHeight);
      return {
        targetPaneId: paneId,
        zone,
        invalid,
      } satisfies LayoutDropIndicator;
    })();

    lastIndicatorRef.current = null;
    onIndicatorChange(null);
    if (nextIndicator && !nextIndicator.invalid) {
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
