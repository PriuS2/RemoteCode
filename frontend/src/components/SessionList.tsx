import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, PromptDialog } from "./Dialog";
import type { ActivityState } from "./Terminal";
import type { Project } from "../types/project";
import type { Session } from "../types/session";
import { getCliTone } from "../utils/cliTones";
import { setSessionDragData } from "../utils/sessionDragData";

interface SessionListProps {
  projects: Project[];
  activeSessions: string[];
  activeLayoutProjectId?: string | null;
  focusedSessionId: string | null;
  sessionActivity: Record<string, ActivityState>;
  onSelect: (id: string, split?: boolean) => void;
  onOpenLayout: (projectId: string) => void;
  onOpenProjectInNewWindow?: (project: Project) => void;
  onResume: (id: string) => void;
  onNewProject: () => void;
  onAddSession: (project: Project) => void;
  onOpenSessionInNewWindow?: (session: Session, project: Project) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onRenameSession: (id: string, newName: string) => Promise<void>;
  onSuspendSession: (id: string) => void;
  onTerminateSession: (id: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onRenameProject: (id: string, newName: string) => Promise<void>;
  onReorderProjects?: (orderedIds: string[]) => void;
  onReorderProjectSessions?: (projectId: string, orderedIds: string[]) => void;
  onSessionLayoutDragStart?: (sessionId: string) => void;
  onSessionLayoutDragEnd?: () => void;
}

type ContextMenuState
  = { kind: "project"; x: number; y: number; project: Project }
  | { kind: "session"; x: number; y: number; session: Session; project: Project };

type DragState
  = { type: "project"; projectId: string }
  | { type: "session-reorder"; projectId: string; sessionId: string };

const STATUS_META: Record<string, { label: string; color: string; chipClass: string }> = {
  active: { label: "Active", color: "var(--success)", chipClass: "session-chip--active" },
  suspended: { label: "Suspended", color: "var(--warn)", chipClass: "session-chip--suspended" },
  closed: { label: "Closed", color: "var(--text-muted)", chipClass: "session-chip--closed" },
};
const CLAUDE_SKIP_PERMISSIONS_OPTION = "--dangerously-skip-permissions";

function getCliMeta(cliType: string) {
  return getCliTone(cliType);
}

function isProcessSession(session: Session) {
  return session.cli_type !== "folder" && session.cli_type !== "git" && session.cli_type !== "ide";
}

function canSuspendSession(session: Session) {
  return (isProcessSession(session) && session.cli_type !== "kilo") || session.cli_type === "ide";
}

function isSkipPermissionsSession(session: Session) {
  return session.cli_type === "claude" && Boolean(
    session.cli_options && new RegExp(`(^|\\s)${CLAUDE_SKIP_PERMISSIONS_OPTION}(?=\\s|$)`).test(session.cli_options.trim()),
  );
}

function reorderList<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  const next = [...items];
  const draggedIndex = next.findIndex((item) => item.id === draggedId);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return items;
  }
  const [draggedItem] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, draggedItem);
  return next;
}

function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: Array<{ label: string; onClick: () => void; danger?: boolean; warn?: boolean }>;
  onClose: () => void;
}) {
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
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const dismiss = () => onClose();

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu__label">{label}</div>
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu__item${item.warn ? " context-menu__item--warn" : ""}${item.danger ? " context-menu__item--danger" : ""}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function SessionList({
  projects,
  activeSessions,
  activeLayoutProjectId = null,
  focusedSessionId,
  sessionActivity,
  onSelect,
  onOpenLayout,
  onOpenProjectInNewWindow,
  onResume,
  onNewProject,
  onAddSession,
  onOpenSessionInNewWindow,
  onDeleteSession,
  onRenameSession,
  onSuspendSession,
  onTerminateSession,
  onDeleteProject,
  onRenameProject,
  onReorderProjects,
  onReorderProjectSessions,
  onSessionLayoutDragStart,
  onSessionLayoutDragEnd,
}: SessionListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [localProjects, setLocalProjects] = useState<Project[]>(projects);
  const [draggedItem, setDraggedItem] = useState<DragState | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [projectRenameTarget, setProjectRenameTarget] = useState<Project | null>(null);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<Project | null>(null);
  const [sessionRenameTarget, setSessionRenameTarget] = useState<Session | null>(null);
  const [sessionRenameValue, setSessionRenameValue] = useState("");
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<Session | null>(null);
  const [sessionTerminateTarget, setSessionTerminateTarget] = useState<Session | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedExpandedRef = useRef(false);
  const previousProjectIdsRef = useRef<string[]>([]);

  useEffect(() => {
    setLocalProjects(projects);
  }, [projects]);

  useEffect(() => {
    const ids = projects.map((project) => project.id);
    const previousIds = previousProjectIdsRef.current;
    previousProjectIdsRef.current = ids;

    if (ids.length === 0) {
      initializedExpandedRef.current = false;
      setExpandedProjects([]);
      return;
    }

    setExpandedProjects((prev) => {
      if (!initializedExpandedRef.current) {
        initializedExpandedRef.current = true;
        return ids;
      }

      const previousIdSet = new Set(previousIds);
      const currentIdSet = new Set(ids);
      const next = prev.filter((id) => currentIdSet.has(id));
      const newIds = ids.filter((id) => !previousIdSet.has(id));

      if (newIds.length === 0) {
        return next;
      }

      return [...next, ...newIds];
    });
  }, [projects]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const reorderEnabled = !normalizedQuery;
  const visibleProjects = useMemo(() => {
    if (!normalizedQuery) return localProjects;
    return localProjects
      .map((project) => {
        const projectMatch = project.name.toLowerCase().includes(normalizedQuery)
          || project.work_path.toLowerCase().includes(normalizedQuery);
        if (projectMatch) {
          return project;
        }
        const sessions = project.sessions.filter((session) => {
          return (
            session.name.toLowerCase().includes(normalizedQuery)
            || session.work_path.toLowerCase().includes(normalizedQuery)
          );
        });
        if (sessions.length === 0) return null;
        return { ...project, sessions };
      })
      .filter((project): project is Project => Boolean(project));
  }, [localProjects, normalizedQuery]);
  const allProjectIds = useMemo(() => localProjects.map((project) => project.id), [localProjects]);
  const hasExpandedProjects = useMemo(() => {
    const projectIdSet = new Set(allProjectIds);
    return expandedProjects.some((id) => projectIdSet.has(id));
  }, [allProjectIds, expandedProjects]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const toggleExpanded = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      if (prev.includes(projectId)) {
        return prev.filter((id) => id !== projectId);
      }
      return [...prev, projectId];
    });
  }, []);

  const toggleAllProjects = useCallback(() => {
    setExpandedProjects(hasExpandedProjects ? [] : allProjectIds);
  }, [allProjectIds, hasExpandedProjects]);

  const openContextMenu = useCallback((event: React.MouseEvent | React.TouchEvent, state: ContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    const point = "touches" in event ? event.touches[0] : event;
    if (!point) return;
    setContextMenu({ ...state, x: point.clientX, y: point.clientY });
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent, state: ContextMenuState) => {
    touchTimerRef.current = setTimeout(() => openContextMenu(event, state), 500);
  }, [openContextMenu]);

  const clearTouchTimer = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const resetDialogs = useCallback(() => {
    if (actionPending) return;
    setActionError(null);
    setProjectRenameTarget(null);
    setProjectDeleteTarget(null);
    setSessionRenameTarget(null);
    setSessionDeleteTarget(null);
    setSessionTerminateTarget(null);
  }, [actionPending]);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget || !projectRenameValue.trim()) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onRenameProject(projectRenameTarget.id, projectRenameValue.trim());
      setProjectRenameTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to rename project.");
    } finally {
      setActionPending(false);
    }
  }, [onRenameProject, projectRenameTarget, projectRenameValue]);

  const submitProjectDelete = useCallback(async () => {
    if (!projectDeleteTarget) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onDeleteProject(projectDeleteTarget.id);
      setProjectDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to delete project.");
    } finally {
      setActionPending(false);
    }
  }, [onDeleteProject, projectDeleteTarget]);

  const submitSessionRename = useCallback(async () => {
    if (!sessionRenameTarget || !sessionRenameValue.trim()) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onRenameSession(sessionRenameTarget.id, sessionRenameValue.trim());
      setSessionRenameTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to rename session.");
    } finally {
      setActionPending(false);
    }
  }, [onRenameSession, sessionRenameTarget, sessionRenameValue]);

  const submitSessionDelete = useCallback(async () => {
    if (!sessionDeleteTarget) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onDeleteSession(sessionDeleteTarget.id);
      setSessionDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to delete session.");
    } finally {
      setActionPending(false);
    }
  }, [onDeleteSession, sessionDeleteTarget]);

  const submitSessionTerminate = useCallback(async () => {
    if (!sessionTerminateTarget) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onTerminateSession(sessionTerminateTarget.id);
      setSessionTerminateTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to kill session.");
    } finally {
      setActionPending(false);
    }
  }, [onTerminateSession, sessionTerminateTarget]);

  const handleDragStart = useCallback((event: React.DragEvent, item: DragState) => {
    if (!reorderEnabled) return;
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = "move";
  }, [reorderEnabled]);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverKey(null);
  }, []);

  const handleProjectDrop = useCallback((targetProjectId: string) => {
    if (!draggedItem || draggedItem.type !== "project" || !onReorderProjects) {
      setDraggedItem(null);
      setDragOverKey(null);
      return;
    }
    if (draggedItem.projectId === targetProjectId) {
      setDraggedItem(null);
      setDragOverKey(null);
      return;
    }
    const reordered = reorderList(localProjects, draggedItem.projectId, targetProjectId);
    setLocalProjects(reordered);
    onReorderProjects(reordered.map((project) => project.id));
    setDraggedItem(null);
    setDragOverKey(null);
  }, [draggedItem, localProjects, onReorderProjects]);

  const handleSessionDrop = useCallback((projectId: string, targetSessionId: string) => {
    if (!draggedItem || draggedItem.type !== "session-reorder" || !onReorderProjectSessions) {
      setDraggedItem(null);
      setDragOverKey(null);
      return;
    }
    if (draggedItem.projectId !== projectId || draggedItem.sessionId === targetSessionId) {
      setDraggedItem(null);
      setDragOverKey(null);
      return;
    }

    const reorderedProjects = localProjects.map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        sessions: reorderList(project.sessions, draggedItem.sessionId, targetSessionId),
      };
    });
    setLocalProjects(reorderedProjects);
    const project = reorderedProjects.find((item) => item.id === projectId);
    if (project) {
      onReorderProjectSessions(projectId, project.sessions.map((session) => session.id));
    }
    setDraggedItem(null);
    setDragOverKey(null);
  }, [draggedItem, localProjects, onReorderProjectSessions]);

  const handleSessionLayoutDragStart = useCallback((event: React.DragEvent, sessionId: string) => {
    event.dataTransfer.effectAllowed = "move";
    setSessionDragData(event.dataTransfer, sessionId);
    onSessionLayoutDragStart?.(sessionId);
  }, [onSessionLayoutDragStart]);

  const handleSessionLayoutDragEnd = useCallback(() => {
    onSessionLayoutDragEnd?.();
  }, [onSessionLayoutDragEnd]);

  const projectCountLabel = `${projects.length} total`;
  const projectMenuItems = contextMenu?.kind === "project" ? [
    {
      label: "Open Layout",
      onClick: () => {
        onOpenLayout(contextMenu.project.id);
        closeContextMenu();
      },
    },
    ...(onOpenProjectInNewWindow ? [{
      label: "Open Project in New Window",
      onClick: () => {
        onOpenProjectInNewWindow(contextMenu.project);
        closeContextMenu();
      },
    }] : []),
    {
      label: "Reveal in File Explorer",
      onClick: () => {
        const remoteCodeDesktop = (window as unknown as { remoteCodeDesktop?: { revealInFileExplorer?: (filePath: string) => Promise<boolean> } }).remoteCodeDesktop;
        if (remoteCodeDesktop?.revealInFileExplorer) {
          void remoteCodeDesktop.revealInFileExplorer(contextMenu.project.work_path);
        }
        closeContextMenu();
      },
    },
    {
      label: "Add Session",
      onClick: () => {
        onAddSession(contextMenu.project);
        closeContextMenu();
      },
    },
    {
      label: "Rename Project",
      onClick: () => {
        setActionError(null);
        setProjectRenameTarget(contextMenu.project);
        setProjectRenameValue(contextMenu.project.name);
        closeContextMenu();
      },
    },
    {
      label: "Delete Project",
      onClick: () => {
        setActionError(null);
        setProjectDeleteTarget(contextMenu.project);
        closeContextMenu();
      },
      danger: true,
    },
  ] : [];

  const sessionMenuItems = contextMenu?.kind === "session" ? [
    {
      label: "Open",
      onClick: () => {
        if (contextMenu.session.status === "active") onSelect(contextMenu.session.id);
        else onSelect(contextMenu.session.id);
        closeContextMenu();
      },
    },
    ...(onOpenSessionInNewWindow ? [{
      label: "Open Session in New Window",
      onClick: () => {
        onOpenSessionInNewWindow(contextMenu.session, contextMenu.project);
        closeContextMenu();
      },
    }] : []),
    {
      label: "Rename Session",
      onClick: () => {
        setActionError(null);
        setSessionRenameTarget(contextMenu.session);
        setSessionRenameValue(contextMenu.session.name);
        closeContextMenu();
      },
    },
    ...(contextMenu.session.status === "active" && canSuspendSession(contextMenu.session) ? [{
      label: "Suspend",
      onClick: () => {
        onSuspendSession(contextMenu.session.id);
        closeContextMenu();
      },
      warn: true,
    }] : []),
    ...(contextMenu.session.status === "active" && isProcessSession(contextMenu.session) ? [{
      label: "Kill",
      onClick: () => {
        setActionError(null);
        setSessionTerminateTarget(contextMenu.session);
        closeContextMenu();
      },
      warn: true,
    }] : []),
    {
      label: "Delete Session",
      onClick: () => {
        setActionError(null);
        setSessionDeleteTarget(contextMenu.session);
        closeContextMenu();
      },
      danger: true,
    },
  ] : [];

  return (
    <div className="session-list">
      <div className="session-list__header">
        <div className="session-list__eyebrow">Project Explorer</div>
        <div className="session-list__title-row">
          <div className="session-list__title">Projects</div>
          <div className="session-list__title-actions">
            <div className="session-list__count">{projectCountLabel}</div>
            <button
              type="button"
              className="ghost-button session-list__collapse"
              onClick={toggleAllProjects}
              disabled={projects.length === 0}
            >
              {hasExpandedProjects ? "Collapse all" : "Expand all"}
            </button>
          </div>
        </div>
        <div className="session-list__search-wrap">
          <input
            className="ui-input"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by project, session, or path"
          />
          {normalizedQuery && (
            <div className="session-list__hint">Reordering is disabled while filtering.</div>
          )}
        </div>
      </div>

      <div className="session-list__scroll">
        {projects.length === 0 && (
          <div className="session-list__empty">No projects yet</div>
        )}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="session-list__empty">No matching projects or sessions</div>
        )}

        {visibleProjects.map((project) => {
          const expanded = normalizedQuery ? true : expandedProjects.includes(project.id);
          const projectDragOver = dragOverKey === `project:${project.id}`;
          const isActiveLayoutProject = activeLayoutProjectId === project.id;
          const activeCliCount = project.sessions.filter((session) => {
            return isProcessSession(session) && session.status === "active";
          }).length;
          const activeCliLabel = `${activeCliCount} active`;
          const sessionCountLabel = `${project.sessions.length} session${project.sessions.length === 1 ? "" : "s"}`;
          return (
            <div key={project.id} className="project-group">
              <div
                className={`project-row${expanded ? " is-expanded" : ""}${projectDragOver ? " is-drag-over" : ""}${activeCliCount > 0 ? " has-active-cli" : ""}`}
                data-testid={`project-row-${project.id}`}
                draggable={reorderEnabled}
                onClick={() => toggleExpanded(project.id)}
                onContextMenu={(event) => openContextMenu(event, {
                  kind: "project",
                  x: event.clientX,
                  y: event.clientY,
                  project,
                })}
                onTouchStart={(event) => handleTouchStart(event, {
                  kind: "project",
                  x: 0,
                  y: 0,
                  project,
                })}
                onTouchMove={clearTouchTimer}
                onTouchEnd={clearTouchTimer}
                onTouchCancel={clearTouchTimer}
                onDragStart={(event) => handleDragStart(event, { type: "project", projectId: project.id })}
                onDragEnd={handleDragEnd}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!reorderEnabled || draggedItem?.type !== "project" || draggedItem.projectId === project.id) return;
                  setDragOverKey(`project:${project.id}`);
                }}
                onDragLeave={() => setDragOverKey(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  handleProjectDrop(project.id);
                }}
              >
                <div className="project-row__top">
                  <span className="project-row__toggle">{expanded ? "v" : ">"}</span>
                  <span className="project-row__name">{project.name}</span>
                  <div className="project-row__actions">
                    <span className="project-row__stat" title={`${activeCliCount} active terminal sessions`}>
                      {activeCliLabel}
                    </span>
                    <button
                      type="button"
                      className={`ghost-button project-row__layout${isActiveLayoutProject ? " is-active" : ""}`}
                      aria-label={`Open layout for ${project.name}`}
                      data-testid={`project-layout-${project.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenLayout(project.id);
                      }}
                    >
                      Layout
                    </button>
                    <button
                      type="button"
                      className="ghost-button project-row__add"
                      data-testid={`project-add-session-${project.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddSession(project);
                      }}
                    >
                      + Session
                    </button>
                  </div>
                </div>
                <div className="project-row__bottom">
                  <div className="project-row__path">{project.work_path}</div>
                  <div className="project-row__meta">{sessionCountLabel}</div>
                </div>
              </div>

              {expanded && (
                <div className="project-children">
                  {project.sessions.length === 0 && (
                    <div className="project-children__empty">No sessions in this project</div>
                  )}
                  {project.sessions.map((session) => {
                    const isFocused = session.id === focusedSessionId;
                    const isActiveNotFocused = !isFocused && activeSessions.includes(session.id);
                    const isActive = isFocused || isActiveNotFocused;
                    const statusMeta = STATUS_META[session.status] ?? STATUS_META.closed;
                    const cliMeta = getCliMeta(session.cli_type);
                    const isSkipPerm = isSkipPermissionsSession(session);
                    const sessionDragOver = dragOverKey === `session:${project.id}:${session.id}`;
                    const rowClassName = [
                      "session-row",
                      "session-row--nested",
                      isFocused ? "is-focused" : "",
                      isActive ? "is-active" : "",
                      sessionDragOver ? "is-drag-over" : "",
                    ].filter(Boolean).join(" ");

                    return (
                      <div
                        key={session.id}
                        className={rowClassName}
                        draggable
                        data-testid={`session-row-${session.id}`}
                        aria-label={`Open session ${session.name}`}
                        onClick={(event) => {
                          void event;
                          onSelect(session.id);
                        }}
                        onContextMenu={(event) => openContextMenu(event, {
                          kind: "session",
                          x: event.clientX,
                          y: event.clientY,
                          session,
                          project,
                        })}
                        onTouchStart={(event) => handleTouchStart(event, {
                          kind: "session",
                          x: 0,
                          y: 0,
                          session,
                          project,
                        })}
                        onTouchMove={clearTouchTimer}
                        onTouchEnd={clearTouchTimer}
                        onTouchCancel={clearTouchTimer}
                        onDragStart={(event) => handleSessionLayoutDragStart(event, session.id)}
                        onDragEnd={handleSessionLayoutDragEnd}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (
                            !reorderEnabled
                            || draggedItem?.type !== "session-reorder"
                            || draggedItem.projectId !== project.id
                            || draggedItem.sessionId === session.id
                          ) {
                            return;
                          }
                          setDragOverKey(`session:${project.id}:${session.id}`);
                        }}
                        onDragLeave={() => setDragOverKey(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleSessionDrop(project.id, session.id);
                        }}
                      >
                        <div className="session-row__main">
                          <button
                            type="button"
                            className={`session-row__drag-handle${reorderEnabled ? "" : " is-disabled"}`}
                            title={reorderEnabled ? "Reorder session" : "Reordering disabled while filtering"}
                            aria-label={`Reorder session ${session.name}`}
                            draggable={reorderEnabled}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              handleDragStart(event, {
                                type: "session-reorder",
                                projectId: project.id,
                                sessionId: session.id,
                              });
                            }}
                            onDragEnd={(event) => {
                              event.stopPropagation();
                              handleDragEnd();
                            }}
                          >
                            ::
                          </button>
                          <span className="session-row__name">{session.name}</span>
                          <div className="session-row__meta-group">
                            <span className={`session-chip session-chip--status ${statusMeta.chipClass}`}>
                              {statusMeta.label}
                            </span>
                            <span
                              className="session-chip session-chip--cli"
                              title={cliMeta.label}
                              style={{
                                background: cliMeta.solid,
                                borderColor: cliMeta.border,
                                color: cliMeta.text,
                              }}
                            >
                              {cliMeta.label}
                            </span>
                            {isSkipPerm && (
                              <span
                                className="session-chip session-chip--skip-perm"
                                title="Claude session uses --dangerously-skip-permissions"
                              >
                                SKIP PERM
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="session-list__footer">
        <div className="split-hint">Drag sessions into the workbench to place or replace panes.</div>
        <button className="primary-button" data-testid="new-project-button" onClick={onNewProject}>
          + New Project
        </button>
      </div>

      {contextMenu?.kind === "project" && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={contextMenu.project.name}
          items={projectMenuItems}
          onClose={closeContextMenu}
        />
      )}

      {contextMenu?.kind === "session" && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={contextMenu.session.name}
          items={sessionMenuItems}
          onClose={closeContextMenu}
        />
      )}

      {projectRenameTarget && (
        <PromptDialog
          title="Rename Project"
          label="Project name"
          value={projectRenameValue}
          confirmLabel="Save"
          pending={actionPending}
          error={actionError}
          onChange={setProjectRenameValue}
          onConfirm={submitProjectRename}
          onCancel={resetDialogs}
        />
      )}

      {projectDeleteTarget && (
        <ConfirmDialog
          title="Delete Project"
          description={`Delete project '${projectDeleteTarget.name}' and all of its sessions? This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          pending={actionPending}
          error={actionError}
          onConfirm={submitProjectDelete}
          onCancel={resetDialogs}
        />
      )}

      {sessionRenameTarget && (
        <PromptDialog
          title="Rename Session"
          label="Session name"
          value={sessionRenameValue}
          confirmLabel="Save"
          pending={actionPending}
          error={actionError}
          onChange={setSessionRenameValue}
          onConfirm={submitSessionRename}
          onCancel={resetDialogs}
        />
      )}

      {sessionDeleteTarget && (
        <ConfirmDialog
          title="Delete Session"
          description={`Delete session '${sessionDeleteTarget.name}' permanently? This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          pending={actionPending}
          error={actionError}
          onConfirm={submitSessionDelete}
          onCancel={resetDialogs}
        />
      )}

      {sessionTerminateTarget && (
        <ConfirmDialog
          title="Kill Session"
          description={`Kill session '${sessionTerminateTarget.name}' now? The running terminal will be closed immediately.`}
          confirmLabel="Kill"
          danger
          pending={actionPending}
          error={actionError}
          onConfirm={submitSessionTerminate}
          onCancel={resetDialogs}
        />
      )}
    </div>
  );
}

