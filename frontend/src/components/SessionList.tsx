import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { ActivityState } from "./Terminal";

interface Session {
  id: string;
  name: string;
  work_path: string;
  status: string;
  created_at: string;
  last_accessed_at: string;
  claude_session_id: string | null;
}

interface SessionListProps {
  sessions: Session[];
  activeSessions: string[];
  focusedSessionId: string | null;
  sessionActivity: Record<string, ActivityState>;
  onSelect: (id: string, split?: boolean) => void;
  onResume: (id: string) => void;
  onNewSession: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onSuspend: (id: string) => void;
  onTerminate: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#a6e3a1",
  suspended: "#f9e2af",
  closed: "#6c7086",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

const Spinner = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    style={{ animation: "ccr-spin 1s linear infinite", flexShrink: 0 }}
  >
    <circle
      cx="7"
      cy="7"
      r="5.5"
      fill="none"
      stroke="#89b4fa"
      strokeWidth="2"
      strokeDasharray="20 12"
      strokeLinecap="round"
    />
    <style>{`@keyframes ccr-spin { to { transform: rotate(360deg); } }`}</style>
  </svg>
);

const DoneBadge = () => (
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "#a6e3a1",
      boxShadow: "0 0 6px #a6e3a1",
      flexShrink: 0,
      animation: "ccr-pulse 1.5s ease-in-out infinite",
    }}
  >
    <style>{`@keyframes ccr-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
  </span>
);

/* ── Context Menu ── */

interface ContextMenuProps {
  x: number;
  y: number;
  session: Session;
  onOpen: () => void;
  onRename: () => void;
  onSuspend: () => void;
  onTerminate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, session, onOpen, onRename, onSuspend, onTerminate, onDelete, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Viewport boundary check
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x, ny = y;
    if (x + rect.width > window.innerWidth - 4) nx = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight - 4) ny = window.innerHeight - rect.height - 4;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  // Close handlers
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleDismiss = () => onClose();

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    padding: "7px 16px",
    cursor: "pointer",
    fontSize: "var(--web-fs-sm)",
    color: "#cdd6f4",
    whiteSpace: "nowrap",
  };

  const hoverBg = "#45475a";

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        background: "#1e1e2e",
        border: "1px solid #45475a",
        borderRadius: 8,
        padding: "4px 0",
        minWidth: 160,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header: session name */}
      <div style={{
        padding: "6px 16px 4px",
        fontSize: "var(--web-fs-xs)",
        color: "#6c7086",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderBottom: "1px solid #313244",
        marginBottom: 4,
      }}>
        {session.name}
      </div>

      {/* Open */}
      <div
        style={itemStyle}
        onClick={onOpen}
        onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        Open
      </div>

      {/* Rename */}
      <div
        style={itemStyle}
        onClick={onRename}
        onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        Rename
      </div>

      {/* Suspend — only for active sessions */}
      {session.status === "active" && (
        <div
          style={{ ...itemStyle, color: "#f9e2af" }}
          onClick={onSuspend}
          onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Suspend
        </div>
      )}

      {/* Kill — only for active sessions */}
      {session.status === "active" && (
        <div
          style={{ ...itemStyle, color: "#fab387" }}
          onClick={onTerminate}
          onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Kill
        </div>
      )}

      {/* Separator */}
      <div style={{ height: 1, background: "#313244", margin: "4px 0" }} />

      {/* Delete */}
      <div
        style={{ ...itemStyle, color: "#f38ba8" }}
        onClick={onDelete}
        onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        Delete
      </div>
    </div>,
    document.body,
  );
}

/* ── SessionList ── */

export default function SessionList({
  sessions,
  activeSessions,
  focusedSessionId,
  sessionActivity,
  onSelect,
  onResume,
  onNewSession,
  onDelete,
  onRename,
  onSuspend,
  onTerminate,
}: SessionListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: Session } | null>(null);

  // Mobile long-press refs
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMovedRef = useRef(false);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, session: Session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, session: Session) => {
    touchMovedRef.current = false;
    touchTimerRef.current = setTimeout(() => {
      const touch = e.touches[0];
      if (touch) {
        setContextMenu({ x: touch.clientX, y: touch.clientY, session });
      }
    }, 500);
  }, []);

  const handleTouchMove = useCallback(() => {
    touchMovedRef.current = true;
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleOpen = useCallback((session: Session) => {
    closeContextMenu();
    if (session.status === "active") {
      onSelect(session.id);
    } else {
      onResume(session.id);
    }
  }, [closeContextMenu, onSelect, onResume]);

  const handleRenameAction = useCallback((session: Session) => {
    closeContextMenu();
    const newName = window.prompt("New session name:", session.name);
    if (newName !== null && newName.trim() !== "") {
      onRename(session.id, newName.trim());
    }
  }, [closeContextMenu, onRename]);

  const handleSuspendAction = useCallback((session: Session) => {
    closeContextMenu();
    onSuspend(session.id);
  }, [closeContextMenu, onSuspend]);

  const handleTerminateAction = useCallback((session: Session) => {
    closeContextMenu();
    if (!confirm(`Kill session '${session.name}'?`)) return;
    onTerminate(session.id);
  }, [closeContextMenu, onTerminate]);

  const handleDeleteAction = useCallback((session: Session) => {
    closeContextMenu();
    if (!confirm(`Delete session '${session.name}'?`)) return;
    if (!confirm("Are you sure? This action cannot be undone.")) return;
    onDelete(session.id);
  }, [closeContextMenu, onDelete]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #313244",
          fontWeight: 600,
          fontSize: "var(--web-fs)",
          color: "#cdd6f4",
        }}
      >
        Sessions
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {sessions.length === 0 && (
          <div
            style={{
              padding: "16px",
              color: "#6c7086",
              textAlign: "center",
              fontSize: "var(--web-fs-sm)",
            }}
          >
            No sessions
          </div>
        )}

        {sessions.map((session) => {
          const isFocused = session.id === focusedSessionId;
          const isActiveNotFocused = !isFocused && activeSessions.includes(session.id);
          const isHighlighted = isFocused || isActiveNotFocused;
          const activity = sessionActivity[session.id];

          const borderColor = isFocused
            ? "#89b4fa"
            : isActiveNotFocused
              ? "#585b70"
              : "transparent";
          const bgColor = isFocused
            ? "#313244"
            : isActiveNotFocused
              ? "#252535"
              : "transparent";

          return (
            <div
              key={session.id}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                background: bgColor,
                borderLeft: `3px solid ${borderColor}`,
                transition: "background 0.15s",
              }}
              onClick={(e) => {
                if (session.status === "active") onSelect(session.id, e.shiftKey);
                if (session.status === "closed" || session.status === "suspended")
                  onResume(session.id);
              }}
              onContextMenu={(e) => handleContextMenu(e, session)}
              onTouchStart={(e) => handleTouchStart(e, session)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onMouseEnter={(e) => {
                if (!isHighlighted)
                  (e.currentTarget as HTMLDivElement).style.background = "#28283d";
              }}
              onMouseLeave={(e) => {
                if (!isHighlighted)
                  (e.currentTarget as HTMLDivElement).style.background =
                    bgColor === "transparent" ? "transparent" : bgColor;
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_COLORS[session.status] || "#6c7086",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "var(--web-fs-sm)",
                    fontWeight: 500,
                    color: "#cdd6f4",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {session.name}
                </span>
                {/* Activity indicator */}
                {activity === "processing" && <Spinner />}
                {activity === "done" && <DoneBadge />}
              </div>

              <div
                style={{
                  fontSize: "var(--web-fs-xs)",
                  color: "#6c7086",
                  marginLeft: 16,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {session.work_path}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginTop: 6,
                  marginLeft: 16,
                }}
              >
                <span
                  style={{
                    fontSize: "var(--web-fs-xxs)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#313244",
                    color: STATUS_COLORS[session.status] || "#6c7086",
                  }}
                >
                  {STATUS_LABELS[session.status] || session.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid #313244" }}>
        {activeSessions.length === 1 && (
          <div className="split-hint">Shift+Click to split view</div>
        )}
        <button
          onClick={onNewSession}
          style={{
            width: "100%",
            padding: "8px 16px",
            fontSize: "var(--web-fs-sm)",
            fontWeight: 600,
            background: "#89b4fa",
            color: "#1e1e2e",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          + New Session
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={contextMenu.session}
          onOpen={() => handleOpen(contextMenu.session)}
          onRename={() => handleRenameAction(contextMenu.session)}
          onSuspend={() => handleSuspendAction(contextMenu.session)}
          onTerminate={() => handleTerminateAction(contextMenu.session)}
          onDelete={() => handleDeleteAction(contextMenu.session)}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
