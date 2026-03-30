interface SessionStatePaneProps {
  isFocused: boolean;
  onFocus: () => void;
  paneLabel: string;
  sessionName: string;
  workPath: string;
  sourceBadge?: string | null;
  title: string;
  body: string;
  tone?: "info" | "warn" | "danger";
  pending?: boolean;
  onPaneDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  paneDragDisabled?: boolean;
  onClosePanel: () => void;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }>;
}

export default function SessionStatePane({
  isFocused,
  onFocus,
  paneLabel,
  sessionName,
  workPath,
  sourceBadge,
  title,
  body,
  tone = "info",
  pending = false,
  onPaneDragStart,
  paneDragDisabled = false,
  onClosePanel,
  actions = [],
}: SessionStatePaneProps) {
  return (
    <div className="terminal-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }} onMouseDown={onFocus}>
      <div className={`terminal-toolbar${isFocused ? " is-focused" : ""}`} style={{ minHeight: 50, padding: "8px 12px" }}>
        <div className="terminal-toolbar__meta">
          <div className="terminal-toolbar__eyebrow-row">
            <span className="terminal-toolbar__eyebrow">{paneLabel}</span>
            {sourceBadge && <span className="terminal-toolbar__chip">{sourceBadge}</span>}
          </div>
          <div className="terminal-toolbar__title-row">
            <span className="terminal-toolbar__title">{sessionName}</span>
          </div>
          <span className="terminal-toolbar__path" title={workPath}>
            {workPath || "No work path"}
          </span>
        </div>
        <div className="terminal-toolbar__actions">
          {onPaneDragStart && (
            <button
              className="terminal-tool-button terminal-tool-button--drag"
              title="Move pane"
              draggable={!paneDragDisabled}
              onDragStart={onPaneDragStart}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <GripIcon />
            </button>
          )}
          <button
            className="terminal-tool-button"
            title="Close Pane"
            onClick={(event) => {
              event.stopPropagation();
              onClosePanel();
            }}
          >
            <ClosePaneIcon />
          </button>
        </div>
      </div>
      <div className={`pane-state pane-state--${tone}`}>
        <div className="pane-state__card">
          <div className="pane-state__title-row">
            <strong>{title}</strong>
            {pending && <span className="pane-state__spinner" aria-hidden="true" />}
          </div>
          <p>{body}</p>
          {actions.length > 0 && (
            <div className="pane-state__actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  className={action.primary ? "primary-button" : action.danger ? "ghost-button ghost-button--danger" : "ghost-button"}
                  onClick={(event) => {
                    event.stopPropagation();
                    action.onClick();
                  }}
                  disabled={action.disabled}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="4" y1="3" x2="4" y2="9" />
      <line x1="6" y1="3" x2="6" y2="9" />
      <line x1="8" y1="3" x2="8" y2="9" />
    </svg>
  );
}

function ClosePaneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}
