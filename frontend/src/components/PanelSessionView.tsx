import { useState } from "react";

interface PanelSessionViewProps {
  isFocused: boolean;
  onFocus: () => void;
  sessionName: string;
  workPath: string;
  paneLabel?: string;
  onClosePanel: () => void;
  canClosePanel?: boolean;
  onMaximize?: () => void;
  showRestoreLayout?: boolean;
  onRestoreLayout?: () => void;
  renderContent: (refreshKey: number) => React.ReactNode;
}

export default function PanelSessionView({
  isFocused,
  onFocus,
  sessionName,
  workPath,
  paneLabel = "Panel",
  onClosePanel,
  canClosePanel = true,
  onMaximize,
  showRestoreLayout = false,
  onRestoreLayout,
  renderContent,
}: PanelSessionViewProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const toolbarTitle = workPath ? `${sessionName} | ${paneLabel} | ${workPath}` : `${sessionName} | ${paneLabel}`;

  return (
    <div
      className="terminal-panel"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
      onMouseDown={onFocus}
    >
      <div
        className={`terminal-toolbar${isFocused ? " is-focused" : ""}`}
        style={{ minHeight: 36, padding: "4px 10px" }}
        title={toolbarTitle}
      >
        <div className="terminal-toolbar__meta">
          <span className="terminal-toolbar__title">{sessionName}</span>
          <span className="terminal-toolbar__separator" aria-hidden="true">|</span>
          <span className="terminal-toolbar__chip">{paneLabel}</span>
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
          {showRestoreLayout && onRestoreLayout ? (
            <ToolbarButton
              title="Restore Layout"
              hoverColor="var(--accent)"
              onClick={(event) => {
                event.stopPropagation();
                onRestoreLayout();
              }}
            >
              <RestoreLayoutIcon />
            </ToolbarButton>
          ) : onMaximize && (
            <ToolbarButton
              title="Open Alone"
              hoverColor="var(--accent)"
              onClick={(event) => {
                event.stopPropagation();
                onMaximize();
              }}
            >
              <MaximizeIcon />
            </ToolbarButton>
          )}
          {canClosePanel && (
            <ToolbarButton
              title="Close Pane"
              hoverColor="var(--danger)"
              onClick={(event) => {
                event.stopPropagation();
                onClosePanel();
              }}
            >
              <CloseIcon />
            </ToolbarButton>
          )}
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
      aria-label={title}
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

function RestoreLayoutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5V2.5h6v6h-2" />
      <rect x="2" y="4" width="6" height="5" rx="0.6" />
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
