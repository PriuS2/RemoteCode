import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Login from "./components/Login";
import SessionList from "./components/SessionList";
import NewProject from "./components/NewSession";
import AddSessionModal from "./components/AddSessionModal";
import FileExplorer from "./components/FileExplorer";
import GitPanel from "./components/GitPanel";
import PanelSessionView from "./components/PanelSessionView";
import Terminal from "./components/Terminal";
import type { ActivityState } from "./components/Terminal";
import {
  playNotificationSound,
  requestNotificationPermission,
  sendBrowserNotification,
} from "./utils/notify";
import { apiFetch, onAuthExpired, readErrorDetail } from "./utils/api";
import type { Project } from "./types/project";
import type { Session } from "./types/session";
import "./App.css";

type ThemeMode = "light" | "dark";

function flattenProjects(projects: Project[]): Session[] {
  return projects.flatMap((project) => project.sessions);
}

function findSession(projects: Project[], sessionId: string): Session | undefined {
  for (const project of projects) {
    const session = project.sessions.find((item) => item.id === sessionId);
    if (session) return session;
  }
  return undefined;
}

function findProject(projects: Project[], projectId: string): Project | undefined {
  return projects.find((project) => project.id === projectId);
}

function isPanelSession(session: Session | undefined): session is Session {
  return session?.cli_type === "folder" || session?.cli_type === "git";
}

function getStoredFontSize(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v ? Number(v) : fallback;
}

function getStoredTheme(): ThemeMode {
  return localStorage.getItem("theme") === "dark" ? "dark" : "light";
}

function areListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem("sidebarWidth");
    return stored ? Number(stored) : 260;
  });
  const [mountedSessions, setMountedSessions] = useState<string[]>([]);
  const [sessionActivity, setSessionActivity] = useState<Record<string, ActivityState>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showThemeNotice, setShowThemeNotice] = useState(false);
  const [webFontSize, setWebFontSize] = useState(() => getStoredFontSize("webFontSize", 14));
  const [terminalFontSize, setTerminalFontSize] = useState(() => getStoredFontSize("terminalFontSize", 14));
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const sessions = useMemo(() => flattenProjects(projects), [projects]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const focusedSessionId = activeSessions[focusedIndex] ?? null;
  const [splitRatio, setSplitRatio] = useState(() => {
    const v = localStorage.getItem("splitRatio");
    return v ? Number(v) : 0.5;
  });
  const splitDragging = useRef(false);
  const terminalAreaRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (window.innerWidth > 768) {
        setViewportHeight(null);
        return;
      }
      const diff = window.innerHeight - vv.height;
      setViewportHeight(diff > 50 ? vv.height : null);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const newWidth = Math.max(220, Math.min(ev.clientX, 520));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((w) => {
        localStorage.setItem("sidebarWidth", String(w));
        return w;
      });
      window.dispatchEvent(new Event("panel-resize-end"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const resetClientState = useCallback((isAuthenticated: boolean) => {
    localStorage.removeItem("token");
    setAuthenticated(isAuthenticated);
    setProjects([]);
    setActiveSessions([]);
    setFocusedIndex(0);
    setMountedSessions([]);
    setSessionActivity({});
    setShowNewProject(false);
    setNewSessionProjectId(null);
  }, []);

  const fetchProjects = useCallback(async () => {
    if (authenticated !== true) return;
    try {
      const res = await apiFetch("/api/projects");
      if (res.status === 401) {
        resetClientState(false);
        return;
      }
      if (res.ok) {
        const data: Project[] = await res.json();
        setAuthenticated(true);
        setProjects(data);
      }
    } catch {
      // ignore
    }
  }, [authenticated, resetClientState]);

  useEffect(() => {
    localStorage.setItem("webFontSize", String(webFontSize));
    document.documentElement.style.setProperty("--web-scale", String(webFontSize / 14));
    document.documentElement.style.setProperty("--web-fs", webFontSize + "px");
    document.documentElement.style.setProperty("--web-fs-sm", webFontSize - 1 + "px");
    document.documentElement.style.setProperty("--web-fs-xs", webFontSize - 3 + "px");
    document.documentElement.style.setProperty("--web-fs-xxs", webFontSize - 4 + "px");
  }, [webFontSize]);

  useEffect(() => {
    localStorage.setItem("terminalFontSize", String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("splitRatio", String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSettings]);

  useEffect(() => {
    if (authenticated === true) {
      requestNotificationPermission();
    }
  }, [authenticated]);

  useEffect(() => {
    localStorage.removeItem("token");
  }, []);

  useEffect(() => {
    const detach = onAuthExpired(() => {
      resetClientState(false);
    });
    return detach;
  }, [resetClientState]);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const res = await apiFetch("/api/auth/session", { skipAuthHandling: true });
        if (cancelled) return;
        setAuthenticated(res.ok);
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
        }
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated !== true) return;
    void fetchProjects();
    pollRef.current = setInterval(fetchProjects, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [authenticated, fetchProjects]);

  useEffect(() => {
    const validIds = new Set(sessions.map((session) => session.id));
    setActiveSessions((prev) => {
      const next = prev.filter((sessionId) => validIds.has(sessionId));
      return areListsEqual(prev, next) ? prev : next;
    });
    setMountedSessions((prev) => {
      const next = prev.filter((sessionId) => validIds.has(sessionId));
      return areListsEqual(prev, next) ? prev : next;
    });
    setSessionActivity((prev) => {
      const next: Record<string, ActivityState> = {};
      Object.entries(prev).forEach(([sessionId, state]) => {
        if (validIds.has(sessionId)) next[sessionId] = state;
      });
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      if (
        prevEntries.length === nextEntries.length &&
        prevEntries.every(([sessionId, state]) => next[sessionId] === state)
      ) {
        return prev;
      }
      return next;
    });
  }, [sessions]);

  useEffect(() => {
    setFocusedIndex((prev) => {
      if (activeSessions.length === 0) return 0;
      return Math.min(prev, activeSessions.length - 1);
    });
  }, [activeSessions.length]);

  const handleLogin = useCallback(() => {
    setAuthenticated(true);
    void fetchProjects();
  }, [fetchProjects]);

  const applyTheme = useCallback((nextTheme: ThemeMode) => {
    if (nextTheme === theme) return;
    setTheme(nextTheme);
    if (mountedSessions.length > 0) {
      setShowThemeNotice(true);
    }
  }, [mountedSessions.length, theme]);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "light" ? "dark" : "light");
  }, [applyTheme, theme]);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        skipAuthHandling: true,
      });
    } catch {
      // ignore
    } finally {
      resetClientState(false);
    }
  }, [resetClientState]);

  const isMobile = () => window.innerWidth <= 768;

  const selectSession = (id: string, split = false) => {
    const forceSingle = isMobile() ? true : !split;

    if (forceSingle) {
      setActiveSessions([id]);
      setFocusedIndex(0);
    } else {
      setActiveSessions((prev) => {
        if (prev.length < 2) {
          if (prev.includes(id)) return prev;
          return [...prev, id];
        }
        const newArr = [...prev];
        newArr[focusedIndex] = id;
        return newArr;
      });
      if (activeSessions.length < 2) {
        setFocusedIndex(1);
      }
    }

    setSessionActivity((prev) => {
      if (prev[id] === "done") {
        return { ...prev, [id]: "idle" };
      }
      return prev;
    });
    if (!mountedSessions.includes(id)) {
      setMountedSessions((prev) => [...prev, id]);
    }
    if (isMobile()) setSidebarOpen(false);
  };

  const closeSplitPanel = (index: number) => {
    setActiveSessions((prev) => prev.filter((_, i) => i !== index));
    setFocusedIndex(0);
  };

  const handleActivityChange = useCallback(
    (sessionId: string, state: ActivityState) => {
      const isViewing = activeSessionsRef.current.includes(sessionId);

      setSessionActivity((prev) => {
        if (state === "done" && isViewing) {
          return { ...prev, [sessionId]: "idle" };
        }
        return { ...prev, [sessionId]: state };
      });

      if (state === "done" && !isViewing) {
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        const name = session?.name || "Session";
        playNotificationSound();
        sendBrowserNotification("Remote Code", `${name} - Task completed`);
      }
    },
    [],
  );

  const handleCopyPath = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const handleProjectCreated = (projectId: string) => {
    setShowNewProject(false);
    void projectId;
    void fetchProjects();
  };

  const handleSessionCreated = (sessionId: string) => {
    setNewSessionProjectId(null);
    selectSession(sessionId);
    void fetchProjects();
  };

  const removeFromActiveSessions = (id: string) => {
    setActiveSessions((prev) => prev.filter((sid) => sid !== id));
  };

  const removeManySessions = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    const removed = new Set(sessionIds);
    setActiveSessions((prev) => prev.filter((sid) => !removed.has(sid)));
    setMountedSessions((prev) => prev.filter((sid) => !removed.has(sid)));
    setSessionActivity((prev) => {
      const next = { ...prev };
      sessionIds.forEach((id) => delete next[id]);
      return next;
    });
  }, []);

  const handleSuspend = async (id: string) => {
    try {
      await apiFetch(`/api/sessions/${id}/suspend`, {
        method: "POST",
      });
      removeManySessions([id]);
      void fetchProjects();
    } catch (e) {
      console.error("Failed to suspend session:", e);
    }
  };

  const handleResume = async (id: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}/resume`, {
        method: "POST",
      });
      if (res.ok) {
        selectSession(id);
      }
      void fetchProjects();
    } catch (e) {
      console.error("Failed to resume session:", e);
    }
  };

  const handleTerminate = async (id: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to kill session.");
        throw new Error(detail.message);
      }
      removeManySessions([id]);
      void fetchProjects();
    } catch (e) {
      console.error("Failed to terminate session:", e);
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}?permanent=true`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to delete session.");
        throw new Error(detail.message);
      }
      removeManySessions([id]);
      void fetchProjects();
    } catch (e) {
      console.error("Failed to delete session:", e);
      throw e;
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to rename session.");
        throw new Error(detail.message);
      }
      void fetchProjects();
    } catch (e) {
      console.error("Failed to rename session:", e);
      throw e;
    }
  };

  const handleRenameProject = async (id: string, newName: string) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to rename project.");
        throw new Error(detail.message);
      }
      void fetchProjects();
    } catch (e) {
      console.error("Failed to rename project:", e);
      throw e;
    }
  };

  const handleDeleteProject = async (id: string) => {
    const project = findProject(projects, id);
    const projectSessionIds = project?.sessions.map((session) => session.id) ?? [];
    try {
      const res = await apiFetch(`/api/projects/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to delete project.");
        throw new Error(detail.message);
      }
      removeManySessions(projectSessionIds);
      if (newSessionProjectId === id) {
        setNewSessionProjectId(null);
      }
      void fetchProjects();
    } catch (e) {
      console.error("Failed to delete project:", e);
      throw e;
    }
  };

  const handleReorderProjects = async (orderedIds: string[]) => {
    try {
      await apiFetch("/api/projects/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      void fetchProjects();
    } catch (e) {
      console.error("Failed to reorder projects:", e);
    }
  };

  const handleReorderProjectSessions = async (projectId: string, orderedIds: string[]) => {
    try {
      await apiFetch(`/api/projects/${projectId}/sessions/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      void fetchProjects();
    } catch (e) {
      console.error("Failed to reorder project sessions:", e);
    }
  };

  const handleAddSession = (project: Project) => {
    setNewSessionProjectId(project.id);
  };

  if (authenticated === null) {
    return <div className="app-container" />;
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const newSessionProject = newSessionProjectId ? findProject(projects, newSessionProjectId) ?? null : null;
  const activeProjectCount = projects.filter((project) => project.sessions.some((session) => session.status === "active")).length;
  const activeSessionCount = sessions.filter((session) => session.status === "active").length;

  return (
    <div className="app-container" data-theme={theme} style={viewportHeight ? { height: viewportHeight } : undefined}>
      <header className="app-header workbench-card">
        <div className="header-left">
          <button
            className="chrome-btn sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {"\u2630"}
          </button>
          <div className="app-brand">
            <div className="app-brand-mark">RC</div>
            <div className="app-brand-copy">
              <span className="app-title">Remote Code</span>
              <span className="app-subtitle">Console Workbench</span>
            </div>
          </div>
        </div>
        <div className="header-right" ref={settingsRef}>
          <div className="header-badge">
            <strong>{projects.length}</strong>
            <span>projects</span>
          </div>
          <div className="header-badge">
            <strong>{activeSessionCount}</strong>
            <span>active sessions</span>
          </div>
          <button
            className="chrome-btn theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? "◐" : "◑"}
          </button>
          <button
            className="chrome-btn settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            {"\u2699"}
          </button>
          {showSettings && (
            <div className="settings-panel">
              <div className="settings-section">
                <label className="settings-label">Theme</label>
                <div className="theme-toggle-group">
                  <button
                    className={`theme-chip${theme === "light" ? " is-active" : ""}`}
                    onClick={() => applyTheme("light")}
                  >
                    Light
                  </button>
                  <button
                    className={`theme-chip${theme === "dark" ? " is-active" : ""}`}
                    onClick={() => applyTheme("dark")}
                  >
                    Dark
                  </button>
                </div>
              </div>
              <div className="settings-section">
                <label className="settings-label">Web Font Size</label>
                <div className="settings-control">
                  <button className="size-btn" onClick={() => setWebFontSize((s) => Math.max(10, s - 1))}>-</button>
                  <span className="size-value">{webFontSize}px</span>
                  <button className="size-btn" onClick={() => setWebFontSize((s) => Math.min(24, s + 1))}>+</button>
                </div>
              </div>
              <div className="settings-section">
                <label className="settings-label">Terminal Font Size</label>
                <div className="settings-control">
                  <button className="size-btn" onClick={() => setTerminalFontSize((s) => Math.max(8, s - 1))}>-</button>
                  <span className="size-value">{terminalFontSize}px</span>
                  <button className="size-btn" onClick={() => setTerminalFontSize((s) => Math.min(28, s + 1))}>+</button>
                </div>
              </div>
              <div className="settings-divider" />
              <button className="settings-logout" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {showThemeNotice && (
        <div className="theme-notice workbench-card" role="status" aria-live="polite">
          <div className="theme-notice__copy">
            <strong>테마 변경 안내</strong>
            <span>터미널 테마는 열린 세션에 즉시 적용되지 않습니다. 세션을 다시 열면 새 테마가 적용됩니다.</span>
          </div>
          <button
            className="theme-notice__close"
            onClick={() => setShowThemeNotice(false)}
            aria-label="테마 안내 닫기"
          >
            {"\u00d7"}
          </button>
        </div>
      )}

      <div className="app-body">
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {sidebarOpen && (
          <>
            <aside className="sidebar workbench-card" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              <SessionList
                projects={projects}
                activeSessions={activeSessions}
                focusedSessionId={focusedSessionId}
                sessionActivity={sessionActivity}
                onSelect={selectSession}
                onResume={handleResume}
                onNewProject={() => setShowNewProject(true)}
                onAddSession={handleAddSession}
                onDeleteSession={handleDelete}
                onRenameSession={handleRename}
                onSuspendSession={handleSuspend}
                onTerminateSession={handleTerminate}
                onDeleteProject={handleDeleteProject}
                onRenameProject={handleRenameProject}
                onReorderProjects={handleReorderProjects}
                onReorderProjectSessions={handleReorderProjectSessions}
              />
            </aside>
            <div className="sidebar-resize" onMouseDown={handleSidebarDragStart} />
          </>
        )}

        <main className="terminal-area workbench-card" ref={terminalAreaRef}>
          {mountedSessions.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__eyebrow">Workbench Ready</span>
              <h1 className="empty-state__title">
                {projects.length === 0 ? "Create a project to start working" : "Open a session to start working"}
              </h1>
              <p className="empty-state__body">
                {projects.length === 0
                  ? "Projects live in the left rail and own the workspace path. Add sessions under a project when you need terminal contexts."
                  : "Projects stay docked in the left rail while the terminal remains the primary workspace. Add or open a session from a project to continue."}
              </p>
              <div className="empty-state__meta">
                <span>{projects.length} projects</span>
                <span>{activeProjectCount} active projects</span>
                <span>{activeSessionCount} active sessions</span>
              </div>
              <button className="primary-button" onClick={() => setShowNewProject(true)}>
                Create Project
              </button>
            </div>
          )}

          {mountedSessions.map((sid) => {
            const panelIndex = activeSessions.indexOf(sid);
            const isVisible = panelIndex !== -1;
            const splitMode = activeSessions.length === 2;
            const session = findSession(projects, sid);
            const sessionName = session?.name || "Session";
            const sessionWorkPath = session?.work_path || "";
            const canSuspend = session?.cli_type !== "kilo";

            if (isPanelSession(session)) {
              const panelLabel = session.cli_type === "folder" ? "Folder Session" : "Git Session";
              return (
                <PanelSessionView
                  key={sid}
                  visible={isVisible}
                  panelIndex={panelIndex}
                  splitMode={splitMode}
                  splitRatio={splitRatio}
                  isFocused={isVisible && panelIndex === focusedIndex}
                  onFocus={() => {
                    if (panelIndex !== -1) setFocusedIndex(panelIndex);
                  }}
                  sessionName={sessionName}
                  workPath={sessionWorkPath}
                  panelLabel={panelLabel}
                  onClosePanel={() => {
                    if (panelIndex !== -1) closeSplitPanel(panelIndex);
                  }}
                  onMaximize={() => selectSession(sid)}
                  renderContent={(refreshKey) => (
                    session.cli_type === "folder" ? (
                      <FileExplorer
                        key={`folder-${sid}-${refreshKey}`}
                        rootPath={sessionWorkPath}
                        onInsertPath={(text) => { void handleCopyPath(text); }}
                        onClose={() => {}}
                        isMobile={isMobile()}
                        embedded
                        showCloseButton={false}
                      />
                    ) : (
                      <GitPanel
                        key={`git-${sid}-${refreshKey}`}
                        workPath={sessionWorkPath}
                        onClose={() => {}}
                        isMobile={isMobile()}
                        embedded
                        showHeaderTitle={false}
                        showWindowControls={false}
                      />
                    )
                  )}
                />
              );
            }

            return (
              <Terminal
                key={sid}
                sessionId={sid}
                visible={isVisible}
                fontSize={terminalFontSize}
                onFontSizeChange={(d) => setTerminalFontSize((s) => Math.max(8, Math.min(28, s + d)))}
                onActivityChange={handleActivityChange}
                panelIndex={panelIndex}
                splitMode={splitMode}
                splitRatio={splitRatio}
                isFocused={isVisible && panelIndex === focusedIndex}
                onFocus={() => {
                  if (panelIndex !== -1) setFocusedIndex(panelIndex);
                }}
                theme={theme}
                sessionName={sessionName}
                workPath={sessionWorkPath}
                onClosePanel={() => {
                  if (panelIndex !== -1) closeSplitPanel(panelIndex);
                }}
                canSuspend={canSuspend}
                onSuspend={() => handleSuspend(sid)}
                onMaximize={() => selectSession(sid)}
                onTerminate={() => {
                  void handleTerminate(sid).catch(() => {});
                }}
              />
            );
          })}

          {activeSessions.length === 2 && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                splitDragging.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";

                const onMove = (ev: MouseEvent) => {
                  if (!splitDragging.current || !terminalAreaRef.current) return;
                  const rect = terminalAreaRef.current.getBoundingClientRect();
                  const ratio = (ev.clientX - rect.left) / rect.width;
                  setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)));
                };
                const onUp = () => {
                  splitDragging.current = false;
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  window.dispatchEvent(new Event("panel-resize-end"));
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${splitRatio * 100}%`,
                width: 6,
                marginLeft: -3,
                cursor: "col-resize",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 18,
                  bottom: 18,
                  left: 2,
                  width: 2,
                  borderRadius: 999,
                  background: splitDragging.current ? "var(--accent)" : "rgba(148, 163, 184, 0.2)",
                  transition: "background 0.15s",
                }}
              />
            </div>
          )}
        </main>
      </div>

      {showNewProject && (
        <NewProject
          onCreated={handleProjectCreated}
          onCancel={() => setShowNewProject(false)}
        />
      )}

      {newSessionProject && (
        <AddSessionModal
          projectId={newSessionProject.id}
          projectName={newSessionProject.name}
          workPath={newSessionProject.work_path}
          onCreated={handleSessionCreated}
          onCancel={() => setNewSessionProjectId(null)}
        />
      )}
    </div>
  );
}
