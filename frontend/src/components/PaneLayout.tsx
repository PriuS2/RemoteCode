import { useEffect, useRef, useState } from "react";
import type { LayoutNode, LayoutSplitNode } from "../utils/layout";

interface PaneLayoutProps {
  node: LayoutNode;
  focusedPaneId: string | null;
  minPaneWidth: number;
  minPaneHeight: number;
  onFocusPane: (paneId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onResizeEnd?: () => void;
  renderLeaf: (paneId: string, sessionId: string, size: { width: number; height: number }) => React.ReactNode;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return 0.5;
  return Math.max(min, Math.min(max, value));
}

function LeafPane({
  paneId,
  sessionId,
  isFocused,
  onFocusPane,
  renderLeaf,
}: {
  paneId: string;
  sessionId: string;
  isFocused: boolean;
  onFocusPane: (paneId: string) => void;
  renderLeaf: (paneId: string, sessionId: string, size: { width: number; height: number }) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`pane-layout__leaf${isFocused ? " is-focused" : ""}`}
      data-layout-node="leaf"
      data-pane-id={paneId}
      data-session-id={sessionId}
      onMouseDown={() => onFocusPane(paneId)}
    >
      {renderLeaf(paneId, sessionId, size)}
    </div>
  );
}

function SplitPane({
  node,
  focusedPaneId,
  minPaneWidth,
  minPaneHeight,
  onFocusPane,
  onResizeSplit,
  onResizeEnd,
  renderLeaf,
}: Omit<PaneLayoutProps, "node"> & { node: LayoutSplitNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isRow = node.direction === "row";

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    const element = containerRef.current;
    if (!element) return;

    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const rect = element.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    const minFirstRatio = isRow ? minPaneWidth / total : minPaneHeight / total;
    const minSecondRatio = isRow ? minPaneWidth / total : minPaneHeight / total;
    const minRatio = Math.min(0.5, minFirstRatio);
    const maxRatio = Math.max(0.5, 1 - minSecondRatio);

    const onMove = (moveEvent: MouseEvent) => {
      const offset = isRow ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top;
      const nextRatio = clamp(offset / total, minRatio, maxRatio);
      onResizeSplit(node.splitId, nextRatio);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.dispatchEvent(new Event("panel-resize-end"));
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`pane-layout__split pane-layout__split--${node.direction}`}
      data-layout-node="split"
      data-split-id={node.splitId}
    >
      <div
        className="pane-layout__branch"
        style={{ flexBasis: `${node.ratio * 100}%`, flexGrow: node.ratio, flexShrink: 1 }}
      >
        <PaneLayout
          node={node.first}
          focusedPaneId={focusedPaneId}
          minPaneWidth={minPaneWidth}
          minPaneHeight={minPaneHeight}
          onFocusPane={onFocusPane}
          onResizeSplit={onResizeSplit}
          onResizeEnd={onResizeEnd}
          renderLeaf={renderLeaf}
        />
      </div>
      <div
        className={`pane-layout__divider pane-layout__divider--${node.direction}`}
        data-testid={`pane-divider-${node.splitId}`}
        onMouseDown={handleResizeStart}
      >
        <div className="pane-layout__divider-handle" />
      </div>
      <div
        className="pane-layout__branch"
        style={{ flexBasis: `${(1 - node.ratio) * 100}%`, flexGrow: 1 - node.ratio, flexShrink: 1 }}
      >
        <PaneLayout
          node={node.second}
          focusedPaneId={focusedPaneId}
          minPaneWidth={minPaneWidth}
          minPaneHeight={minPaneHeight}
          onFocusPane={onFocusPane}
          onResizeSplit={onResizeSplit}
          onResizeEnd={onResizeEnd}
          renderLeaf={renderLeaf}
        />
      </div>
    </div>
  );
}

export default function PaneLayout(props: PaneLayoutProps) {
  const { node, focusedPaneId, onFocusPane, renderLeaf } = props;

  if (node.type === "leaf") {
    return (
      <LeafPane
        paneId={node.paneId}
        sessionId={node.sessionId}
        isFocused={node.paneId === focusedPaneId}
        onFocusPane={onFocusPane}
        renderLeaf={renderLeaf}
      />
    );
  }

  return (
    <SplitPane
      {...props}
      node={node}
      focusedPaneId={focusedPaneId}
      onFocusPane={onFocusPane}
      renderLeaf={renderLeaf}
    />
  );
}
