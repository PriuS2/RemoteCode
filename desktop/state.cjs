const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_STATE_FILENAME = "desktop-state.json";
const LEGACY_WINDOW_STATE_FILENAME = "window-state.json";
const MAX_RECENT_PROJECTS = 10;
const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 960,
  maximized: false,
};
const DEFAULT_PREFERENCES = {
  closeBehavior: "tray",
  launchAtLogin: false,
  trayHintShown: false,
};

function normalizeWindowState(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_WINDOW_STATE };
  }

  const next = {
    width: typeof raw.width === "number" && raw.width > 0 ? Math.round(raw.width) : DEFAULT_WINDOW_STATE.width,
    height: typeof raw.height === "number" && raw.height > 0 ? Math.round(raw.height) : DEFAULT_WINDOW_STATE.height,
    maximized: Boolean(raw.maximized),
  };

  if (typeof raw.x === "number") {
    next.x = Math.round(raw.x);
  }
  if (typeof raw.y === "number") {
    next.y = Math.round(raw.y);
  }

  return next;
}

function normalizeRecentProjects(rawRecentProjects) {
  if (!Array.isArray(rawRecentProjects)) {
    return [];
  }

  return rawRecentProjects
    .filter((item) => item && typeof item.projectId === "string" && item.projectId)
    .map((item) => ({
      projectId: item.projectId,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.projectId,
      workPath: typeof item.workPath === "string" ? item.workPath : "",
      lastOpenedAt: typeof item.lastOpenedAt === "string" ? item.lastOpenedAt : new Date().toISOString(),
    }))
    .slice(0, MAX_RECENT_PROJECTS);
}

function normalizeWindowMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawMap)
      .filter(([key]) => typeof key === "string" && key)
      .map(([key, value]) => [key, normalizeWindowState(value)]),
  );
}

function normalizeRelaunchSnapshot(rawSnapshot) {
  if (!Array.isArray(rawSnapshot)) {
    return [];
  }

  return rawSnapshot
    .filter((item) => item && typeof item.role === "string")
    .map((item) => ({
      role: item.role === "session" ? "session" : item.role === "project" ? "project" : "main",
      projectId: typeof item.projectId === "string" ? item.projectId : undefined,
      projectName: typeof item.projectName === "string" ? item.projectName : undefined,
      sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
      sessionName: typeof item.sessionName === "string" ? item.sessionName : undefined,
      workPath: typeof item.workPath === "string" ? item.workPath : undefined,
    }));
}

function normalizeDesktopState(raw) {
  return {
    preferences: {
      closeBehavior: raw?.preferences?.closeBehavior === "quit" ? "quit" : DEFAULT_PREFERENCES.closeBehavior,
      launchAtLogin: Boolean(raw?.preferences?.launchAtLogin),
      trayHintShown: Boolean(raw?.preferences?.trayHintShown),
    },
    mainWindow: normalizeWindowState(raw?.mainWindow),
    projectWindows: normalizeWindowMap(raw?.projectWindows),
    sessionWindows: normalizeWindowMap(raw?.sessionWindows),
    recentProjects: normalizeRecentProjects(raw?.recentProjects),
    relaunchSnapshot: normalizeRelaunchSnapshot(raw?.relaunchSnapshot),
  };
}

function createDesktopStateManager(app) {
  let cachedState = null;

  function getDesktopStatePath() {
    return path.join(app.getPath("userData"), DESKTOP_STATE_FILENAME);
  }

  function getLegacyWindowStatePath() {
    return path.join(app.getPath("userData"), LEGACY_WINDOW_STATE_FILENAME);
  }

  function loadLegacyWindowState() {
    try {
      const raw = fs.readFileSync(getLegacyWindowStatePath(), "utf-8");
      return normalizeWindowState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function load() {
    if (cachedState) {
      return cachedState;
    }

    try {
      const raw = fs.readFileSync(getDesktopStatePath(), "utf-8");
      cachedState = normalizeDesktopState(JSON.parse(raw));
      return cachedState;
    } catch {
      cachedState = normalizeDesktopState({
        mainWindow: loadLegacyWindowState() ?? DEFAULT_WINDOW_STATE,
      });
      return cachedState;
    }
  }

  function save() {
    if (!cachedState) {
      return;
    }
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(getDesktopStatePath(), JSON.stringify(cachedState, null, 2));
  }

  function getPreferences() {
    return { ...load().preferences };
  }

  function setPreferences(nextPreferences) {
    const state = load();
    const mergedPreferences = {
      ...state.preferences,
      ...nextPreferences,
    };
    if (
      state.preferences.closeBehavior === mergedPreferences.closeBehavior
      && state.preferences.launchAtLogin === mergedPreferences.launchAtLogin
      && state.preferences.trayHintShown === mergedPreferences.trayHintShown
    ) {
      return { ...state.preferences };
    }
    state.preferences = mergedPreferences;
    cachedState = state;
    save();
    return { ...state.preferences };
  }

  function getWindowState(context) {
    const state = load();
    if (context.role === "project" && context.projectId) {
      return state.projectWindows[context.projectId] ?? { ...DEFAULT_WINDOW_STATE };
    }
    if (context.role === "session" && context.sessionId) {
      return state.sessionWindows[context.sessionId] ?? { ...DEFAULT_WINDOW_STATE };
    }
    return state.mainWindow ?? { ...DEFAULT_WINDOW_STATE };
  }

  function saveWindowState(context, nextState) {
    const state = load();
    const normalized = normalizeWindowState(nextState);

    if (context.role === "project" && context.projectId) {
      state.projectWindows[context.projectId] = normalized;
    } else if (context.role === "session" && context.sessionId) {
      state.sessionWindows[context.sessionId] = normalized;
    } else {
      state.mainWindow = normalized;
    }

    cachedState = state;
    save();
    return normalized;
  }

  function getRecentProjects() {
    return [...load().recentProjects];
  }

  function recordRecentProject(project) {
    if (!project || typeof project.projectId !== "string" || !project.projectId) {
      return getRecentProjects();
    }

    const state = load();
    const nextProject = {
      projectId: project.projectId,
      name: typeof project.name === "string" && project.name.trim() ? project.name.trim() : project.projectId,
      workPath: typeof project.workPath === "string" ? project.workPath : "",
      lastOpenedAt: new Date().toISOString(),
    };

    const currentTop = state.recentProjects[0];
    if (
      currentTop
      && currentTop.projectId === nextProject.projectId
      && currentTop.name === nextProject.name
      && currentTop.workPath === nextProject.workPath
    ) {
      return [...state.recentProjects];
    }

    state.recentProjects = [
      nextProject,
      ...state.recentProjects.filter((item) => item.projectId !== nextProject.projectId),
    ].slice(0, MAX_RECENT_PROJECTS);

    cachedState = state;
    save();
    return [...state.recentProjects];
  }

  function removeRecentProject(projectId) {
    const state = load();
    if (!state.recentProjects.some((item) => item.projectId === projectId)) {
      return [...state.recentProjects];
    }
    state.recentProjects = state.recentProjects.filter((item) => item.projectId !== projectId);
    cachedState = state;
    save();
    return [...state.recentProjects];
  }

  function getRelaunchSnapshot() {
    return [...load().relaunchSnapshot];
  }

  function setRelaunchSnapshot(snapshot) {
    const state = load();
    state.relaunchSnapshot = normalizeRelaunchSnapshot(snapshot);
    cachedState = state;
    save();
    return [...state.relaunchSnapshot];
  }

  return {
    load,
    save,
    getPreferences,
    setPreferences,
    getWindowState,
    saveWindowState,
    getRecentProjects,
    recordRecentProject,
    removeRecentProject,
    getRelaunchSnapshot,
    setRelaunchSnapshot,
  };
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  createDesktopStateManager,
};
