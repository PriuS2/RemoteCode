import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Login from "./components/Login";
import SessionList from "./components/SessionList";
import NewProject from "./components/NewSession";
import AddSessionModal from "./components/AddSessionModal";
import FileExplorer from "./components/FileExplorer";
import GitPanel from "./components/GitPanel";
import IdeWorkbench from "./components/IdeWorkbench";
import PanelSessionView from "./components/PanelSessionView";
import PersistentTerminal from "./components/PersistentTerminal";
import TerminalMountSlot from "./components/TerminalMountSlot";
import type { ActivityState } from "./components/Terminal";
import PaneLayout from "./components/PaneLayout";
import LayoutDropSurface, { type LayoutDropIndicator } from "./components/LayoutDropSurface";
import SessionStatePane from "./components/SessionStatePane";
import {
  playNotificationSound,
  requestNotificationPermission,
  sendBrowserNotification,
} from "./utils/notify";
import { apiFetch, onAuthExpired, readErrorDetail } from "./utils/api";
import {
  collectSessionIds,
  createSingleLayout,
  findLeafByPaneId,
  findPaneIdBySessionId,
  getFirstLeaf,
  placeSessionInPane,
  pruneMissingSessions,
  removeSessionFromLayout,
  restoreLayout,
  updateSplitRatio,
  type LayoutNode,
} from "./utils/layout";
import {
  isPersistentTerminalSession,
  mergePersistentTerminalSessionIds,
  prunePersistentTerminalSessionIds,
} from "./utils/persistentTerminalRegistry";
import { getSessionDragData, hasSessionDragData } from "./utils/sessionDragData";
import type { Project } from "./types/project";
import type { Session } from "./types/session";
import type { ProjectLayoutResponse } from "./types/api";
import {
  canUseLocalDesktopFeatures,
  focusDesktopWindow,
  getCurrentDesktopVersion,
  getDesktopRuntimeInfo,
  getDesktopPreferences,
  getLaunchContext,
  getLatestUpdateManifest,
  isDesktopChromium,
  installDesktopExternalLinkHandler,
  installDesktopShortcutGuard,
  listOpenWindows,
  openProjectWindow as openDesktopProjectWindow,
  openSessionWindow as openDesktopSessionWindow,
  recordRecentProject,
  removeRecentProject,
  setDesktopBadgeCount,
  setDesktopFocusContext,
  subscribeDesktopCommand,
  subscribeDesktopWindowRegistry,
  syncDesktopPresence,
  updateDesktopPreferences,
  type DesktopFocusContext,
  type DesktopLaunchContext,
  type DesktopPreferences,
  type DesktopWindowSummary,
  type UpdateManifest,
} from "./runtime";
import "./App.css";

type ThemeMode = "light" | "dark";
type WorkspaceMode = "ephemeral" | "project-layout";
type PanelSession = Session & { cli_type: "folder" | "git" | "ide" };
interface OpenAloneSnapshot {
  layout: LayoutNode | null;
  focusedPaneId: string | null;
  workspaceMode: WorkspaceMode;
  layoutOwnerProjectId: string | null;
  sourceSessionId: string;
}

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

function isPanelSession(session: Session | undefined): session is PanelSession {
  return session?.cli_type === "folder" || session?.cli_type === "git" || session?.cli_type === "ide";
}

function getStoredFontSize(key: string, fallback: number): number {
  const value = localStorage.getItem(key);
  return value ? Number(value) : fallback;
}

function getStoredTheme(): ThemeMode {
  return localStorage.getItem("theme") === "dark" ? "dark" : "light";
}

function getPaneTitle(session: Session): string {
  switch (session.cli_type) {
    case "folder":
      return "Folder";
    case "git":
      return "Git";
    case "ide":
      return "IDE";
    case "claude":
      return "Claude";
    case "kilo":
      return "Kilo";
    case "opencode":
      return "OpenCode";
    case "terminal":
      return "Terminal";
    case "custom":
      return "Custom";
    default:
      return "Session";
  }
}

function buildDefaultProjectLayout(project: Project): LayoutNode | null {
  const preferredSession = project.sessions.find((session) => session.status === "active") ?? project.sessions[0];
  return preferredSession ? createSingleLayout(preferredSession.id) : null;
}

function getDisplayLayout(layout: LayoutNode | null, focusedPaneId: string | null, isMobileViewport: boolean): LayoutNode | null {
  if (!layout) return null;
  if (!isMobileViewport) return layout;
  return findLeafByPaneId(layout, focusedPaneId) ?? getFirstLeaf(layout);
}

function describeDesktopWindow(entry: DesktopWindowSummary): string {
  if (entry.role === "project") {
    return entry.projectName ? `${entry.projectName} window` : "project window";
  }
  if (entry.role === "session") {
    return entry.sessionName ? `${entry.sessionName} window` : "session window";
  }
  return "main window";
}

function normalizeOwnedSessionIds(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value))).sort();
}

function buildDesktopPresencePayloadKey(payload: {
  projectId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  workPath?: string | null;
  ownedSessionIds?: string[];
}): string {
  return JSON.stringify({
    projectId: payload.projectId ?? null,
    projectName: payload.projectName ?? null,
    sessionId: payload.sessionId ?? null,
    sessionName: payload.sessionName ?? null,
    workPath: payload.workPath ?? null,
    ownedSessionIds: normalizeOwnedSessionIds(payload.ownedSessionIds ?? []),
  });
}

function buildDesktopWindowRegistryKey(windows: DesktopWindowSummary[]): string {
  return JSON.stringify(
    windows.map((entry) => ({
      windowId: entry.windowId,
      role: entry.role,
      projectId: entry.projectId ?? null,
      sessionId: entry.sessionId ?? null,
      title: entry.title,
      hidden: Boolean(entry.hidden),
      focused: Boolean(entry.focused),
      ownedSessionIds: normalizeOwnedSessionIds(entry.ownedSessionIds),
    })),
  );
}

function buildDesktopFocusContextKey(context: DesktopFocusContext): string {
  return JSON.stringify({
    kind: context.kind,
    sessionType: context.sessionType ?? null,
  });
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoadedOnce, setProjectsLoadedOnce] = useState(false);
  const [layoutRoot, setLayoutRoot] = useState<LayoutNode | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("ephemeral");
  const [layoutOwnerProjectId, setLayoutOwnerProjectId] = useState<string | null>(null);
  const [layoutIndicator, setLayoutIndicator] = useState<LayoutDropIndicator | null>(null);
  const [draggedLayoutSessionId, setDraggedLayoutSessionId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem("sidebarWidth");
    return stored ? Number(stored) : 260;
  });
  const [sessionActivity, setSessionActivity] = useState<Record<string, ActivityState>>({});
  const [sessionRefreshNonce, setSessionRefreshNonce] = useState<Record<string, number>>({});
  const [persistentTerminalSessionIds, setPersistentTerminalSessionIds] = useState<string[]>([]);
  const [terminalHostElements, setTerminalHostElements] = useState<Record<string, { element: HTMLDivElement; paneId: string }>>({});
  const [terminalKeepAliveRoot, setTerminalKeepAliveRoot] = useState<HTMLDivElement | null>(null);
  const [openAloneSnapshot, setOpenAloneSnapshot] = useState<OpenAloneSnapshot | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [webFontSize, setWebFontSize] = useState(() => getStoredFontSize("webFontSize", 14));
  const [terminalFontSize, setTerminalFontSize] = useState(() => getStoredFontSize("terminalFontSize", 14));
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 768);
  const [openingConfigPath, setOpeningConfigPath] = useState(false);
  const [desktopLaunchContext, setDesktopLaunchContext] = useState<DesktopLaunchContext | null>(null);
  const [desktopWindows, setDesktopWindows] = useState<DesktopWindowSummary[]>([]);
  const [desktopPreferencesState, setDesktopPreferencesState] = useState<DesktopPreferences | null>(null);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);
  const [latestUpdateManifest, setLatestUpdateManifest] = useState<UpdateManifest | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const workbenchAreaRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const launchContextHandledRef = useRef(false);
  const sessions = useMemo(() => flattenProjects(projects), [projects]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const desktopFocusContextRef = useRef<DesktopFocusContext>({ kind: "form" });
  const lastPresencePayloadRef = useRef("");
  const lastBadgeCountRef = useRef<number | null>(null);
  const lastRecordedRecentProjectIdRef = useRef<string | null>(null);
  const lastFocusContextRef = useRef("");
  const lastDesktopWindowsKeyRef = useRef("");
  const desktopDebugPerfRef = useRef(false);
  const desktopPerfCounterRef = useRef<Record<string, number>>({});
  const logDesktopPerf = useCallback((eventName: string, detail?: Record<string, unknown>) => {
    if (!desktopDebugPerfRef.current) {
      return;
    }
    desktopPerfCounterRef.current[eventName] = (desktopPerfCounterRef.current[eventName] ?? 0) + 1;
    const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
    console.info(`[remote-code-desktop][renderer][perf] ${eventName}#${desktopPerfCounterRef.current[eventName]}${suffix}`);
  }, []);
  const applyDesktopWindows = useCallback((windows: DesktopWindowSummary[]) => {
    const key = buildDesktopWindowRegistryKey(windows);
    if (key === lastDesktopWindowsKeyRef.current) {
      logDesktopPerf("registry-skip", { windows: windows.length });
      return;
    }
    lastDesktopWindowsKeyRef.current = key;
    logDesktopPerf("registry-apply", { windows: windows.length });
    setDesktopWindows(windows);
  }, [logDesktopPerf]);
  const layoutSessionIds = useMemo(() => collectSessionIds(layoutRoot), [layoutRoot]);
  const visibleSessionIdsRef = useRef(layoutSessionIds);
  visibleSessionIdsRef.current = layoutSessionIds;
  const displayedLayout = useMemo(
    () => getDisplayLayout(layoutRoot, focusedPaneId, isMobileViewport),
    [focusedPaneId, isMobileViewport, layoutRoot],
  );
  const focusedLeaf = useMemo(
    () => findLeafByPaneId(layoutRoot, focusedPaneId) ?? getFirstLeaf(layoutRoot),
    [focusedPaneId, layoutRoot],
  );
  const focusedSessionId = focusedLeaf?.sessionId ?? null;
  const restoreLayoutSessionId = useMemo(() => {
    if (!openAloneSnapshot) {
      return null;
    }
    if (workspaceMode !== "ephemeral" || layoutRoot?.type !== "leaf") {
      return null;
    }
    return layoutRoot.sessionId === openAloneSnapshot.sourceSessionId ? layoutRoot.sessionId : null;
  }, [layoutRoot, openAloneSnapshot, workspaceMode]);
  const persistentTerminalSessions = useMemo(() => {
    return persistentTerminalSessionIds
      .map((sessionId) => findSession(projects, sessionId))
      .filter((session): session is Session => Boolean(
        session && session.status === "active" && isPersistentTerminalSession(session),
      ));
  }, [persistentTerminalSessionIds, projects]);
  const canOpenConfigPath = canUseLocalDesktopFeatures();
  const currentWindowId = desktopLaunchContext?.windowId ?? null;
  const externalSessionOwners = useMemo(() => {
    const next = new Map<string, DesktopWindowSummary>();
    desktopWindows.forEach((entry) => {
      if (entry.windowId === currentWindowId) {
        return;
      }
      entry.ownedSessionIds.forEach((sessionId) => {
        if (!next.has(sessionId)) {
          next.set(sessionId, entry);
        }
      });
    });
    return next;
  }, [currentWindowId, desktopWindows]);
  const ownedSessionIds = useMemo(
    () => layoutSessionIds.filter((sessionId) => !externalSessionOwners.has(sessionId)),
    [externalSessionOwners, layoutSessionIds],
  );
  const readyBadgeCount = useMemo(
    () => Object.values(sessionActivity).filter((state) => state === "done").length,
    [sessionActivity],
  );
  const focusedSession = useMemo(
    () => (focusedSessionId ? findSession(projects, focusedSessionId) : undefined),
    [focusedSessionId, projects],
  );
  const desktopWindowProject = useMemo(() => {
    if (desktopLaunchContext?.role === "project" && desktopLaunchContext.projectId) {
      return findProject(projects, desktopLaunchContext.projectId) ?? null;
    }
    if (desktopLaunchContext?.role === "session" && desktopLaunchContext.projectId) {
      return findProject(projects, desktopLaunchContext.projectId) ?? null;
    }
    if (workspaceMode === "project-layout" && layoutOwnerProjectId) {
      return findProject(projects, layoutOwnerProjectId) ?? null;
    }
    if (focusedSession?.project_id) {
      return findProject(projects, focusedSession.project_id) ?? null;
    }
    return null;
  }, [desktopLaunchContext, focusedSession, layoutOwnerProjectId, projects, workspaceMode]);
  const desktopWindowSession = useMemo(() => {
    if (desktopLaunchContext?.role === "session" && desktopLaunchContext.sessionId) {
      return findSession(projects, desktopLaunchContext.sessionId) ?? null;
    }
    return null;
  }, [desktopLaunchContext, projects]);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLayoutSaveRef = useRef<{ projectId: string; layout: LayoutNode | null } | null>(null);
  const savingLayoutRef = useRef(false);
  const skipNextAutosaveRef = useRef(false);

  const clearLayoutSaveTimer = useCallback(() => {
    if (layoutSaveTimerRef.current) {
      clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
  }, []);

  const clearOpenAloneSnapshot = useCallback(() => {
    setOpenAloneSnapshot(null);
  }, []);

  const findExternalOwner = useCallback((sessionId: string) => {
    return externalSessionOwners.get(sessionId) ?? null;
  }, [externalSessionOwners]);

  const focusExternalOwner = useCallback(async (sessionId: string) => {
    const owner = externalSessionOwners.get(sessionId);
    if (!owner) {
      return false;
    }
    await focusDesktopWindow(owner.windowId);
    return true;
  }, [externalSessionOwners]);

  const bumpSessionRefresh = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    setSessionRefreshNonce((prev) => {
      const next = { ...prev };
      sessionIds.forEach((sessionId) => {
        next[sessionId] = (next[sessionId] ?? 0) + 1;
      });
      return next;
    });
  }, []);

  const ensurePersistentTerminals = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }
    setPersistentTerminalSessionIds((prev) => {
      const next = mergePersistentTerminalSessionIds(prev, sessionIds, sessionsRef.current);
      if (next.length === prev.length && next.every((sessionId, index) => sessionId === prev[index])) {
        return prev;
      }
      return next;
    });
  }, []);

  const removePersistentTerminals = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }
    const removedIds = new Set(sessionIds);
    setPersistentTerminalSessionIds((prev) => {
      const next = prev.filter((sessionId) => !removedIds.has(sessionId));
      return next.length === prev.length ? prev : next;
    });
    setTerminalHostElements((prev) => {
      const nextEntries = Object.entries(prev).filter(([sessionId]) => !removedIds.has(sessionId));
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries) as Record<string, { element: HTMLDivElement; paneId: string }>;
    });
  }, []);

  const handleTerminalHostChange = useCallback((sessionId: string, paneId: string, element: HTMLDivElement | null) => {
    setTerminalHostElements((prev) => {
      if (!element) {
        if (!(sessionId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }

      const current = prev[sessionId];
      if (current?.element === element && current.paneId === paneId) {
        return prev;
      }

      return {
        ...prev,
        [sessionId]: { element, paneId },
      };
    });
  }, []);

  const applyWorkspaceLayout = useCallback((
    nextLayout: LayoutNode | null,
    options: {
      mode: WorkspaceMode;
      ownerProjectId?: string | null;
      focusedPaneId?: string | null;
      skipAutosave?: boolean;
      refreshSessionIds?: string[];
    },
  ) => {
    if (options.skipAutosave && options.mode === "project-layout") {
      skipNextAutosaveRef.current = true;
    }

    const normalizedLayout = nextLayout ? restoreLayout(nextLayout) : null;
    ensurePersistentTerminals(collectSessionIds(normalizedLayout));
    const nextFocusedPaneId = options.focusedPaneId ?? getFirstLeaf(normalizedLayout)?.paneId ?? null;
    setWorkspaceMode(options.mode);
    setLayoutOwnerProjectId(options.ownerProjectId ?? null);
    setLayoutIndicator(null);
    setLayoutRoot(normalizedLayout);
    setFocusedPaneId(nextFocusedPaneId);
    if (options.refreshSessionIds?.length) {
      bumpSessionRefresh(options.refreshSessionIds);
    }
    if (isMobileViewport) {
      setSidebarOpen(false);
    }
  }, [bumpSessionRefresh, ensurePersistentTerminals, isMobileViewport]);

  const resetClientState = useCallback((isAuthenticated: boolean) => {
    localStorage.removeItem("token");
    launchContextHandledRef.current = false;
    lastPresencePayloadRef.current = "";
    lastBadgeCountRef.current = null;
    lastRecordedRecentProjectIdRef.current = null;
    lastFocusContextRef.current = "";
    lastDesktopWindowsKeyRef.current = "";
    setAuthenticated(isAuthenticated);
    setProjects([]);
    setProjectsLoadedOnce(false);
    setLayoutRoot(null);
    setFocusedPaneId(null);
    setWorkspaceMode("ephemeral");
    setLayoutOwnerProjectId(null);
    setLayoutIndicator(null);
    setDraggedLayoutSessionId(null);
    setShowNewProject(false);
    setNewSessionProjectId(null);
    setSessionActivity({});
    setSessionRefreshNonce({});
    setPersistentTerminalSessionIds([]);
    setTerminalHostElements({});
    setOpenAloneSnapshot(null);
    pendingLayoutSaveRef.current = null;
    skipNextAutosaveRef.current = false;
    clearLayoutSaveTimer();
  }, [clearLayoutSaveTimer]);

  const fetchProjects = useCallback(async () => {
    if (authenticated !== true) return undefined;
    try {
      const response = await apiFetch("/api/projects");
      if (response.status === 401) {
        resetClientState(false);
        return undefined;
      }
      if (!response.ok) {
        return undefined;
      }
      const data: Project[] = await response.json();
      setAuthenticated(true);
      setProjects(data);
      setProjectsLoadedOnce(true);
      return data;
    } catch {
      return undefined;
    }
  }, [authenticated, resetClientState]);

  const flushPendingLayoutSave = useCallback(async () => {
    if (savingLayoutRef.current) {
      return;
    }
    const pending = pendingLayoutSaveRef.current;
    if (!pending) {
      return;
    }

    pendingLayoutSaveRef.current = null;
    savingLayoutRef.current = true;
    try {
      const response = await apiFetch(`/api/projects/${pending.projectId}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: pending.layout }),
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to save layout.");
        throw new Error(detail.message);
      }
    } catch (error) {
      console.error("Failed to save layout:", error);
    } finally {
      savingLayoutRef.current = false;
      if (pendingLayoutSaveRef.current) {
        void flushPendingLayoutSave();
      }
    }
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setIsMobileViewport(window.innerWidth <= 768);
      if (window.innerWidth > 768) {
        setViewportHeight(null);
        return;
      }
      const diff = window.innerHeight - vv.height;
      setViewportHeight(diff > 50 ? vv.height : null);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("webFontSize", String(webFontSize));
    document.documentElement.style.setProperty("--web-scale", String(webFontSize / 14));
    document.documentElement.style.setProperty("--web-fs", `${webFontSize}px`);
    document.documentElement.style.setProperty("--web-fs-sm", `${webFontSize - 1}px`);
    document.documentElement.style.setProperty("--web-fs-xs", `${webFontSize - 3}px`);
    document.documentElement.style.setProperty("--web-fs-xxs", `${webFontSize - 4}px`);
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
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    if (!showSettings) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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

  useEffect(() => installDesktopExternalLinkHandler(), []);

  useEffect(() => installDesktopShortcutGuard(() => desktopFocusContextRef.current), []);

  useEffect(() => {
    if (!isDesktopChromium()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const [runtimeInfo, launchContext, windows, preferences, version, manifest] = await Promise.all([
        getDesktopRuntimeInfo(),
        getLaunchContext(),
        listOpenWindows(),
        getDesktopPreferences(),
        getCurrentDesktopVersion(),
        getLatestUpdateManifest(),
      ]);

      if (cancelled) {
        return;
      }

      desktopDebugPerfRef.current = Boolean(runtimeInfo?.debugPerf);
      setDesktopLaunchContext(launchContext);
      applyDesktopWindows(windows);
      setDesktopPreferencesState(preferences);
      setDesktopVersion(version);
      setLatestUpdateManifest(manifest);
    })();

    const unsubscribeCommand = subscribeDesktopCommand((payload) => {
      if (payload.type === "new-project" && authenticated === true) {
        setShowNewProject(true);
      }
    });

    const unsubscribeRegistry = subscribeDesktopWindowRegistry((windows) => {
      applyDesktopWindows(windows);
    });

    return () => {
      cancelled = true;
      unsubscribeCommand();
      unsubscribeRegistry();
    };
  }, [applyDesktopWindows, authenticated]);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const response = await apiFetch("/api/auth/session", { skipAuthHandling: true });
        if (cancelled) return;
        setAuthenticated(response.ok);
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
        }
      }
    };

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated !== true) return;
    void fetchProjects();
    pollRef.current = setInterval(() => {
      void fetchProjects();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [authenticated, fetchProjects]);

  useEffect(() => {
    let nextContext: DesktopFocusContext = { kind: authenticated === true ? "panel" : "form" };
    if (authenticated === true && focusedSessionId) {
      const session = findSession(projects, focusedSessionId);
      if (session) {
        if (session.cli_type === "ide") {
          nextContext = { kind: "ide", sessionType: session.cli_type };
        } else if (session.cli_type === "folder" || session.cli_type === "git") {
          nextContext = { kind: "panel", sessionType: session.cli_type };
        } else {
          nextContext = { kind: "terminal", sessionType: session.cli_type };
        }
      }
    }
    const nextFocusContextKey = buildDesktopFocusContextKey(nextContext);
    desktopFocusContextRef.current = nextContext;
    if (nextFocusContextKey === lastFocusContextRef.current) {
      return;
    }
    lastFocusContextRef.current = nextFocusContextKey;
    logDesktopPerf("focus-context-send", {
      kind: nextContext.kind,
      sessionType: nextContext.sessionType ?? null,
    });
    setDesktopFocusContext(nextContext);
  }, [authenticated, focusedSessionId, logDesktopPerf, projects]);

  useEffect(() => {
    const validIds = new Set(sessions.map((session) => session.id));

    setLayoutRoot((prev) => {
      const next = pruneMissingSessions(prev, validIds);
      return next === prev ? prev : next;
    });

    setSessionActivity((prev) => {
      const next: Record<string, ActivityState> = {};
      Object.entries(prev).forEach(([sessionId, state]) => {
        if (validIds.has(sessionId)) next[sessionId] = state;
      });
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      if (
        prevEntries.length === nextEntries.length
        && prevEntries.every(([sessionId, state]) => next[sessionId] === state)
      ) {
        return prev;
      }
      return next;
    });

    setSessionRefreshNonce((prev) => {
      const next: Record<string, number> = {};
      Object.entries(prev).forEach(([sessionId, nonce]) => {
        if (validIds.has(sessionId)) next[sessionId] = nonce;
      });
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      if (
        prevEntries.length === nextEntries.length
        && prevEntries.every(([sessionId, nonce]) => next[sessionId] === nonce)
      ) {
        return prev;
      }
      return next;
    });

    setOpenAloneSnapshot((prev) => {
      if (!prev) {
        return prev;
      }
      const snapshotSessionIds = collectSessionIds(prev.layout);
      if (!validIds.has(prev.sourceSessionId) || snapshotSessionIds.some((sessionId) => !validIds.has(sessionId))) {
        return null;
      }
      return prev;
    });
  }, [sessions]);

  useEffect(() => {
    setPersistentTerminalSessionIds((prev) => {
      const next = prunePersistentTerminalSessionIds(prev, sessions);
      if (next.length === prev.length && next.every((sessionId, index) => sessionId === prev[index])) {
        return prev;
      }
      return next;
    });

    const validTerminalIds = new Set(
      sessions
        .filter((session) => session.status === "active" && isPersistentTerminalSession(session))
        .map((session) => session.id),
    );
    setTerminalHostElements((prev) => {
      const nextEntries = Object.entries(prev).filter(([sessionId]) => validTerminalIds.has(sessionId));
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries) as Record<string, { element: HTMLDivElement; paneId: string }>;
    });
  }, [sessions]);

  useEffect(() => {
    ensurePersistentTerminals(layoutSessionIds);
  }, [ensurePersistentTerminals, layoutSessionIds]);

  useEffect(() => {
    if (!layoutOwnerProjectId) return;
    if (findProject(projects, layoutOwnerProjectId)) return;
    setWorkspaceMode("ephemeral");
    setLayoutOwnerProjectId(null);
  }, [layoutOwnerProjectId, projects]);

  useEffect(() => {
    if (!layoutRoot) {
      if (focusedPaneId !== null) {
        setFocusedPaneId(null);
      }
      return;
    }
    if (focusedPaneId && findLeafByPaneId(layoutRoot, focusedPaneId)) {
      return;
    }
    const firstLeaf = getFirstLeaf(layoutRoot);
    if (firstLeaf && firstLeaf.paneId !== focusedPaneId) {
      setFocusedPaneId(firstLeaf.paneId);
    }
  }, [focusedPaneId, layoutRoot]);

  useEffect(() => {
    if (workspaceMode !== "project-layout" || !layoutOwnerProjectId) {
      pendingLayoutSaveRef.current = null;
      clearLayoutSaveTimer();
      skipNextAutosaveRef.current = false;
      return;
    }

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    pendingLayoutSaveRef.current = {
      projectId: layoutOwnerProjectId,
      layout: layoutRoot,
    };
    clearLayoutSaveTimer();
    layoutSaveTimerRef.current = setTimeout(() => {
      void flushPendingLayoutSave();
    }, 300);

    return clearLayoutSaveTimer;
  }, [clearLayoutSaveTimer, flushPendingLayoutSave, layoutOwnerProjectId, layoutRoot, workspaceMode]);

  const handleSidebarDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const nextWidth = Math.max(220, Math.min(moveEvent.clientX, 520));
      setSidebarWidth(nextWidth);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((width) => {
        localStorage.setItem("sidebarWidth", String(width));
        return width;
      });
      window.dispatchEvent(new Event("panel-resize-end"));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleLogin = useCallback(() => {
    setAuthenticated(true);
    void fetchProjects();
  }, [fetchProjects]);

  const applyTheme = useCallback((nextTheme: ThemeMode) => {
    if (nextTheme === theme) return;
    setTheme(nextTheme);
  }, [theme]);

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

  const handleOpenConfigPath = useCallback(async () => {
    setOpeningConfigPath(true);
    try {
      const response = await apiFetch("/api/open-config-path", { method: "POST" });
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to open config path.");
        throw new Error(detail.message);
      }
    } catch (error) {
      console.error("Failed to open config path:", error);
      const message = error instanceof Error ? error.message : "Failed to open config path.";
      window.alert(message);
    } finally {
      setOpeningConfigPath(false);
    }
  }, []);

  const removeSessionsFromWorkspace = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    const removed = new Set(sessionIds);
    clearOpenAloneSnapshot();
    removePersistentTerminals(sessionIds);
    setLayoutRoot((prev) => {
      let next = prev;
      sessionIds.forEach((sessionId) => {
        next = removeSessionFromLayout(next, sessionId);
      });
      return next;
    });
    setSessionActivity((prev) => {
      const next = { ...prev };
      sessionIds.forEach((sessionId) => delete next[sessionId]);
      return next;
    });
    setSessionRefreshNonce((prev) => {
      const next = { ...prev };
      sessionIds.forEach((sessionId) => delete next[sessionId]);
      return next;
    });
    if (focusedSessionId && removed.has(focusedSessionId)) {
      setFocusedPaneId(null);
    }
  }, [clearOpenAloneSnapshot, focusedSessionId, removePersistentTerminals]);

  const handleActivityChange = useCallback((sessionId: string, state: ActivityState) => {
    const isViewing = visibleSessionIdsRef.current.includes(sessionId);

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
  }, []);

  const handleCopyPath = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const ensureSessionReady = useCallback(async (sessionId: string, sourceProjects?: Project[]) => {
    let session = findSession(sourceProjects ?? projects, sessionId);
    if (!session) {
      const latestProjects = await fetchProjects();
      session = findSession(latestProjects ?? projects, sessionId);
    }

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === "active") {
      return session;
    }

    const response = await apiFetch(`/api/sessions/${sessionId}/resume`, {
      method: "POST",
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response, "Failed to resume session.");
      throw new Error(detail.message);
    }

    await fetchProjects();
    return await response.json() as Session;
  }, [fetchProjects, projects]);

  const ensureSessionsReady = useCallback(async (sessionIds: string[], sourceProjects?: Project[]) => {
    const uniqueSessionIds = Array.from(new Set(sessionIds));
    const projectSource = sourceProjects ?? projects;
    const sessionsById = new Map(flattenProjects(projectSource).map((session) => [session.id, session]));
    const readyIds = new Set<string>();
    const sessionsToResume: string[] = [];
    const failedIds = new Set<string>();

    uniqueSessionIds.forEach((sessionId) => {
      const session = sessionsById.get(sessionId);
      if (!session) {
        failedIds.add(sessionId);
        return;
      }
      if (session.status === "active") {
        readyIds.add(sessionId);
        return;
      }
      sessionsToResume.push(sessionId);
    });

    if (sessionsToResume.length > 0) {
      const results = await Promise.allSettled(
        sessionsToResume.map(async (sessionId) => {
          const response = await apiFetch(`/api/sessions/${sessionId}/resume`, {
            method: "POST",
          });
          if (!response.ok) {
            const detail = await readErrorDetail(response, "Failed to resume session.");
            throw new Error(detail.message);
          }
          return sessionId;
        }),
      );

      results.forEach((result, index) => {
        const sessionId = sessionsToResume[index];
        if (result.status === "fulfilled") {
          readyIds.add(sessionId);
          return;
        }
        failedIds.add(sessionId);
      });

      await fetchProjects();
    }

    return {
      readyIds: Array.from(readyIds),
      failedIds: Array.from(failedIds),
    };
  }, [fetchProjects, projects]);

  const openSessionEphemeral = useCallback(async (sessionId: string, sourceProjects?: Project[]) => {
    if (await focusExternalOwner(sessionId)) {
      return;
    }

    await ensureSessionReady(sessionId, sourceProjects);

    if (workspaceMode === "ephemeral" && layoutRoot?.type === "leaf" && layoutRoot.sessionId === sessionId) {
      bumpSessionRefresh([sessionId]);
      setFocusedPaneId(layoutRoot.paneId);
      if (isMobileViewport) {
        setSidebarOpen(false);
      }
      return;
    }

    clearOpenAloneSnapshot();
    applyWorkspaceLayout(createSingleLayout(sessionId), {
      mode: "ephemeral",
      ownerProjectId: null,
      refreshSessionIds: [sessionId],
    });
  }, [applyWorkspaceLayout, bumpSessionRefresh, clearOpenAloneSnapshot, ensureSessionReady, focusExternalOwner, isMobileViewport, layoutRoot, workspaceMode]);

  const openSessionAlone = useCallback(async (sessionId: string) => {
    if (!layoutRoot || layoutSessionIds.length <= 1 || isMobileViewport) {
      await openSessionEphemeral(sessionId);
      return;
    }

    const snapshot: OpenAloneSnapshot = {
      layout: layoutRoot,
      focusedPaneId,
      workspaceMode,
      layoutOwnerProjectId,
      sourceSessionId: sessionId,
    };

    await ensureSessionReady(sessionId);
    setOpenAloneSnapshot(snapshot);
    applyWorkspaceLayout(createSingleLayout(sessionId), {
      mode: "ephemeral",
      ownerProjectId: null,
      refreshSessionIds: [sessionId],
    });
  }, [
    applyWorkspaceLayout,
    ensureSessionReady,
    focusedPaneId,
    isMobileViewport,
    layoutOwnerProjectId,
    layoutRoot,
    layoutSessionIds.length,
    openSessionEphemeral,
    workspaceMode,
  ]);

  const handleRestoreOpenAloneLayout = useCallback(() => {
    if (!openAloneSnapshot) {
      return;
    }

    const snapshot = openAloneSnapshot;
    clearOpenAloneSnapshot();
    applyWorkspaceLayout(snapshot.layout, {
      mode: snapshot.workspaceMode,
      ownerProjectId: snapshot.layoutOwnerProjectId,
      focusedPaneId: snapshot.focusedPaneId,
      skipAutosave: snapshot.workspaceMode === "project-layout",
      refreshSessionIds: collectSessionIds(snapshot.layout),
    });
  }, [applyWorkspaceLayout, clearOpenAloneSnapshot, openAloneSnapshot]);

  const handleProjectCreated = useCallback((projectId: string) => {
    setShowNewProject(false);
    void projectId;
    void fetchProjects();
  }, [fetchProjects]);

  const handleSessionCreated = useCallback((sessionId: string) => {
    setNewSessionProjectId(null);
    void (async () => {
      const latestProjects = await fetchProjects();
      const currentSessionIds = collectSessionIds(layoutRoot);
      if (currentSessionIds.length === 0) {
        await openSessionEphemeral(sessionId, latestProjects);
      }
    })();
  }, [fetchProjects, openSessionEphemeral, layoutRoot]);

  const handleSuspend = useCallback(async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/sessions/${sessionId}/suspend`, {
        method: "POST",
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to suspend session.");
        throw new Error(detail.message);
      }
      removeSessionsFromWorkspace([sessionId]);
      void fetchProjects();
    } catch (error) {
      console.error("Failed to suspend session:", error);
    }
  }, [fetchProjects, removeSessionsFromWorkspace]);

  const handleResume = useCallback(async (sessionId: string) => {
    try {
      await ensureSessionReady(sessionId);
    } catch (error) {
      console.error("Failed to resume session:", error);
      throw error;
    }
  }, [ensureSessionReady]);

  const handleTerminate = useCallback(async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to kill session.");
        throw new Error(detail.message);
      }
      removeSessionsFromWorkspace([sessionId]);
      void fetchProjects();
    } catch (error) {
      console.error("Failed to terminate session:", error);
      throw error;
    }
  }, [fetchProjects, removeSessionsFromWorkspace]);

  const handleDelete = useCallback(async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/sessions/${sessionId}?permanent=true`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to delete session.");
        throw new Error(detail.message);
      }
      removeSessionsFromWorkspace([sessionId]);
      void fetchProjects();
    } catch (error) {
      console.error("Failed to delete session:", error);
      throw error;
    }
  }, [fetchProjects, removeSessionsFromWorkspace]);

  const handleRename = useCallback(async (sessionId: string, newName: string) => {
    const response = await apiFetch(`/api/sessions/${sessionId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response, "Failed to rename session.");
      throw new Error(detail.message);
    }
    void fetchProjects();
  }, [fetchProjects]);

  const handleRenameProject = useCallback(async (projectId: string, newName: string) => {
    const response = await apiFetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response, "Failed to rename project.");
      throw new Error(detail.message);
    }
    void fetchProjects();
  }, [fetchProjects]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const project = findProject(projects, projectId);
    const projectSessionIds = project?.sessions.map((session) => session.id) ?? [];
    const response = await apiFetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response, "Failed to delete project.");
      throw new Error(detail.message);
    }

    removeSessionsFromWorkspace(projectSessionIds);
    if (layoutOwnerProjectId === projectId) {
      setWorkspaceMode("ephemeral");
      setLayoutOwnerProjectId(null);
    }
    if (newSessionProjectId === projectId) {
      setNewSessionProjectId(null);
    }
    void removeRecentProject(projectId);
    void fetchProjects();
  }, [fetchProjects, layoutOwnerProjectId, newSessionProjectId, projects, removeSessionsFromWorkspace]);

  const handleReorderProjects = useCallback(async (orderedIds: string[]) => {
    try {
      await apiFetch("/api/projects/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      void fetchProjects();
    } catch (error) {
      console.error("Failed to reorder projects:", error);
    }
  }, [fetchProjects]);

  const handleReorderProjectSessions = useCallback(async (projectId: string, orderedIds: string[]) => {
    try {
      await apiFetch(`/api/projects/${projectId}/sessions/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      void fetchProjects();
    } catch (error) {
      console.error("Failed to reorder project sessions:", error);
    }
  }, [fetchProjects]);

  const handleAddSession = useCallback((project: Project) => {
    setNewSessionProjectId(project.id);
  }, []);

  const handleOpenProjectInNewWindow = useCallback((project: Project) => {
    void openDesktopProjectWindow(project.id, project.name, project.work_path);
  }, []);

  const handleOpenSessionInNewWindow = useCallback((session: Session, project: Project) => {
    void openDesktopSessionWindow(session.id, session.name, project.id, project.name, session.work_path);
  }, []);

  const handleOpenProjectLayout = useCallback(async (projectId: string) => {
    try {
      const latestProjects = await fetchProjects();
      const sourceProjects = latestProjects ?? projects;
      const project = findProject(sourceProjects, projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      const response = await apiFetch(`/api/projects/${projectId}/layout`);
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to load project layout.");
        throw new Error(detail.message);
      }

      const data: ProjectLayoutResponse = await response.json();
      let nextLayout = restoreLayout(data.layout);
      let skipAutosave = Boolean(nextLayout);

      if (!nextLayout) {
        nextLayout = buildDefaultProjectLayout(project);
        skipAutosave = false;
      }

      if (!nextLayout) {
        window.alert("이 프로젝트에는 열 수 있는 세션이 없습니다.");
        return;
      }

      const requestedSessionIds = collectSessionIds(nextLayout);
      const { readyIds, failedIds } = await ensureSessionsReady(requestedSessionIds, sourceProjects);
      const availableLayout = pruneMissingSessions(nextLayout, new Set(readyIds));

      if (!availableLayout) {
        window.alert("레이아웃에 포함된 세션을 열 수 없습니다.");
        return;
      }

      if (failedIds.length > 0) {
        const failedNames = failedIds.map((sessionId) => findSession(sourceProjects, sessionId)?.name ?? sessionId);
        window.alert(`일부 세션을 열지 못해 제외했습니다: ${failedNames.join(", ")}`);
      }

      clearOpenAloneSnapshot();
      applyWorkspaceLayout(availableLayout, {
        mode: "project-layout",
        ownerProjectId: projectId,
        skipAutosave,
        refreshSessionIds: collectSessionIds(availableLayout),
      });
    } catch (error) {
      console.error("Failed to open project layout:", error);
      const message = error instanceof Error ? error.message : "Failed to open project layout.";
      window.alert(message);
    }
  }, [applyWorkspaceLayout, clearOpenAloneSnapshot, ensureSessionsReady, fetchProjects, projects]);

  useEffect(() => {
    if (!isDesktopChromium() || authenticated !== true || !desktopLaunchContext || launchContextHandledRef.current) {
      return;
    }

    launchContextHandledRef.current = true;
    void (async () => {
      await fetchProjects();
      if (desktopLaunchContext.role === "project" && desktopLaunchContext.projectId) {
        await handleOpenProjectLayout(desktopLaunchContext.projectId);
        return;
      }
      if (desktopLaunchContext.role === "session" && desktopLaunchContext.sessionId) {
        await openSessionAlone(desktopLaunchContext.sessionId);
      }
    })();
  }, [authenticated, desktopLaunchContext, fetchProjects, handleOpenProjectLayout, openSessionAlone]);

  useEffect(() => {
    if (!isDesktopChromium() || !desktopLaunchContext) {
      return;
    }

    const payload = {
      projectId: desktopWindowProject?.id ?? desktopLaunchContext.projectId ?? null,
      projectName: desktopWindowProject?.name ?? desktopLaunchContext.projectName ?? null,
      sessionId: desktopWindowSession?.id ?? desktopLaunchContext.sessionId ?? null,
      sessionName: desktopWindowSession?.name ?? desktopLaunchContext.sessionName ?? null,
      workPath: desktopWindowProject?.work_path ?? desktopWindowSession?.work_path ?? desktopLaunchContext.workPath ?? null,
      ownedSessionIds,
    };
    const nextPresencePayloadKey = buildDesktopPresencePayloadKey(payload);
    if (nextPresencePayloadKey === lastPresencePayloadRef.current) {
      return;
    }
    lastPresencePayloadRef.current = nextPresencePayloadKey;
    logDesktopPerf("sync-presence-send", {
      role: desktopLaunchContext.role,
      ownedSessionCount: payload.ownedSessionIds.length,
    });
    syncDesktopPresence(payload);
  }, [desktopLaunchContext, desktopWindowProject, desktopWindowSession, logDesktopPerf, ownedSessionIds]);

  useEffect(() => {
    if (!isDesktopChromium()) {
      return;
    }
    if (lastBadgeCountRef.current === readyBadgeCount) {
      return;
    }
    lastBadgeCountRef.current = readyBadgeCount;
    logDesktopPerf("badge-send", { readyBadgeCount });
    void setDesktopBadgeCount(readyBadgeCount);
  }, [logDesktopPerf, readyBadgeCount]);

  useEffect(() => {
    if (!isDesktopChromium()) {
      return;
    }
    if (!desktopWindowProject) {
      lastRecordedRecentProjectIdRef.current = null;
      return;
    }
    const recentProjectKey = JSON.stringify({
      projectId: desktopWindowProject.id,
      name: desktopWindowProject.name,
      workPath: desktopWindowProject.work_path,
    });
    if (lastRecordedRecentProjectIdRef.current === recentProjectKey) {
      return;
    }
    lastRecordedRecentProjectIdRef.current = recentProjectKey;
    logDesktopPerf("recent-project-send", {
      projectId: desktopWindowProject.id,
    });
    void recordRecentProject(desktopWindowProject.id, desktopWindowProject.name, desktopWindowProject.work_path);
  }, [desktopWindowProject, logDesktopPerf]);

  useEffect(() => {
    if (!isDesktopChromium() || !desktopLaunchContext) {
      return;
    }
    if (!projectsLoadedOnce) {
      return;
    }
    if (desktopLaunchContext.role === "project" && desktopLaunchContext.projectId && !findProject(projects, desktopLaunchContext.projectId)) {
      window.close();
      return;
    }
    if (desktopLaunchContext.role === "session" && desktopLaunchContext.sessionId && !findSession(projects, desktopLaunchContext.sessionId)) {
      window.close();
    }
  }, [desktopLaunchContext, projects, projectsLoadedOnce]);

  const handleResizeSplit = useCallback((splitId: string, ratio: number) => {
    setLayoutRoot((prev) => updateSplitRatio(prev, splitId, ratio));
  }, []);

  const handleClosePane = useCallback((paneId: string) => {
    clearOpenAloneSnapshot();
    setLayoutRoot((prev) => {
      const leaf = findLeafByPaneId(prev, paneId);
      if (!prev || !leaf) return prev;
      return removeSessionFromLayout(prev, leaf.sessionId);
    });
  }, [clearOpenAloneSnapshot]);

  const handleDropIndicator = useCallback(async (sessionId: string, indicator: LayoutDropIndicator) => {
    try {
      if (await focusExternalOwner(sessionId)) {
        return;
      }

      await ensureSessionReady(sessionId);
      clearOpenAloneSnapshot();
      let nextFocusedPaneId: string | null = null;
      setLayoutRoot((prev) => {
        const next = placeSessionInPane(prev, sessionId, indicator.targetPaneId, indicator.zone);
        nextFocusedPaneId = findPaneIdBySessionId(next, sessionId);
        return next;
      });
      if (nextFocusedPaneId) {
        setFocusedPaneId(nextFocusedPaneId);
      }
    } catch (error) {
      console.error("Failed to place session in layout:", error);
      const message = error instanceof Error ? error.message : "Failed to place session in layout.";
      window.alert(message);
    } finally {
      setLayoutIndicator(null);
      setDraggedLayoutSessionId(null);
    }
  }, [clearOpenAloneSnapshot, ensureSessionReady, focusExternalOwner]);

  const handleDropIntoEmptyWorkspace = useCallback(async (sessionId: string) => {
    try {
      if (await focusExternalOwner(sessionId)) {
        return;
      }

      await ensureSessionReady(sessionId);
      clearOpenAloneSnapshot();
      applyWorkspaceLayout(createSingleLayout(sessionId), {
        mode: workspaceMode,
        ownerProjectId: layoutOwnerProjectId,
        refreshSessionIds: [sessionId],
      });
    } catch (error) {
      console.error("Failed to open dropped session:", error);
      const message = error instanceof Error ? error.message : "Failed to open dropped session.";
      window.alert(message);
    } finally {
      setLayoutIndicator(null);
      setDraggedLayoutSessionId(null);
    }
  }, [applyWorkspaceLayout, clearOpenAloneSnapshot, ensureSessionReady, focusExternalOwner, layoutOwnerProjectId, workspaceMode]);

  useEffect(() => {
    const element = workbenchAreaRef.current;
    if (!element) {
      return;
    }

    const handleDragOver = (event: DragEvent) => {
      if (displayedLayout || (!hasSessionDragData(event.dataTransfer) && !draggedLayoutSessionId)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (displayedLayout) {
        return;
      }
      const sessionId = getSessionDragData(event.dataTransfer) ?? draggedLayoutSessionId;
      if (!sessionId) {
        return;
      }
      event.preventDefault();
      void handleDropIntoEmptyWorkspace(sessionId);
    };

    const handleDragLeave = () => {
      if (!displayedLayout) {
        setLayoutIndicator(null);
      }
    };

    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("drop", handleDrop);
    element.addEventListener("dragleave", handleDragLeave);

    return () => {
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("drop", handleDrop);
      element.removeEventListener("dragleave", handleDragLeave);
    };
  }, [displayedLayout, draggedLayoutSessionId, handleDropIntoEmptyWorkspace]);

  const renderLeaf = useCallback((paneId: string, sessionId: string, size: { width: number; height: number }) => {
    const session = findSession(projects, sessionId);
    const canClosePane = !isMobileViewport || layoutSessionIds.length <= 1;
    const showRestoreLayout = restoreLayoutSessionId === sessionId;
    const onMaximize = !showRestoreLayout && layoutSessionIds.length > 1 && !isMobileViewport
      ? () => {
          void openSessionAlone(sessionId);
        }
      : undefined;
    const onRestoreLayout = showRestoreLayout ? handleRestoreOpenAloneLayout : undefined;

    let content: React.ReactNode;
    const externalOwner = session ? findExternalOwner(session.id) : null;

    if (!session) {
      content = (
        <SessionStatePane
          isFocused={paneId === focusedPaneId}
          onFocus={() => setFocusedPaneId(paneId)}
          paneLabel="Unavailable"
          sessionName={sessionId}
          workPath=""
          title="Session not available"
          body="This pane references a session that is no longer available. Close the pane or reopen the project layout."
          tone="warn"
          onClosePanel={() => handleClosePane(paneId)}
          actions={[
            {
              label: "Close Pane",
              onClick: () => handleClosePane(paneId),
              danger: true,
            },
          ]}
        />
      );
    } else if (externalOwner) {
      content = (
        <SessionStatePane
          isFocused={paneId === focusedPaneId}
          onFocus={() => setFocusedPaneId(paneId)}
          paneLabel={getPaneTitle(session)}
          sessionName={session.name}
          workPath={session.work_path}
          sourceBadge="External"
          title="Already open in another window"
          body={`${session.name} is currently active in ${describeDesktopWindow(externalOwner)}. Focus that window to continue using this session.`}
          tone="info"
          onClosePanel={() => handleClosePane(paneId)}
          actions={[
            {
              label: "Focus Window",
              primary: true,
              onClick: () => {
                void focusDesktopWindow(externalOwner.windowId);
              },
            },
          ]}
        />
      );
    } else if (isPanelSession(session)) {
      content = (
        <PanelSessionView
          isFocused={paneId === focusedPaneId}
          onFocus={() => setFocusedPaneId(paneId)}
          sessionName={session.name}
          workPath={session.work_path}
          paneLabel={getPaneTitle(session)}
          onClosePanel={() => handleClosePane(paneId)}
          canClosePanel={canClosePane}
          onMaximize={onMaximize}
          showRestoreLayout={showRestoreLayout}
          onRestoreLayout={onRestoreLayout}
          renderContent={(refreshKey) => (
            session.cli_type === "folder" ? (
              <FileExplorer
                key={`folder-${session.id}-${refreshKey}`}
                rootPath={session.work_path}
                onInsertPath={(text) => { void handleCopyPath(text); }}
                onClose={() => {}}
                isMobile={isMobileViewport}
                embedded
                showCloseButton={false}
              />
            ) : session.cli_type === "git" ? (
              <GitPanel
                key={`git-${session.id}-${refreshKey}`}
                workPath={session.work_path}
                onClose={() => {}}
                isMobile={isMobileViewport}
                embedded
                showHeaderTitle={false}
                showWindowControls={false}
              />
            ) : (
              <IdeWorkbench
                key={`ide-${session.id}-${refreshKey}`}
                sessionId={session.id}
                rootPath={session.work_path}
                theme={theme}
              />
            )
          )}
        />
      );
    } else {
      content = (
        <TerminalMountSlot
          sessionId={session.id}
          paneId={paneId}
          onHostChange={handleTerminalHostChange}
        />
      );
    }

    if (isMobileViewport) {
      return content;
    }

    return (
      <LayoutDropSurface
        paneId={paneId}
        size={size}
        dragging={Boolean(draggedLayoutSessionId)}
        draggedSessionId={draggedLayoutSessionId}
        indicator={layoutIndicator}
        minPaneWidth={260}
        minPaneHeight={180}
        onIndicatorChange={setLayoutIndicator}
        onDropIndicator={(sessionId, indicator) => {
          void handleDropIndicator(sessionId, indicator);
        }}
      >
        {content}
      </LayoutDropSurface>
    );
  }, [
    draggedLayoutSessionId,
    focusedPaneId,
    handleActivityChange,
    handleClosePane,
    handleCopyPath,
    handleDropIndicator,
    handleRestoreOpenAloneLayout,
    handleSuspend,
    handleTerminalHostChange,
    handleTerminate,
    findExternalOwner,
    isMobileViewport,
    layoutIndicator,
    layoutSessionIds.length,
    openSessionAlone,
    projects,
    restoreLayoutSessionId,
    theme,
  ]);

  useEffect(() => {
    return () => {
      clearLayoutSaveTimer();
    };
  }, [clearLayoutSaveTimer]);

  if (authenticated === null) {
    return <div className="app-container" />;
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const newSessionProject = newSessionProjectId ? findProject(projects, newSessionProjectId) ?? null : null;
  const activeProjectCount = projects.filter((project) => project.sessions.some((session) => session.status === "active")).length;
  const activeSessionCount = sessions.filter((session) => session.status === "active").length;
  const isDraggingToWorkspace = Boolean(draggedLayoutSessionId) && !isMobileViewport;

  // Only show sidebar and header in the main window (role === "main" or not in desktop mode)
  const isMainWindow = !desktopLaunchContext || desktopLaunchContext.role === "main";

  return (
    <div className="app-container" data-theme={theme} data-window-role={desktopLaunchContext?.role ?? "main"} style={viewportHeight ? { height: viewportHeight } : undefined}>
      {isMainWindow && (
        <header className="app-header workbench-card">
          <div className="header-left">
            <button
              className="chrome-btn sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
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
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <button
              className="chrome-btn settings-btn"
              onClick={() => setShowSettings((open) => !open)}
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
                    <button className="size-btn" onClick={() => setWebFontSize((size) => Math.max(10, size - 1))}>-</button>
                    <span className="size-value">{webFontSize}px</span>
                    <button className="size-btn" onClick={() => setWebFontSize((size) => Math.min(24, size + 1))}>+</button>
                  </div>
                </div>
                <div className="settings-section">
                  <label className="settings-label">Terminal Font Size</label>
                  <div className="settings-control">
                    <button className="size-btn" onClick={() => setTerminalFontSize((size) => Math.max(8, size - 1))}>-</button>
                    <span className="size-value">{terminalFontSize}px</span>
                    <button className="size-btn" onClick={() => setTerminalFontSize((size) => Math.min(28, size + 1))}>+</button>
                  </div>
                </div>
                {isDesktopChromium() && desktopPreferencesState && (
                  <>
                    <div className="settings-section">
                      <label className="settings-label">Desktop</label>
                      <div className="theme-toggle-group">
                        <button
                          className={`theme-chip${desktopPreferencesState.closeBehavior === "tray" ? " is-active" : ""}`}
                          onClick={() => {
                            void updateDesktopPreferences({ closeBehavior: "tray" }).then((next) => {
                              if (next) setDesktopPreferencesState(next);
                            });
                          }}
                        >
                          Hide to Tray
                        </button>
                        <button
                          className={`theme-chip${desktopPreferencesState.closeBehavior === "quit" ? " is-active" : ""}`}
                          onClick={() => {
                            void updateDesktopPreferences({ closeBehavior: "quit" }).then((next) => {
                              if (next) setDesktopPreferencesState(next);
                            });
                          }}
                        >
                          Quit App
                        </button>
                      </div>
                      <button
                        className="settings-action"
                        onClick={() => {
                          void updateDesktopPreferences({ launchAtLogin: !desktopPreferencesState.launchAtLogin }).then((next) => {
                            if (next) setDesktopPreferencesState(next);
                          });
                        }}
                      >
                        {desktopPreferencesState.launchAtLogin ? "Disable launch at login" : "Enable launch at login"}
                      </button>
                    </div>
                    <div className="settings-section">
                      <label className="settings-label">Version</label>
                      <div className="settings-control">
                        <span className="size-value" style={{ textAlign: "left" }}>
                          {desktopVersion ?? "Unknown"}
                          {latestUpdateManifest?.version ? `  |  manifest ${latestUpdateManifest.version}` : ""}
                        </span>
                      </div>
                    </div>
                  </>
                )}
                <div className="settings-divider" />
                {canOpenConfigPath && (
                  <>
                    <button
                      className="settings-action"
                      onClick={() => {
                        void handleOpenConfigPath();
                      }}
                      disabled={openingConfigPath}
                    >
                      {openingConfigPath ? "Opening..." : "Open config path"}
                    </button>
                    <div className="settings-divider" />
                  </>
                )}
                <button className="settings-logout" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      <div className="app-body">
        {isMainWindow && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {isMainWindow && sidebarOpen && (
          <>
            <aside className="sidebar workbench-card" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              <SessionList
                projects={projects}
                activeSessions={layoutSessionIds}
                activeLayoutProjectId={workspaceMode === "project-layout" ? layoutOwnerProjectId : null}
                focusedSessionId={focusedSessionId}
                sessionActivity={sessionActivity}
                onSelect={(sessionId) => {
                  void openSessionEphemeral(sessionId);
                }}
                onOpenLayout={(projectId) => {
                  void handleOpenProjectLayout(projectId);
                }}
                onOpenProjectInNewWindow={handleOpenProjectInNewWindow}
                onResume={(sessionId) => {
                  void handleResume(sessionId).catch(() => {});
                }}
                onNewProject={() => setShowNewProject(true)}
                onAddSession={handleAddSession}
                onOpenSessionInNewWindow={handleOpenSessionInNewWindow}
                onDeleteSession={handleDelete}
                onRenameSession={handleRename}
                onSuspendSession={handleSuspend}
                onTerminateSession={handleTerminate}
                onDeleteProject={handleDeleteProject}
                onRenameProject={handleRenameProject}
                onReorderProjects={handleReorderProjects}
                onReorderProjectSessions={handleReorderProjectSessions}
                onSessionLayoutDragStart={setDraggedLayoutSessionId}
                onSessionLayoutDragEnd={() => {
                  setDraggedLayoutSessionId(null);
                  setLayoutIndicator(null);
                }}
              />
            </aside>
            <div className="sidebar-resize" onMouseDown={handleSidebarDragStart} />
          </>
        )}

        <main
          ref={workbenchAreaRef}
          className={`terminal-area workbench-card${isDraggingToWorkspace && !displayedLayout ? " is-layout-drop-target" : ""}`}
        >
          {!displayedLayout && (
            <div className={`empty-state${isDraggingToWorkspace ? " empty-state--droppable" : ""}`}>
              <span className="empty-state__eyebrow">
                {workspaceMode === "project-layout" && layoutOwnerProjectId ? "Project Layout" : "Workbench Ready"}
              </span>
              <h1 className="empty-state__title">
                {projects.length === 0
                  ? "Create a project to start working"
                  : "Open a session or project layout to start working"}
              </h1>
              <p className="empty-state__body">
                {projects.length === 0
                  ? "Projects live in the left rail and own the workspace path. Add sessions under a project when you need terminal contexts."
                  : "Single-click opens a temporary one-pane workspace. Use the Layout button to restore a saved project layout, or drag a session into the workbench to split and replace panes."}
              </p>
              <div className="empty-state__meta">
                <span>{projects.length} projects</span>
                <span>{activeProjectCount} active projects</span>
                <span>{activeSessionCount} active sessions</span>
              </div>
              <div className="empty-state__actions">
                <button className="primary-button" onClick={() => setShowNewProject(true)}>
                  Create Project
                </button>
                {isDraggingToWorkspace && (
                  <div className="empty-state__drop-copy">Drop here to open the session in a new pane</div>
                )}
              </div>
            </div>
          )}

          {displayedLayout && (
            <PaneLayout
              node={displayedLayout}
              focusedPaneId={focusedPaneId}
              minPaneWidth={260}
              minPaneHeight={180}
              onFocusPane={setFocusedPaneId}
              onResizeSplit={handleResizeSplit}
              onResizeEnd={() => {
                void flushPendingLayoutSave();
              }}
              renderLeaf={renderLeaf}
            />
          )}
        </main>
      </div>

      <div
        ref={setTerminalKeepAliveRoot}
        className="terminal-keepalive-root"
        aria-hidden="true"
      />
      {persistentTerminalSessions.map((session) => {
        const host = terminalHostElements[session.id];
        const paneId = host?.paneId ?? null;
        const canClosePane = paneId ? (!isMobileViewport || layoutSessionIds.length <= 1) : false;
        const showRestoreLayout = paneId ? restoreLayoutSessionId === session.id : false;
        const onMaximize = paneId && !showRestoreLayout && layoutSessionIds.length > 1 && !isMobileViewport
          ? () => {
              void openSessionAlone(session.id);
            }
          : undefined;

        return (
          <PersistentTerminal
            key={session.id}
            hostElement={host?.element ?? null}
            keepAliveRootElement={terminalKeepAliveRoot}
            sessionId={session.id}
            fontSize={terminalFontSize}
            onFontSizeChange={(delta) => setTerminalFontSize((value) => Math.max(8, Math.min(28, value + delta)))}
            onActivityChange={handleActivityChange}
            refreshNonce={sessionRefreshNonce[session.id] ?? 0}
            isFocused={paneId ? paneId === focusedPaneId : false}
            onFocus={() => {
              if (paneId) {
                setFocusedPaneId(paneId);
              }
            }}
            theme={theme}
            sessionName={session.name}
            paneLabel={getPaneTitle(session)}
            workPath={session.work_path}
            onClosePanel={() => {
              if (paneId) {
                handleClosePane(paneId);
              }
            }}
            canClosePanel={canClosePane}
            canSuspend={session.cli_type !== "kilo"}
            onSuspend={() => {
              void handleSuspend(session.id);
            }}
            onMaximize={onMaximize}
            showRestoreLayout={showRestoreLayout}
            onRestoreLayout={showRestoreLayout ? handleRestoreOpenAloneLayout : undefined}
            onTerminate={() => {
              void handleTerminate(session.id).catch(() => {});
            }}
            showMobileKeyBar={paneId ? layoutSessionIds.length <= 1 : false}
          />
        );
      })}

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
