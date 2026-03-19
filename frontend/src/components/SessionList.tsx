import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, PromptDialog } from "./Dialog";
import type { ActivityState } from "./Terminal";
import type { Session } from "../types/session";

interface SessionListProps {
  sessions: Session[];
  activeSessions: string[];
  focusedSessionId: string | null;
  sessionActivity: Record<string, ActivityState>;
  onSelect: (id: string, split?: boolean) => void;
  onResume: (id: string) => void;
  onNewSession: () => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
  onSuspend: (id: string) => void;
  onTerminate: (id: string) => Promise<void>;
  onReorder?: (orderedIds: string[]) => void;
}

const STATUS_META: Record<string, { label: string; color: string; chipClass: string }> = {
  active: { label: "Active", color: "var(--success)", chipClass: "session-chip--active" },
  suspended: { label: "Suspended", color: "var(--warn)", chipClass: "session-chip--suspended" },
  closed: { label: "Closed", color: "var(--text-muted)", chipClass: "session-chip--closed" },
};

const CLI_META: Record<string, { label: string; bg: string }> = {
  "opencode-web": { label: "OpenCode Web", bg: "var(--warn)" },
  opencode: { label: "OpenCode", bg: "var(--info)" },
  custom: { label: "Custom", bg: "var(--success)" },
  terminal: { label: "Terminal", bg: "#b794f6" },
  default: { label: "Claude", bg: "var(--accent)" },
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
      stroke="var(--accent)"
      strokeWidth="2"
      strokeDasharray="20 12"
      strokeLinecap="round"
    />
  </svg>
);

const DoneBadge = () => (
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "var(--success)",
      boxShadow: "0 0 10px rgba(120, 215, 167, 0.8)",
      flexShrink: 0,
      animation: "ccr-pulse 1.5s ease-in-out infinite",
    }}
  />
);

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

function ContextMenu({
  x,
  y,
  session,
  onOpen,
  onRename,
  onSuspend,
  onTerminate,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - 4) nx = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight - 4) ny = window.innerHeight - rect.height - 4;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu__label">{session.name}</div>
      <button className="context-menu__item" onClick={onOpen}>Open</button>
      <button className="context-menu__item" onClick={onRename}>Rename</button>
      {session.status === "active" && (
        <button className="context-menu__item context-menu__item--warn" onClick={onSuspend}>Suspend</button>
      )}
      {session.status === "active" && (
        <button className="context-menu__item context-menu__item--warn" onClick={onTerminate}>Kill</button>
      )}
      <div className="context-menu__divider" />
      <button className="context-menu__item context-menu__item--danger" onClick={onDelete}>Delete</button>
    </div>,
    document.body,
  );
}

function getCliMeta(cliType: string) {
  return CLI_META[cliType] ?? CLI_META.default;
}

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
  onReorder,
}: SessionListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: Session } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<Session | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [localSessions, setLocalSessions] = useState<Session[]>(sessions);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const reorderEnabled = Boolean(onReorder && !normalizedQuery);
  const visibleSessions = useMemo(() => {
    if (!normalizedQuery) return localSessions;
    return localSessions.filter((session) => {
      return (
        session.name.toLowerCase().includes(normalizedQuery)
        || session.work_path.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [localSessions, normalizedQuery]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, session: Session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, session: Session) => {
    touchTimerRef.current = setTimeout(() => {
      const touch = e.touches[0];
      if (touch) {
        setContextMenu({ x: touch.clientX, y: touch.clientY, session });
      }
    }, 500);
  }, []);

  const handleTouchMove = useCallback(() => {
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
    setActionError(null);
    if (session.status === "active") onSelect(session.id);
    else onResume(session.id);
  }, [closeContextMenu, onResume, onSelect]);

  const startRename = useCallback((session: Session) => {
    closeContextMenu();
    setActionError(null);
    setRenameTarget(session);
    setRenameValue(session.name);
  }, [closeContextMenu]);

  const handleSuspendAction = useCallback((session: Session) => {
    closeContextMenu();
    onSuspend(session.id);
  }, [closeContextMenu, onSuspend]);

  const startTerminate = useCallback((session: Session) => {
    closeContextMenu();
    setActionError(null);
    setTerminateTarget(session);
  }, [closeContextMenu]);

  const startDelete = useCallback((session: Session) => {
    closeContextMenu();
    setActionError(null);
    setDeleteTarget(session);
  }, [closeContextMenu]);

  const submitRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onRename(renameTarget.id, renameValue.trim());
      setRenameTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to rename session.");
    } finally {
      setActionPending(false);
    }
  }, [onRename, renameTarget, renameValue]);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to delete session.");
    } finally {
      setActionPending(false);
    }
  }, [deleteTarget, onDelete]);

  const submitTerminate = useCallback(async () => {
    if (!terminateTarget) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onTerminate(terminateTarget.id);
      setTerminateTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to kill session.");
    } finally {
      setActionPending(false);
    }
  }, [onTerminate, terminateTarget]);

  const resetDialogs = useCallback(() => {
    if (actionPending) return;
    setActionError(null);
    setRenameTarget(null);
    setDeleteTarget(null);
    setTerminateTarget(null);
  }, [actionPending]);

  const handleDragStart = useCallback((e: React.DragEvent, sessionId: string) => {
    if (!reorderEnabled) return;
    setDraggedId(sessionId);
    e.dataTransfer.effectAllowed = "move";
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.opacity = "0.5";
    dragImage.style.width = `${e.currentTarget.clientWidth}px`;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, [reorderEnabled]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, sessionId: string) => {
    e.preventDefault();
    if (!reorderEnabled || !draggedId || draggedId === sessionId) return;
    setDragOverId(sessionId);
  }, [draggedId, reorderEnabled]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!reorderEnabled || !draggedId || draggedId === targetId || !onReorder) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const newSessions = [...localSessions];
    const draggedIndex = newSessions.findIndex((session) => session.id === draggedId);
    const targetIndex = newSessions.findIndex((session) => session.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const [draggedItem] = newSessions.splice(draggedIndex, 1);
    newSessions.splice(targetIndex, 0, draggedItem);

    setLocalSessions(newSessions);
    setDraggedId(null);
    setDragOverId(null);
    onReorder(newSessions.map((session) => session.id));
  }, [draggedId, localSessions, onReorder, reorderEnabled]);

  return (
    <div className="session-list">
      <div className="session-list__header">
        <div className="session-list__eyebrow">Session Explorer</div>
        <div className="session-list__title-row">
          <div className="session-list__title">Sessions</div>
          <div className="session-list__count">{sessions.length} total</div>
        </div>
        <div className="session-list__search-wrap">
          <input
            className="ui-input"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name or path"
          />
          {normalizedQuery && (
            <div className="session-list__hint">Reordering is disabled while filtering.</div>
          )}
        </div>
      </div>

      <div className="session-list__scroll">
        {sessions.length === 0 && (
          <div className="session-list__empty">No sessions yet</div>
        )}
        {sessions.length > 0 && visibleSessions.length === 0 && (
          <div className="session-list__empty">No matching sessions</div>
        )}

        {visibleSessions.map((session) => {
          const isFocused = session.id === focusedSessionId;
          const isActiveNotFocused = !isFocused && activeSessions.includes(session.id);
          const isActive = isFocused || isActiveNotFocused;
          const activity = sessionActivity[session.id];
          const isDragged = draggedId === session.id;
          const isDragOver = dragOverId === session.id;
          const statusMeta = STATUS_META[session.status] ?? STATUS_META.closed;
          const cliMeta = getCliMeta(session.cli_type);
          const rowClassName = [
            "session-row",
            isFocused ? "is-focused" : "",
            isActive ? "is-active" : "",
            isDragged ? "is-dragging" : "",
            isDragOver ? "is-drag-over" : "",
          ].filter(Boolean).join(" ");

          return (
            <div
              key={session.id}
              className={rowClassName}
              draggable={reorderEnabled}
              style={{ "--row-accent": statusMeta.color } as React.CSSProperties}
              onClick={(e) => {
                if (session.status === "active") onSelect(session.id, e.shiftKey);
                if (session.status === "closed" || session.status === "suspended") onResume(session.id);
              }}
              onContextMenu={(e) => handleContextMenu(e, session)}
              onTouchStart={(e) => handleTouchStart(e, session)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onDragStart={(e) => handleDragStart(e, session.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, session.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => handleDrop(e, session.id)}
            >
              <div className="session-row__top">
                <span className="session-row__dot" style={{ background: statusMeta.color }} />
                <span className="session-row__name">{session.name}</span>
                {activity === "processing" && <Spinner />}
                {activity === "done" && <DoneBadge />}
              </div>

              <div className="session-row__path">{session.work_path}</div>

              <div className="session-row__bottom">
                <span className={`session-chip session-chip--status ${statusMeta.chipClass}`}>
                  {statusMeta.label}
                </span>
                <span
                  className="session-chip session-chip--cli"
                  title={cliMeta.label}
                  style={{ background: cliMeta.bg }}
                >
                  {cliMeta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="session-list__footer">
        {activeSessions.length === 1 && <div className="split-hint">Shift+Click to split view</div>}
        <button className="primary-button" onClick={onNewSession}>
          + New Session
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={contextMenu.session}
          onOpen={() => handleOpen(contextMenu.session)}
          onRename={() => startRename(contextMenu.session)}
          onSuspend={() => handleSuspendAction(contextMenu.session)}
          onTerminate={() => startTerminate(contextMenu.session)}
          onDelete={() => startDelete(contextMenu.session)}
          onClose={closeContextMenu}
        />
      )}

      {renameTarget && (
        <PromptDialog
          title="Rename Session"
          label="Session name"
          value={renameValue}
          confirmLabel="Save"
          pending={actionPending}
          error={actionError}
          onChange={setRenameValue}
          onConfirm={submitRename}
          onCancel={resetDialogs}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Session"
          description={`Delete session '${deleteTarget.name}' permanently? This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          pending={actionPending}
          error={actionError}
          onConfirm={submitDelete}
          onCancel={resetDialogs}
        />
      )}

      {terminateTarget && (
        <ConfirmDialog
          title="Kill Session"
          description={`Kill session '${terminateTarget.name}' now? The running terminal will be closed immediately.`}
          confirmLabel="Kill"
          danger
          pending={actionPending}
          error={actionError}
          onConfirm={submitTerminate}
          onCancel={resetDialogs}
        />
      )}
    </div>
  );
}
