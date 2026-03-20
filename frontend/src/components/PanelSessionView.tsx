import { useState } from "react";

interface PanelSessionViewProps {
  visible?: boolean;
  panelIndex: number;
  splitMode: boolean;
  splitRatio?: number;
  isFocused: boolean;
  onFocus: () => void;
  sessionName: string;
  workPath: string;
  panelLabel: string;
  onClosePanel: () => void;
  onMaximize?: () => void;
  renderContent: (refreshKey: number) => React.ReactNode;
}

export default function PanelSessionView({
  visible = true,
  panelIndex,
  splitMode,
  splitRatio = 0.5,
  isFocused,
  onFocus,
  sessionName,
  workPath,
  panelLabel,
  onClosePanel,
  onMaximize,
  renderContent,
}: PanelSessionViewProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const positionStyle: React.CSSProperties = splitMode
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: panelIndex === 0 ? `${splitRatio * 100}%` : `${(1 - splitRatio) * 100}%`,
        left: panelIndex === 0 ? 0 : `${splitRatio * 100}%`,
        borderLeft: panelIndex === 1 ? "1px solid var(--border-subtle)" : undefined,
      }
    : {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      };

  return (
    <div
      className="terminal-panel"
      style={{
        ...positionStyle,
        display: visible ? "flex" : "none",
        flexDirection: "column",
      }}
      onMouseDown={onFocus}
    >
      <div
        className={`terminal-toolbar${isFocused ? " is-focused" : ""}`}
        style={{ minHeight: 50, padding: "8px 12px" }}
      >
        <div className="terminal-toolbar__meta">
          <span className="terminal-toolbar__eyebrow">
            {splitMode ? `Split ${panelIndex + 1}` : panelLabel}
          </span>
          <div className="terminal-toolbar__title-row">
            <span className="terminal-toolbar__title">{sessionName}</span>
          </div>
          <span className="terminal-toolbar__path" title={workPath}>
            {workPath || "No work path"}
          </span>
        </div>
        <div className="terminal-toolbar__actions">
          <ToolbarButton
            title="Refresh"
            hoverColor="var(--info)"
            onClick={(event) => {
              event.stopPropagation();
              setRefreshKey((value) => value + 1);
            }}
          >
            <RefreshIcon />
          </ToolbarButton>
          {splitMode && onMaximize && (
            <ToolbarButton
              title="Maximize"
              hoverColor="var(--accent)"
              onClick={(event) => {
                event.stopPropagation();
                onMaximize();
              }}
            >
              <MaximizeIcon />
            </ToolbarButton>
          )}
          <ToolbarButton
            title="Close Panel"
            hoverColor="var(--danger)"
            onClick={(event) => {
              event.stopPropagation();
              onClosePanel();
            }}
          >
            <CloseIcon />
          </ToolbarButton>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {renderContent(refreshKey)}
      </div>
    </div>
  );
}

function ToolbarButton({
  title,
  hoverColor,
  onClick,
  children,
}: {
  title: string;
  hoverColor: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="terminal-tool-button"
      title={title}
      onClick={onClick}
      onMouseEnter={(event) => {
        const button = event.currentTarget;
        button.style.color = hoverColor;
        button.style.background = `${hoverColor}18`;
      }}
      onMouseLeave={(event) => {
        const button = event.currentTarget;
        button.style.color = "var(--text-muted)";
        button.style.background = "none";
      }}
      style={{ lineHeight: 1 }}
    >
      {children}
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 2v3h3" />
      <path d="M2.1 7.5a4 4 0 1 0 .6-4.2L1.5 5" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}
