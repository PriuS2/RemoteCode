const fs = require("node:fs");
const path = require("node:path");

function createDesktopWindowManager({
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  dialog,
  nativeImage,
  shell,
  backendManager,
  stateManager,
  sharedAppName,
  appProductName,
}) {
  let tray = null;
  let isQuitting = false;
  let pendingMainCommands = [];

  const windowRegistry = new Map();
  const windowRoleIndex = {
    main: null,
    projects: new Map(),
    sessions: new Map(),
  };
  const sessionOwners = new Map();
  const debugPerf = process.env.REMOTE_CODE_DESKTOP_DEBUG_PERF === "1";
  const perfCounters = {
    "badge-request": 0,
    "badge-update": 0,
    "menu-rebuild": 0,
    "registry-broadcast": 0,
    "sync-presence": 0,
  };
  let lastRegistrySnapshotKey = "";
  let lastMenuStateKey = "";
  let lastBadgePresentationKey = "";

  function getAssetPath(filename) {
    return path.join(__dirname, "assets", filename);
  }

  function getTrayIconPath() {
    return process.platform === "darwin"
      ? getAssetPath("tray-iconTemplate.png")
      : getAssetPath("tray-icon.png");
  }

  function createFallbackTrayImage() {
    const fill = process.platform === "darwin" ? "#f7f7f7" : "#78d7a7";
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <rect x="5" y="5" width="22" height="22" rx="7" fill="#18202d"/>
        <path d="M10 11h6.5c4 0 6.5 2.2 6.5 5.3S20.5 22 16.5 22H10z" fill="${fill}"/>
        <path d="M13.5 14.2v4.5h2.7c1.7 0 2.8-.8 2.8-2.3s-1-2.2-2.8-2.2z" fill="#18202d"/>
      </svg>
    `).toString("base64")}`;
    return nativeImage.createFromDataURL(dataUrl).resize({ width: 18, height: 18 });
  }

  function createWindowsOverlayDot() {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="12" fill="#78d7a7"/>
      </svg>
    `).toString("base64")}`;
    return nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
  }

  function getCurrentExecutableForCommands() {
    if (process.defaultApp && process.argv[1]) {
      return {
        program: process.execPath,
        argsPrefix: [process.argv[1]],
      };
    }

    return {
      program: process.execPath,
      argsPrefix: [],
    };
  }

  function parseDesktopCommand(argv) {
    const args = Array.isArray(argv) ? [...argv] : [];
    let command = null;
    let projectId = null;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (typeof arg !== "string") {
        continue;
      }

      if (arg.startsWith("--desktop-command=")) {
        command = arg.split("=", 2)[1] ?? null;
        continue;
      }

      if (arg === "--desktop-command" && typeof args[index + 1] === "string") {
        command = args[index + 1];
        index += 1;
        continue;
      }

      if (arg.startsWith("--project-id=")) {
        projectId = arg.split("=", 2)[1] ?? null;
        continue;
      }

      if (arg === "--project-id" && typeof args[index + 1] === "string") {
        projectId = args[index + 1];
        index += 1;
      }
    }

    if (!command) {
      return null;
    }

    if (command === "open-project" && projectId) {
      return { type: command, projectId };
    }

    if (command === "show-main" || command === "new-project") {
      return { type: command };
    }

    return null;
  }

  function buildWindowContext(role, payload = {}) {
    return {
      role,
      projectId: payload.projectId ?? null,
      projectName: payload.projectName ?? payload.name ?? null,
      sessionId: payload.sessionId ?? null,
      sessionName: payload.sessionName ?? null,
      workPath: payload.workPath ?? payload.work_path ?? null,
    };
  }

  function quoteCommandArg(value) {
    const normalized = String(value ?? "");
    if (!normalized) {
      return "\"\"";
    }
    if (/[\s"]/u.test(normalized)) {
      return `"${normalized.replace(/"/gu, "\\\"")}"`;
    }
    return normalized;
  }

  function buildDesktopCommandArgs(commandType, projectId) {
    const { argsPrefix } = getCurrentExecutableForCommands();
    const parts = [...argsPrefix, "--desktop-command", commandType];
    if (projectId) {
      parts.push("--project-id", projectId);
    }
    return parts.map(quoteCommandArg).join(" ");
  }

  function getUpdateManifestPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "update-manifest.json");
    }
    return path.join(app.getAppPath(), "desktop-build-resources", "update-manifest.json");
  }

  function readLatestManifest() {
    try {
      const raw = fs.readFileSync(getUpdateManifestPath(), "utf-8");
      const parsed = JSON.parse(raw);
      if (
        parsed
        && typeof parsed.version === "string"
        && typeof parsed.minimumSupportedVersion === "string"
        && typeof parsed.platform === "string"
        && typeof parsed.arch === "string"
        && typeof parsed.assetName === "string"
        && typeof parsed.downloadUrl === "string"
        && typeof parsed.publishedAt === "string"
      ) {
        return parsed;
      }
    } catch {
      // Ignore missing manifests in local development.
    }
    return null;
  }

  function getEntryForWindow(targetWindow) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }
    return windowRegistry.get(targetWindow.id) ?? null;
  }

  function getMainEntry() {
    return windowRoleIndex.main ? windowRegistry.get(windowRoleIndex.main) ?? null : null;
  }

  function getProjectEntry(projectId) {
    const windowId = windowRoleIndex.projects.get(projectId);
    return windowId ? windowRegistry.get(windowId) ?? null : null;
  }

  function getSessionEntry(sessionId) {
    const windowId = windowRoleIndex.sessions.get(sessionId);
    return windowId ? windowRegistry.get(windowId) ?? null : null;
  }

  function getSessionOwnerEntry(sessionId) {
    const ownerId = sessionOwners.get(sessionId);
    return ownerId ? windowRegistry.get(ownerId) ?? null : null;
  }

  function dedupeStrings(values) {
    const seen = new Set();
    return values.filter((value) => {
      if (typeof value !== "string" || !value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  function logDesktopPerf(eventName, detail) {
    if (!debugPerf) {
      return;
    }
    perfCounters[eventName] = (perfCounters[eventName] ?? 0) + 1;
    const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
    console.info(`[remote-code-desktop][perf] ${eventName}#${perfCounters[eventName]}${suffix}`);
  }

  function normalizeOwnedSessionIds(values) {
    return dedupeStrings(Array.isArray(values) ? values : []).sort();
  }

  function buildFocusContextKey(context) {
    return JSON.stringify({
      kind: context?.kind ?? "panel",
      sessionType: typeof context?.sessionType === "string" ? context.sessionType : null,
    });
  }

  function computeWindowTitle(entry) {
    if (entry.role === "main") {
      return `Main - ${sharedAppName}`;
    }
    if (entry.role === "project") {
      return entry.projectName ? `${entry.projectName} - ${sharedAppName}` : `Project - ${sharedAppName}`;
    }
    if (entry.role === "session") {
      if (entry.sessionName && entry.projectName) {
        return `${entry.sessionName} - ${entry.projectName} - ${sharedAppName}`;
      }
      if (entry.sessionName) {
        return `${entry.sessionName} - ${sharedAppName}`;
      }
      return `Session - ${sharedAppName}`;
    }
    return sharedAppName;
  }

  function applyWindowTitle(entry) {
    if (!entry || !entry.win || entry.win.isDestroyed()) {
      return;
    }
    entry.title = computeWindowTitle(entry);
    entry.win.setTitle(entry.title);
  }

  function buildEntryPresenceKey(entry) {
    return JSON.stringify({
      role: entry.role,
      projectId: entry.projectId ?? null,
      projectName: entry.projectName ?? null,
      sessionId: entry.sessionId ?? null,
      sessionName: entry.sessionName ?? null,
      workPath: entry.workPath ?? null,
      ownedSessionIds: normalizeOwnedSessionIds(entry.ownedSessionIds),
      title: entry.title ?? computeWindowTitle(entry),
    });
  }

  function buildWindowSummary(entry) {
    return {
      windowId: entry.win.id,
      role: entry.role,
      projectId: entry.projectId ?? null,
      projectName: entry.projectName ?? null,
      sessionId: entry.sessionId ?? null,
      sessionName: entry.sessionName ?? null,
      workPath: entry.workPath ?? null,
      title: entry.title ?? computeWindowTitle(entry),
      hidden: !entry.win.isVisible(),
      focused: entry.win.isFocused(),
      badgeCount: entry.badgeCount ?? 0,
      ownedSessionIds: [...entry.ownedSessionIds],
    };
  }

  function listOpenWindowSummaries() {
    const priorities = { main: 0, project: 1, session: 2 };
    return [...windowRegistry.values()]
      .sort((left, right) => {
        const leftPriority = priorities[left.role] ?? 99;
        const rightPriority = priorities[right.role] ?? 99;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return left.win.id - right.win.id;
      })
      .map(buildWindowSummary);
  }

  function getTotalBadgeCount() {
    return [...windowRegistry.values()].reduce((sum, entry) => sum + (entry.badgeCount ?? 0), 0);
  }

  function buildRegistrySnapshotKey(summaries) {
    return JSON.stringify(
      summaries.map((entry) => ({
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

  function buildMenuStateKey(summaries) {
    const preferences = stateManager.getPreferences();
    const recentProjects = stateManager.getRecentProjects();

    return JSON.stringify({
      launchAtLogin: Boolean(preferences.launchAtLogin),
      recentProjects: recentProjects.map((project) => ({
        projectId: project.projectId,
        name: project.name,
        workPath: project.workPath,
      })),
      openWindows: summaries.map((entry) => ({
        windowId: entry.windowId,
        role: entry.role,
        projectId: entry.projectId ?? null,
        sessionId: entry.sessionId ?? null,
        title: entry.title,
        hidden: Boolean(entry.hidden),
      })),
    });
  }

  function updateAppBadgePresentation(force = false) {
    const totalBadgeCount = getTotalBadgeCount();
    const badgeKey = JSON.stringify({ totalBadgeCount });
    if (!force && badgeKey === lastBadgePresentationKey) {
      return false;
    }
    lastBadgePresentationKey = badgeKey;
    logDesktopPerf("badge-update", { totalBadgeCount, force });

    if (process.platform === "darwin" && typeof app.setBadgeCount === "function") {
      app.setBadgeCount(totalBadgeCount);
    }

    if (tray) {
      tray.setToolTip(totalBadgeCount > 0
        ? `${appProductName} (${totalBadgeCount} completed)`
        : appProductName);
    }

    if (process.platform === "win32") {
      const mainEntry = getMainEntry();
      if (mainEntry?.win && !mainEntry.win.isDestroyed()) {
        if (totalBadgeCount > 0) {
          mainEntry.win.setOverlayIcon(createWindowsOverlayDot(), `${totalBadgeCount} completed sessions`);
        } else {
          mainEntry.win.setOverlayIcon(null, "");
        }
      }
    }
    return true;
  }

  function focusWindowEntry(entry) {
    if (!entry || !entry.win || entry.win.isDestroyed()) {
      return null;
    }

    if (entry.win.isMinimized()) {
      entry.win.restore();
    }
    entry.win.show();
    entry.win.focus();
    return entry;
  }

  function focusWindowById(windowId) {
    const entry = windowRegistry.get(windowId) ?? null;
    return focusWindowEntry(entry);
  }

  function buildTrayContextMenu() {
    const openWindows = listOpenWindowSummaries();
    const recentProjects = stateManager.getRecentProjects();
    const preferences = stateManager.getPreferences();

    return Menu.buildFromTemplate([
      { label: "Open Main Window", click: () => { void ensureMainWindow(); } },
      {
        label: "New Project",
        click: () => {
          void ensureMainWindow();
          dispatchRendererCommand({ type: "new-project" });
        },
      },
      {
        label: "Recent Projects",
        submenu: recentProjects.length > 0
          ? recentProjects.map((project) => ({
            label: project.name,
            toolTip: project.workPath,
            click: () => {
              void openProjectWindow(project);
            },
          }))
          : [{ label: "No recent projects", enabled: false }],
      },
      {
        label: "Open Windows",
        submenu: openWindows.length > 0
          ? openWindows.map((entry) => ({
            label: entry.hidden ? `${entry.title} (hidden)` : entry.title,
            click: () => {
              focusWindowById(entry.windowId);
            },
          }))
          : [{ label: "No windows", enabled: false }],
      },
      { type: "separator" },
      {
        label: "Launch at Login",
        type: "checkbox",
        checked: preferences.launchAtLogin,
        click: ({ checked }) => {
          void updateLaunchAtLoginPreference(Boolean(checked));
        },
      },
      { label: "Quit", click: () => app.quit() },
    ]);
  }

  function buildApplicationMenu() {
    return Menu.buildFromTemplate([
      {
        label: appProductName,
        submenu: [
          { label: "Show Main Window", click: () => { void ensureMainWindow(); } },
          {
            label: "New Project",
            accelerator: "CmdOrCtrl+Shift+N",
            click: () => {
              void ensureMainWindow();
              dispatchRendererCommand({ type: "new-project" });
            },
          },
          { type: "separator" },
          { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
        ],
      },
      {
        label: "Window",
        submenu: process.platform === "darwin"
          ? [{ role: "minimize" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "togglefullscreen" }]
          : [{ role: "minimize" }, { role: "close" }, { type: "separator" }, { role: "togglefullscreen" }],
      },
    ]);
  }

  function buildDockMenu() {
    if (process.platform !== "darwin" || !app.dock) {
      return;
    }

    const recentProjects = stateManager.getRecentProjects().slice(0, 5);
    const menu = Menu.buildFromTemplate([
      { label: "Open Main Window", click: () => { void ensureMainWindow(); } },
      {
        label: "New Project",
        click: () => {
          void ensureMainWindow();
          dispatchRendererCommand({ type: "new-project" });
        },
      },
      {
        label: "Recent Projects",
        submenu: recentProjects.length > 0
          ? recentProjects.map((project) => ({
            label: project.name,
            click: () => {
              void openProjectWindow(project);
            },
          }))
          : [{ label: "No recent projects", enabled: false }],
      },
    ]);

    app.dock.setMenu(menu);
  }

  function buildWindowsTaskItem({ title, description, commandType, projectId }) {
    const { program } = getCurrentExecutableForCommands();
    return {
      program,
      arguments: buildDesktopCommandArgs(commandType, projectId),
      title,
      description,
      iconPath: program,
      iconIndex: 0,
    };
  }

  function buildWindowsJumpListItem({ title, description, commandType, projectId }) {
    const { program } = getCurrentExecutableForCommands();
    return {
      type: "task",
      program,
      args: buildDesktopCommandArgs(commandType, projectId),
      title,
      description,
      iconPath: program,
      iconIndex: 0,
    };
  }

  function buildWindowsTaskbarExtensions() {
    if (process.platform !== "win32") {
      return;
    }

    const tasks = [
      buildWindowsTaskItem({
        title: "Open Main Window",
        description: "Bring the main Remote Code window to the front.",
        commandType: "show-main",
      }),
      buildWindowsTaskItem({
        title: "New Project",
        description: "Open the main window and start creating a project.",
        commandType: "new-project",
      }),
    ];

    try {
      app.setUserTasks(tasks);
    } catch {
      // Ignore unsupported shells.
    }

    const removedItems = new Set(
      (app.getJumpListSettings?.().removedItems ?? [])
        .map((item) => `${item.title ?? ""}|${item.args ?? ""}`),
    );

    const recentProjects = stateManager.getRecentProjects()
      .slice(0, 5)
      .map((project) => buildWindowsJumpListItem({
        title: project.name,
        description: project.workPath || "Open project window",
        commandType: "open-project",
        projectId: project.projectId,
      }))
      .filter((item) => !removedItems.has(`${item.title}|${item.args ?? ""}`));

    const jumpList = [
      {
        type: "tasks",
        items: [
          buildWindowsJumpListItem({
            title: "Open Main Window",
            description: "Bring the main Remote Code window to the front.",
            commandType: "show-main",
          }),
          buildWindowsJumpListItem({
            title: "New Project",
            description: "Open the main window and start creating a project.",
            commandType: "new-project",
          }),
        ],
      },
    ];

    if (recentProjects.length > 0) {
      jumpList.push({
        type: "custom",
        name: "Recent Projects",
        items: recentProjects,
      });
    }

    try {
      app.setJumpList(jumpList);
    } catch {
      // Ignore shell integration failures during development.
    }
  }

  function rebuildSystemMenus(options = {}) {
    const summaries = Array.isArray(options.summaries) ? options.summaries : listOpenWindowSummaries();
    const nextMenuStateKey = buildMenuStateKey(summaries);
    const force = Boolean(options.force);

    if (!force && nextMenuStateKey === lastMenuStateKey) {
      updateAppBadgePresentation(false);
      return false;
    }

    lastMenuStateKey = nextMenuStateKey;
    logDesktopPerf("menu-rebuild", {
      reason: options.reason ?? "unknown",
      force,
      windows: summaries.length,
    });

    Menu.setApplicationMenu(buildApplicationMenu());
    if (tray) {
      tray.setContextMenu(buildTrayContextMenu());
    }
    buildDockMenu();
    buildWindowsTaskbarExtensions();
    updateAppBadgePresentation(true);
    return true;
  }

  function broadcastWindowRegistry(reason = "unknown") {
    const summaries = listOpenWindowSummaries();
    const nextRegistrySnapshotKey = buildRegistrySnapshotKey(summaries);

    if (nextRegistrySnapshotKey === lastRegistrySnapshotKey) {
      rebuildSystemMenus({ summaries, reason });
      return false;
    }

    lastRegistrySnapshotKey = nextRegistrySnapshotKey;
    logDesktopPerf("registry-broadcast", { reason, windows: summaries.length });
    windowRegistry.forEach((entry) => {
      if (!entry.win.isDestroyed()) {
        entry.win.webContents.send("window:registry-updated", summaries);
      }
    });
    rebuildSystemMenus({ summaries, reason });
    return true;
  }

  function createTray() {
    if (tray) {
      return tray;
    }

    const image = nativeImage.createFromPath(getTrayIconPath());
    tray = new Tray(image.isEmpty() ? createFallbackTrayImage() : image);
    tray.on("click", () => {
      void ensureMainWindow();
    });
    rebuildSystemMenus({ force: true, reason: "tray-created" });
    return tray;
  }

  function showTrayHintOnce() {
    const preferences = stateManager.getPreferences();
    if (preferences.trayHintShown) {
      return;
    }

    stateManager.setPreferences({ trayHintShown: true });
    if (Notification.isSupported()) {
      new Notification({
        title: appProductName,
        body: "Remote Code will keep running in the background. Use the tray icon to reopen or quit.",
        silent: true,
      }).show();
    }
  }

  async function updateLaunchAtLoginPreference(launchAtLogin) {
    try {
      app.setLoginItemSettings({
        openAtLogin: launchAtLogin,
        openAsHidden: false,
      });
    } catch {
      // Ignore unsupported platforms in development.
    }

    const nextPreferences = stateManager.setPreferences({ launchAtLogin: Boolean(launchAtLogin) });
    rebuildSystemMenus({ reason: "launch-at-login" });
    return nextPreferences;
  }

  function syncLaunchAtLoginFromSystem() {
    const launchAtLogin = Boolean(app.getLoginItemSettings()?.openAtLogin);
    const preferences = stateManager.getPreferences();
    if (preferences.launchAtLogin !== launchAtLogin) {
      stateManager.setPreferences({ launchAtLogin });
    }
  }

  function dispatchRendererCommand(command) {
    const mainEntry = getMainEntry();
    if (!mainEntry || !mainEntry.win || mainEntry.win.isDestroyed()) {
      pendingMainCommands.push(command);
      return;
    }

    mainEntry.win.webContents.send("app:command", command);
  }

  function flushPendingMainCommands() {
    if (pendingMainCommands.length === 0) {
      return;
    }

    const queued = [...pendingMainCommands];
    pendingMainCommands = [];
    queued.forEach((command) => dispatchRendererCommand(command));
  }

  function releaseOwnedSessions(entry) {
    entry.ownedSessionIds.forEach((sessionId) => {
      if (sessionOwners.get(sessionId) === entry.win.id) {
        sessionOwners.delete(sessionId);
      }
    });
    entry.ownedSessionIds = [];
  }

  function updateOwnedSessions(entry, requestedSessionIds) {
    const nextOwned = normalizeOwnedSessionIds(requestedSessionIds);

    entry.ownedSessionIds.forEach((sessionId) => {
      if (!nextOwned.includes(sessionId) && sessionOwners.get(sessionId) === entry.win.id) {
        sessionOwners.delete(sessionId);
      }
    });

    const granted = [];
    nextOwned.forEach((sessionId) => {
      const currentOwner = sessionOwners.get(sessionId);
      if (!currentOwner || currentOwner === entry.win.id) {
        sessionOwners.set(sessionId, entry.win.id);
        granted.push(sessionId);
      }
    });

    entry.ownedSessionIds = normalizeOwnedSessionIds(granted);
  }

  function saveManagedWindowState(entry) {
    if (!entry || !entry.win || entry.win.isDestroyed()) {
      return;
    }
    const bounds = entry.win.getBounds();
    stateManager.saveWindowState(entry.launchContext, {
      ...bounds,
      maximized: entry.win.isMaximized(),
    });
  }

  function registerEntry(entry) {
    windowRegistry.set(entry.win.id, entry);

    if (entry.role === "project" && entry.projectId) {
      windowRoleIndex.projects.set(entry.projectId, entry.win.id);
    } else if (entry.role === "session" && entry.sessionId) {
      windowRoleIndex.sessions.set(entry.sessionId, entry.win.id);
    } else {
      windowRoleIndex.main = entry.win.id;
    }

    applyWindowTitle(entry);
    entry.lastPresenceKey = buildEntryPresenceKey(entry);
    broadcastWindowRegistry("register-entry");
  }

  function unregisterEntry(entry) {
    if (!entry) {
      return;
    }

    releaseOwnedSessions(entry);

    if (entry.role === "project" && entry.projectId) {
      windowRoleIndex.projects.delete(entry.projectId);
    } else if (entry.role === "session" && entry.sessionId) {
      windowRoleIndex.sessions.delete(entry.sessionId);
    } else if (windowRoleIndex.main === entry.win.id) {
      windowRoleIndex.main = null;
    }

    windowRegistry.delete(entry.win.id);
    broadcastWindowRegistry("unregister-entry");
  }

  function isModifierShortcut(input) {
    return Boolean(input.control || input.meta);
  }

  function matchesMainProcessBrowserBlock(input, focusContext) {
    const key = (input.key || "").toLowerCase();
    if (key === "f5" || key === "browserback" || key === "browserforward") {
      return true;
    }
    return false;
  }

  function attachWindowHandlers(entry) {
    const { win } = entry;
    const persist = () => saveManagedWindowState(entry);
    const broadcastFor = (reason) => () => {
      broadcastWindowRegistry(reason);
    };

    win.on("maximize", persist);
    win.on("unmaximize", persist);
    win.on("resize", persist);
    win.on("move", persist);
    win.on("show", broadcastFor("window-show"));
    win.on("hide", broadcastFor("window-hide"));
    win.on("focus", broadcastFor("window-focus"));
    win.on("blur", broadcastFor("window-blur"));
    win.on("minimize", broadcastFor("window-minimize"));
    win.on("restore", broadcastFor("window-restore"));

    win.on("close", (event) => {
      persist();
      if (entry.role === "main" && !isQuitting && stateManager.getPreferences().closeBehavior === "tray") {
        event.preventDefault();
        win.hide();
        showTrayHintOnce();
        broadcastWindowRegistry("main-hide-to-tray");
      }
    });

    win.on("closed", () => {
      unregisterEntry(entry);
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isInternalAppUrl(url)) {
        return { action: "allow" };
      }
      void shell.openExternal(url);
      return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
      if (!isInternalAppUrl(url)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });

    win.webContents.on("before-input-event", (event, input) => {
      if (matchesMainProcessBrowserBlock(input, entry.focusContext)) {
        event.preventDefault();
      }
    });

    win.webContents.on("did-finish-load", () => {
      applyWindowTitle(entry);
      if (entry.role === "main") {
        flushPendingMainCommands();
      }
      broadcastWindowRegistry("did-finish-load");
    });
  }

  function isInternalAppUrl(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return false;
      }

      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        return true;
      }

      const appUrl = new URL(backendManager.getAppUrl());
      return parsed.origin === appUrl.origin;
    } catch {
      return false;
    }
  }

  async function createManagedWindow(context) {
    await backendManager.ensureReady();

    if (context.role === "main") {
      const existingMain = getMainEntry();
      if (existingMain) {
        return focusWindowEntry(existingMain);
      }
    }

    if (context.role === "project" && context.projectId) {
      const existingProject = getProjectEntry(context.projectId);
      if (existingProject) {
        return focusWindowEntry(existingProject);
      }
    }

    if (context.role === "session" && context.sessionId) {
      const ownerEntry = getSessionOwnerEntry(context.sessionId);
      if (ownerEntry) {
        return focusWindowEntry(ownerEntry);
      }

      const existingSession = getSessionEntry(context.sessionId);
      if (existingSession) {
        return focusWindowEntry(existingSession);
      }
    }

    const storedState = stateManager.getWindowState(context);
    const win = new BrowserWindow({
      width: storedState.width,
      height: storedState.height,
      x: typeof storedState.x === "number" ? storedState.x : undefined,
      y: typeof storedState.y === "number" ? storedState.y : undefined,
      show: false,
      backgroundColor: "#141820",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const entry = {
      win,
      role: context.role,
      projectId: context.projectId ?? null,
      projectName: context.projectName ?? null,
      sessionId: context.sessionId ?? null,
      sessionName: context.sessionName ?? null,
      workPath: context.workPath ?? null,
      badgeCount: 0,
      lastBadgeCount: 0,
      ownedSessionIds: [],
      focusContext: { kind: "panel" },
      lastFocusContextKey: buildFocusContextKey({ kind: "panel" }),
      title: sharedAppName,
      launchContext: {
        ...context,
        windowId: win.id,
      },
    };

    if (entry.role === "session" && entry.sessionId && !sessionOwners.has(entry.sessionId)) {
      sessionOwners.set(entry.sessionId, win.id);
      entry.ownedSessionIds = [entry.sessionId];
    }
    entry.lastPresenceKey = buildEntryPresenceKey(entry);

    registerEntry(entry);
    attachWindowHandlers(entry);

    win.once("ready-to-show", () => {
      if (storedState.maximized) {
        win.maximize();
      }
      win.show();
      win.focus();
    });

    await win.loadURL(backendManager.getAppUrl());
    return entry;
  }

  async function ensureMainWindow() {
    const entry = await createManagedWindow(buildWindowContext("main"));
    return focusWindowEntry(entry);
  }

  async function openProjectWindow(project) {
    if (!project?.projectId || typeof project.projectId !== "string") {
      return null;
    }
    const entry = await createManagedWindow(buildWindowContext("project", project));
    return buildWindowSummary(entry);
  }

  async function openSessionWindow(session) {
    if (!session?.sessionId || typeof session.sessionId !== "string") {
      return null;
    }

    const ownerEntry = getSessionOwnerEntry(session.sessionId);
    if (ownerEntry) {
      focusWindowEntry(ownerEntry);
      return buildWindowSummary(ownerEntry);
    }

    const entry = await createManagedWindow(buildWindowContext("session", session));
    return buildWindowSummary(entry);
  }

  function getRelaunchSnapshot() {
    return [...windowRegistry.values()]
      .filter((entry) => entry.role === "project" || entry.role === "session")
      .map((entry) => ({
        role: entry.role,
        projectId: entry.projectId,
        projectName: entry.projectName,
        sessionId: entry.sessionId,
        sessionName: entry.sessionName,
        workPath: entry.workPath,
      }));
  }

  async function restoreRelaunchWindows() {
    const snapshot = stateManager.getRelaunchSnapshot();
    const sessionEntries = snapshot.filter((item) => item.role === "session");
    const projectEntries = snapshot.filter((item) => item.role === "project");

    for (const item of sessionEntries) {
      if (item.sessionId) {
        await openSessionWindow(item);
      }
    }

    for (const item of projectEntries) {
      if (item.projectId) {
        await openProjectWindow(item);
      }
    }
  }

  function dispatchDesktopCommand(command) {
    if (!command) {
      void ensureMainWindow();
      return;
    }

    if (command.type === "show-main") {
      void ensureMainWindow();
      return;
    }

    if (command.type === "new-project") {
      void ensureMainWindow();
      dispatchRendererCommand({ type: "new-project" });
      return;
    }

    if (command.type === "open-project" && command.projectId) {
      void openProjectWindow({ projectId: command.projectId });
      return;
    }

    void ensureMainWindow();
  }

  function markQuitting() {
    isQuitting = true;
    stateManager.setRelaunchSnapshot(getRelaunchSnapshot());
    windowRegistry.forEach((entry) => {
      saveManagedWindowState(entry);
    });
  }

  function registerIpc() {
    ipcMain.handle("runtime:get-info", () => ({
      runtime: "chromium",
      platform: process.platform,
      version: app.getVersion(),
      debugPerf,
    }));

    ipcMain.handle("window:get-launch-context", (event) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      return entry?.launchContext ?? null;
    });

    ipcMain.handle("window:open-project", async (_event, payload) => openProjectWindow(payload));
    ipcMain.handle("window:open-session", async (_event, payload) => openSessionWindow(payload));
    ipcMain.handle("window:list-open-windows", () => listOpenWindowSummaries());
    ipcMain.handle("window:focus-window", (_event, windowId) => Boolean(focusWindowById(windowId)));

    ipcMain.on("window:set-focus-context", (event, context) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      if (!entry) return;
      const nextFocusContext = context && typeof context.kind === "string"
        ? { kind: context.kind, sessionType: typeof context.sessionType === "string" ? context.sessionType : undefined }
        : { kind: "panel" };
      const nextFocusContextKey = buildFocusContextKey(nextFocusContext);
      if (nextFocusContextKey === entry.lastFocusContextKey) {
        return;
      }
      entry.focusContext = nextFocusContext;
      entry.lastFocusContextKey = nextFocusContextKey;
    });

    ipcMain.on("window:sync-presence", (event, payload) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      if (!entry) return;
      const previousPresenceKey = entry.lastPresenceKey ?? buildEntryPresenceKey(entry);

      if (payload && Object.prototype.hasOwnProperty.call(payload, "projectId")) {
        entry.projectId = typeof payload.projectId === "string" && payload.projectId ? payload.projectId : null;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "projectName")) {
        entry.projectName = typeof payload.projectName === "string" && payload.projectName ? payload.projectName : null;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "sessionId")) {
        entry.sessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId : null;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "sessionName")) {
        entry.sessionName = typeof payload.sessionName === "string" && payload.sessionName ? payload.sessionName : null;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "workPath")) {
        entry.workPath = typeof payload.workPath === "string" && payload.workPath ? payload.workPath : null;
      }
      updateOwnedSessions(entry, payload?.ownedSessionIds);
      applyWindowTitle(entry);
      const nextPresenceKey = buildEntryPresenceKey(entry);
      if (nextPresenceKey === previousPresenceKey) {
        entry.lastPresenceKey = nextPresenceKey;
        return;
      }
      entry.lastPresenceKey = nextPresenceKey;
      logDesktopPerf("sync-presence", {
        windowId: entry.win.id,
        role: entry.role,
      });
      broadcastWindowRegistry("sync-presence");
    });

    ipcMain.handle("window:get-state", (event) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      return stateManager.getWindowState(entry?.launchContext ?? buildWindowContext("main"));
    });

    ipcMain.handle("window:save-state", (event, state) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      if (!entry) return null;
      return stateManager.saveWindowState(entry.launchContext, state);
    });

    ipcMain.handle("app:open-folder-dialog", async (event) => {
      const currentWindow = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(currentWindow ?? undefined, {
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    });

    ipcMain.handle("app:open-external", async (_event, url) => {
      if (typeof url !== "string" || !url.trim()) return false;
      await shell.openExternal(url);
      return true;
    });

    ipcMain.handle("app:show-notification", async (_event, payload) => {
      if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string" || !Notification.isSupported()) {
        return false;
      }
      new Notification({ title: payload.title, body: payload.body, silent: false }).show();
      return true;
    });

    ipcMain.handle("app:get-desktop-preferences", () => stateManager.getPreferences());
    ipcMain.handle("app:update-desktop-preferences", async (_event, payload) => {
      const next = {};
      if (payload?.closeBehavior === "tray" || payload?.closeBehavior === "quit") {
        next.closeBehavior = payload.closeBehavior;
      }
      if (typeof payload?.launchAtLogin === "boolean") {
        await updateLaunchAtLoginPreference(payload.launchAtLogin);
      }
      const nextPreferences = Object.keys(next).length > 0 ? stateManager.setPreferences(next) : stateManager.getPreferences();
      rebuildSystemMenus({ reason: "desktop-preferences" });
      return nextPreferences;
    });
    ipcMain.handle("app:get-recent-projects", () => stateManager.getRecentProjects());
    ipcMain.handle("app:record-recent-project", (_event, payload) => {
      const recentProjects = stateManager.recordRecentProject(payload);
      rebuildSystemMenus({ reason: "recent-project-recorded" });
      return recentProjects;
    });
    ipcMain.handle("app:remove-recent-project", (_event, projectId) => {
      const recentProjects = stateManager.removeRecentProject(projectId);
      rebuildSystemMenus({ reason: "recent-project-removed" });
      return recentProjects;
    });
    ipcMain.handle("app:reveal-in-file-explorer", async (_event, filePath) => {
      if (typeof filePath !== "string" || !filePath.trim()) return false;
      shell.showItemInFolder(filePath);
      return true;
    });
    ipcMain.handle("app:set-badge-count", (event, badgeCount) => {
      const entry = getEntryForWindow(BrowserWindow.fromWebContents(event.sender));
      if (!entry) return 0;
      const nextBadgeCount = Number.isFinite(badgeCount) ? Math.max(0, Math.trunc(badgeCount)) : 0;
      if (entry.lastBadgeCount === nextBadgeCount) {
        return entry.badgeCount;
      }
      entry.badgeCount = nextBadgeCount;
      entry.lastBadgeCount = nextBadgeCount;
      logDesktopPerf("badge-request", {
        windowId: entry.win.id,
        role: entry.role,
        badgeCount: nextBadgeCount,
      });
      updateAppBadgePresentation();
      return entry.badgeCount;
    });
    ipcMain.handle("updater:get-current-version", () => app.getVersion());
    ipcMain.handle("updater:get-latest-manifest", () => readLatestManifest());
  }

  function buildStartupMenuState() {
    createTray();
    syncLaunchAtLoginFromSystem();
    rebuildSystemMenus({ force: true, reason: "startup" });
  }

  return {
    buildStartupMenuState,
    dispatchDesktopCommand,
    ensureMainWindow,
    getMainEntry,
    listOpenWindowSummaries,
    markQuitting,
    openProjectWindow,
    openSessionWindow,
    parseDesktopCommand,
    registerIpc,
    restoreRelaunchWindows,
  };
}

module.exports = {
  createDesktopWindowManager,
};
