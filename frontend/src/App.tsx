import { useState, useEffect, useCallback, useRef } from "react";
import Login from "./components/Login";
import SessionList from "./components/SessionList";
import NewSession from "./components/NewSession";
import Terminal from "./components/Terminal";
import OpenCodeWebViewer from "./components/OpenCodeWebViewer";
import type { ActivityState } from "./components/Terminal";
import {
  playNotificationSound,
  requestNotificationPermission,
  sendBrowserNotification,
} from "./utils/notify";
import { apiFetch, onAuthExpired, readErrorDetail } from "./utils/api";
import type { Session } from "./types/session";
import "./App.css";

function getStoredFontSize(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v ? Number(v) : fallback;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showNewSession, setShowNewSession] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem("sidebarWidth");
    return stored ? Number(stored) : 260;
  });
  const [mountedSessions, setMountedSessions] = useState<string[]>([]);
  const [sessionActivity, setSessionActivity] = useState<Record<string, ActivityState>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [webFontSize, setWebFontSize] = useState(() => getStoredFontSize("webFontSize", 14));
  const [terminalFontSize, setTerminalFontSize] = useState(() => getStoredFontSize("terminalFontSize", 14));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const focusedSessionId = activeSessions[focusedIndex] ?? null;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const settingsRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [splitRatio, setSplitRatio] = useState(() => {
    const v = localStorage.getItem("splitRatio");
    return v ? Number(v) : 0.5;
  });
  const splitDragging = useRef(false);
  const terminalAreaRef = useRef<HTMLElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

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
    setSessions([]);
    setActiveSessions([]);
    setFocusedIndex(0);
    setMountedSessions([]);
    setSessionActivity({});
  }, []);

  const fetchSessions = useCallback(async () => {
    if (authenticated !== true) return;
    try {
      const res = await apiFetch("/api/sessions");
      if (res.status === 401) {
        resetClientState(false);
        return;
      }
      if (res.ok) {
        const data: Session[] = await res.json();
        setAuthenticated(true);
        setSessions(data);
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
    localStorage.setItem("splitRatio", String(splitRatio));
  }, [splitRatio]);

  const handleSplitDragStart = useCallback((e: React.MouseEvent) => {
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
  }, []);

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
    void fetchSessions();
    pollRef.current = setInterval(fetchSessions, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [authenticated, fetchSessions]);

  const handleLogin = useCallback(() => {
    setAuthenticated(true);
    void fetchSessions();
  }, [fetchSessions]);

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
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        const name = session?.name || "Session";
        playNotificationSound();
        sendBrowserNotification("Remote Code", `${name} - Task completed`);
      }
    },
    [],
  );

  const handleSessionCreated = (id: string) => {
    setShowNewSession(false);
    selectSession(id);
    void fetchSessions();
  };

  const removeFromActiveSessions = (id: string) => {
    setActiveSessions((prev) => {
      const next = prev.filter((sid) => sid !== id);
      if (next.length === 0) setFocusedIndex(0);
      else setFocusedIndex((fi) => Math.min(fi, next.length - 1));
      return next;
    });
  };

  const handleSuspend = async (id: string) => {
    try {
      await apiFetch(`/api/sessions/${id}/suspend`, {
        method: "POST",
      });
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void fetchSessions();
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
      void fetchSessions();
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
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void fetchSessions();
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
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void fetchSessions();
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
      void fetchSessions();
    } catch (e) {
      console.error("Failed to rename session:", e);
      throw e;
    }
  };

  const handleReorder = async (orderedIds: string[]) => {
    try {
      await apiFetch("/api/sessions/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      void fetchSessions();
    } catch (e) {
      console.error("Failed to reorder sessions:", e);
    }
  };

  if (authenticated === null) {
    return <div className="app-container" />;
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app-container" style={viewportHeight ? { height: viewportHeight } : undefined}>
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
            <strong>{sessions.length}</strong>
            <span>sessions</span>
          </div>
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

      <div className="app-body">
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {sidebarOpen && (
          <>
            <aside className="sidebar workbench-card" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              <SessionList
                sessions={sessions}
                activeSessions={activeSessions}
                focusedSessionId={focusedSessionId}
                sessionActivity={sessionActivity}
                onSelect={selectSession}
                onResume={handleResume}
                onNewSession={() => setShowNewSession(true)}
                onDelete={handleDelete}
                onRename={handleRename}
                onSuspend={handleSuspend}
                onTerminate={handleTerminate}
                onReorder={handleReorder}
              />
            </aside>
            <div className="sidebar-resize" onMouseDown={handleSidebarDragStart} />
          </>
        )}

        <main className="terminal-area workbench-card" ref={terminalAreaRef}>
          {mountedSessions.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__eyebrow">Workbench Ready</span>
              <h1 className="empty-state__title">Open a session to start working</h1>
              <p className="empty-state__body">
                Sessions stay docked in the left rail while the terminal remains the primary workspace.
                Create a new session when you need a fresh console context.
              </p>
              <button className="primary-button" onClick={() => setShowNewSession(true)}>
                Create Session
              </button>
            </div>
          )}

          {mountedSessions.map((sid) => {
            const panelIndex = activeSessions.indexOf(sid);
            const isVisible = panelIndex !== -1;
            const splitMode = activeSessions.length === 2;
            const session = sessions.find((s) => s.id === sid);
            const sessionName = session?.name || "Session";
            const sessionWorkPath = session?.work_path || "";

            if (session?.cli_type === "opencode-web") {
              return (
                <OpenCodeWebViewer
                  key={sid}
                  onClose={() => {
                    setActiveSessions((prev) => prev.filter((s) => s !== sid));
                    setMountedSessions((prev) => prev.filter((s) => s !== sid));
                  }}
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
                sessionName={sessionName}
                workPath={sessionWorkPath}
                onClosePanel={() => {
                  if (panelIndex !== -1) closeSplitPanel(panelIndex);
                }}
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
              onMouseDown={handleSplitDragStart}
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

      {showNewSession && (
        <NewSession
          onCreated={handleSessionCreated}
          onCancel={() => setShowNewSession(false)}
        />
      )}
    </div>
  );
}
