import { useState, useEffect, useCallback, useRef } from "react";
import Login from "./components/Login";
import SessionList from "./components/SessionList";
import NewSession from "./components/NewSession";
import Terminal from "./components/Terminal";
import type { ActivityState } from "./components/Terminal";
import {
  playNotificationSound,
  requestNotificationPermission,
  sendBrowserNotification,
} from "./utils/notify";
import type { Session } from "./types/session";
import "./App.css";

function getStoredToken(): string | null {
  return localStorage.getItem("token");
}

function getStoredFontSize(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v ? Number(v) : fallback;
}

export default function App() {
  const [token, setToken] = useState<string | null>(getStoredToken);
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

  // Track visual viewport to handle mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // Only apply on mobile-sized screens
      if (window.innerWidth > 768) { setViewportHeight(null); return; }
      // If viewport is significantly smaller than window, keyboard is open
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
      const newWidth = Math.max(180, Math.min(ev.clientX, 500));
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
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/sessions", { headers: authHeaders() });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions(data);
      }
    } catch {
      // ignore
    }
  }, [token, authHeaders]);

  // Persist font sizes
  useEffect(() => {
    localStorage.setItem("webFontSize", String(webFontSize));
    document.documentElement.style.setProperty("--web-fs", webFontSize + "px");
    document.documentElement.style.setProperty("--web-fs-sm", (webFontSize - 1) + "px");
    document.documentElement.style.setProperty("--web-fs-xs", (webFontSize - 3) + "px");
    document.documentElement.style.setProperty("--web-fs-xxs", (webFontSize - 4) + "px");
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
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Close settings when clicking outside
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

  // Request notification permission on login
  useEffect(() => {
    if (token) {
      requestNotificationPermission();
    }
  }, [token]);

  // 5s polling
  useEffect(() => {
    if (!token) return;
    fetchSessions();
    pollRef.current = setInterval(fetchSessions, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, fetchSessions]);

  const handleLogin = (newToken: string) => {
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setSessions([]);
    setActiveSessions([]);
    setFocusedIndex(0);
    setMountedSessions([]);
    setSessionActivity({});
  };

  const isMobile = () => window.innerWidth <= 768;

  const selectSession = (id: string, split = false) => {
    const forceSingle = isMobile() ? true : !split;

    if (forceSingle) {
      // Single mode
      setActiveSessions([id]);
      setFocusedIndex(0);
    } else {
      // Split mode
      setActiveSessions((prev) => {
        if (prev.length < 2) {
          if (prev.includes(id)) return prev; // already shown
          return [...prev, id];
        } else {
          // Replace focused panel
          const newArr = [...prev];
          newArr[focusedIndex] = id;
          return newArr;
        }
      });
      if (activeSessions.length < 2) {
        setFocusedIndex(1);
      }
    }

    // Clear "done" badge when viewing
    setSessionActivity((prev) => {
      if (prev[id] === "done") {
        return { ...prev, [id]: "idle" };
      }
      return prev;
    });
    if (!mountedSessions.includes(id)) {
      setMountedSessions((prev) => [...prev, id]);
    }
    // Auto-close sidebar on mobile
    if (isMobile()) setSidebarOpen(false);
  };

  const closeSplitPanel = (index: number) => {
    setActiveSessions((prev) => {
      const remaining = prev.filter((_, i) => i !== index);
      return remaining;
    });
    setFocusedIndex(0);
  };

  const handleActivityChange = useCallback(
    (sessionId: string, state: ActivityState) => {
      const isViewing = activeSessionsRef.current.includes(sessionId);

      setSessionActivity((prev) => {
        // If user is currently viewing this session and it's "done", set idle instead
        if (state === "done" && isViewing) {
          return { ...prev, [sessionId]: "idle" };
        }
        return { ...prev, [sessionId]: state };
      });

      // Notify when done and not viewing that session
      if (state === "done" && !isViewing) {
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        const name = session?.name || "Session";
        playNotificationSound();
        sendBrowserNotification("Remote Code", `${name} - Task completed`);
      }
    },
    []
  );

  const handleSessionCreated = (id: string) => {
    setShowNewSession(false);
    selectSession(id);
    fetchSessions();
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
      await fetch(`/api/sessions/${id}/suspend`, {
        method: "POST",
        headers: authHeaders(),
      });
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      fetchSessions();
    } catch (e) {
      console.error("Failed to suspend session:", e);
    }
  };

  const handleResume = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/resume`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        selectSession(id);
      }
      fetchSessions();
    } catch (e) {
      console.error("Failed to resume session:", e);
    }
  };

  const handleTerminate = async (id: string) => {
    try {
      await fetch(`/api/sessions/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      fetchSessions();
    } catch (e) {
      console.error("Failed to terminate session:", e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/sessions/${id}?permanent=true`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      removeFromActiveSessions(id);
      setMountedSessions((prev) => prev.filter((sid) => sid !== id));
      setSessionActivity((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      fetchSessions();
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await fetch(`/api/sessions/${id}/rename`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: newName }),
      });
      fetchSessions();
    } catch (e) {
      console.error("Failed to rename session:", e);
    }
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app-container" style={viewportHeight ? { height: viewportHeight } : undefined}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {"\u2630"}
          </button>
          <span className="app-title">Remote Code</span>
        </div>
        <div className="header-right" ref={settingsRef}>
          <button
            className="settings-btn"
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
                  <button
                    className="size-btn"
                    onClick={() => setWebFontSize((s) => Math.max(10, s - 1))}
                  >
                    −
                  </button>
                  <span className="size-value">{webFontSize}px</span>
                  <button
                    className="size-btn"
                    onClick={() => setWebFontSize((s) => Math.min(24, s + 1))}
                  >
                    +
                  </button>
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
        {/* Sidebar backdrop (mobile) */}
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
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
              />
            </aside>
            <div className="sidebar-resize" onMouseDown={handleSidebarDragStart} />
          </>
        )}

        {/* Terminal Area */}
        <main className="terminal-area" ref={terminalAreaRef}>
          {mountedSessions.length === 0 && (
            <div className="empty-state">
              <p>No active session</p>
              <button
                className="create-btn"
                onClick={() => setShowNewSession(true)}
              >
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
            return (
              <Terminal
                key={sid}
                sessionId={sid}
                token={token}
                visible={isVisible}
                fontSize={terminalFontSize}
                onFontSizeChange={(d) => setTerminalFontSize((s) => Math.max(8, Math.min(28, s + d)))}
                onActivityChange={handleActivityChange}
                panelIndex={panelIndex}
                splitMode={splitMode}
                splitRatio={splitRatio}
                isFocused={isVisible && panelIndex === focusedIndex}
                onFocus={() => { if (panelIndex !== -1) setFocusedIndex(panelIndex); }}
                sessionName={sessionName}
                workPath={sessionWorkPath}
                onClosePanel={() => { if (panelIndex !== -1) closeSplitPanel(panelIndex); }}
                onSuspend={() => handleSuspend(sid)}
                onMaximize={() => selectSession(sid)}
                onTerminate={() => handleTerminate(sid)}
              />
            );
          })}

          {/* Split divider handle */}
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
              <div style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 2,
                width: 2,
                background: splitDragging.current ? "#89b4fa" : "#313244",
                transition: "background 0.15s",
              }} />
            </div>
          )}
        </main>
      </div>

      {/* New Session Modal */}
      {showNewSession && (
        <NewSession
          token={token}
          onCreated={handleSessionCreated}
          onCancel={() => setShowNewSession(false)}
        />
      )}
    </div>
  );
}
