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
import "./App.css";

interface Session {
  id: string;
  name: string;
  work_path: string;
  status: string;
  created_at: string;
  last_accessed_at: string;
  claude_session_id: string | null;
}

function getStoredToken(): string | null {
  return localStorage.getItem("token");
}

export default function App() {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mountedSessions, setMountedSessions] = useState<string[]>([]);
  const [sessionActivity, setSessionActivity] = useState<Record<string, ActivityState>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

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
    setActiveSessionId(null);
    setMountedSessions([]);
    setSessionActivity({});
  };

  const selectSession = (id: string) => {
    setActiveSessionId(id);
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
  };

  const handleActivityChange = useCallback(
    (sessionId: string, state: ActivityState) => {
      setSessionActivity((prev) => {
        // If user is currently viewing this session and it's "done", set idle instead
        if (state === "done" && activeSessionIdRef.current === sessionId) {
          return { ...prev, [sessionId]: "idle" };
        }
        return { ...prev, [sessionId]: state };
      });

      // Notify when done and not viewing that session
      if (state === "done" && activeSessionIdRef.current !== sessionId) {
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        const name = session?.name || "Session";
        playNotificationSound();
        sendBrowserNotification("Claude Code Remote", `${name} - Task completed`);
      }
    },
    []
  );

  const handleSessionCreated = (id: string) => {
    setShowNewSession(false);
    selectSession(id);
    fetchSessions();
  };

  const handleSuspend = async (id: string) => {
    await fetch(`/api/sessions/${id}/suspend`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (activeSessionId === id) setActiveSessionId(null);
    setMountedSessions((prev) => prev.filter((sid) => sid !== id));
    setSessionActivity((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    fetchSessions();
  };

  const handleResume = async (id: string) => {
    const res = await fetch(`/api/sessions/${id}/resume`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) {
      selectSession(id);
    }
    fetchSessions();
  };

  const handleTerminate = async (id: string) => {
    await fetch(`/api/sessions/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (activeSessionId === id) setActiveSessionId(null);
    setMountedSessions((prev) => prev.filter((sid) => sid !== id));
    setSessionActivity((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    fetchSessions();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/sessions/${id}?permanent=true`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (activeSessionId === id) setActiveSessionId(null);
    setMountedSessions((prev) => prev.filter((sid) => sid !== id));
    setSessionActivity((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    fetchSessions();
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app-container">
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
          <span className="app-title">Claude Code Remote</span>
        </div>
        <button className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              sessionActivity={sessionActivity}
              onSelect={selectSession}
              onSuspend={handleSuspend}
              onResume={handleResume}
              onTerminate={handleTerminate}
              onDelete={handleDelete}
              onNewSession={() => setShowNewSession(true)}
            />
          </aside>
        )}

        {/* Terminal Area */}
        <main className="terminal-area">
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

          {mountedSessions.map((sid) => (
            <Terminal
              key={sid}
              sessionId={sid}
              token={token}
              visible={sid === activeSessionId}
              onActivityChange={handleActivityChange}
            />
          ))}
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
