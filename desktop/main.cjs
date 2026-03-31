const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SHARED_APP_NAME = "Remote Code";
const WINDOW_STATE_FILENAME = "window-state.json";
const DEFAULT_PORT = 8080;
const HEALTH_TIMEOUT_MS = 30_000;
const RENDERER_TIMEOUT_MS = 30_000;
const BACKEND_READY_PATH = "/api/health";
const APP_PRODUCT_NAME = "Remote Code Chromium";

const sharedUserDataPath = path.join(app.getPath("appData"), SHARED_APP_NAME);
app.setPath("userData", sharedUserDataPath);
app.name = APP_PRODUCT_NAME;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let backendProcess = null;
let backendExitExpected = false;
let currentFocusContext = { kind: "panel" };
let isQuitting = false;
let cachedWindowState = null;

function getWindowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILENAME);
}

function loadWindowState() {
  if (cachedWindowState) {
    return cachedWindowState;
  }

  try {
    const raw = fs.readFileSync(getWindowStatePath(), "utf-8");
    const parsed = JSON.parse(raw);
    cachedWindowState = parsed;
    return parsed;
  } catch {
    cachedWindowState = {
      width: 1440,
      height: 960,
      maximized: false,
    };
    return cachedWindowState;
  }
}

function saveWindowState(state) {
  cachedWindowState = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    maximized: Boolean(state.maximized),
  };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(getWindowStatePath(), JSON.stringify(cachedWindowState, null, 2));
  return cachedWindowState;
}

function collectCurrentWindowState() {
  if (!mainWindow) {
    return loadWindowState();
  }

  const bounds = mainWindow.getBounds();
  return saveWindowState({
    ...bounds,
    maximized: mainWindow.isMaximized(),
  });
}

function getProjectRoot() {
  return path.resolve(__dirname, "..");
}

function getBackendPort() {
  const parsed = Number.parseInt(process.env.CCR_PORT || `${DEFAULT_PORT}`, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function findDevPythonExecutable() {
  const candidates = process.platform === "win32"
    ? [
        path.join(getProjectRoot(), ".venv", "Scripts", "python.exe"),
        "python",
      ]
    : [
        path.join(getProjectRoot(), ".venv", "bin", "python"),
        "python3",
        "python",
      ];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
    if (!candidate.includes(path.sep)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function getPackagedBackendExecutable() {
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(process.resourcesPath, "backend", `remote-code-server${ext}`);
}

function getBackendCommandSpec() {
  if (app.isPackaged) {
    const executable = getPackagedBackendExecutable();
    if (!fs.existsSync(executable)) {
      throw new Error(`Packaged backend executable was not found: ${executable}`);
    }
    return {
      command: executable,
      args: [],
      cwd: undefined,
    };
  }

  return {
    command: findDevPythonExecutable(),
    args: [path.join(getProjectRoot(), "remote_code_server.py")],
    cwd: getProjectRoot(),
  };
}

function killBackendProcess() {
  if (!backendProcess || backendProcess.killed || backendProcess.exitCode !== null) {
    backendProcess = null;
    return;
  }

  backendExitExpected = true;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(backendProcess.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("exit", () => {
      backendProcess = null;
    });
    return;
  }

  backendProcess.kill("SIGTERM");
  const proc = backendProcess;
  setTimeout(() => {
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill("SIGKILL");
    }
  }, 5_000);
  backendProcess = null;
}

function startBackendProcess() {
  if (backendProcess && backendProcess.exitCode === null) {
    return;
  }

  const port = getBackendPort();
  const spec = getBackendCommandSpec();
  backendExitExpected = false;
  backendProcess = spawn(
    spec.command,
    [...spec.args, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: spec.cwd,
      env: {
        ...process.env,
        CCR_HOST: "127.0.0.1",
        CCR_PORT: String(port),
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  backendProcess.on("exit", (code, signal) => {
    const unexpected = !backendExitExpected && !isQuitting;
    backendProcess = null;
    if (unexpected) {
      dialog.showErrorBox(
        APP_PRODUCT_NAME,
        `The bundled backend exited unexpectedly.\ncode=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      app.quit();
    }
  });
}

function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          resolve();
          return;
        }
        retry();
      });

      request.on("error", retry);
      request.setTimeout(1_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 400);
    };

    attempt();
  });
}

function getAppUrl() {
  const devUrl = process.env.REMOTE_CODE_DEV_SERVER_URL;
  if (devUrl) {
    return devUrl;
  }
  return `http://127.0.0.1:${getBackendPort()}`;
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

    const appUrl = new URL(getAppUrl());
    return parsed.origin === appUrl.origin;
  } catch {
    return false;
  }
}

function isModifierShortcut(input) {
  return Boolean(input.control || input.meta);
}

function matchesMainProcessBrowserBlock(input) {
  const key = (input.key || "").toLowerCase();
  if (key === "f5") {
    return true;
  }

  if (!isModifierShortcut(input)) {
    return false;
  }

  if (key === "r" && currentFocusContext.kind !== "terminal") {
    return true;
  }

  if (key === "p" && currentFocusContext.kind !== "terminal") {
    return true;
  }

  return false;
}

function createMainWindow() {
  const state = loadWindowState();
  const windowOptions = {
    width: state.width || 1440,
    height: state.height || 960,
    x: typeof state.x === "number" ? state.x : undefined,
    y: typeof state.y === "number" ? state.y : undefined,
    show: false,
    backgroundColor: "#141820",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  const win = new BrowserWindow(windowOptions);
  Menu.setApplicationMenu(null);

  win.on("maximize", collectCurrentWindowState);
  win.on("unmaximize", collectCurrentWindowState);
  win.on("resize", collectCurrentWindowState);
  win.on("move", collectCurrentWindowState);
  win.on("close", collectCurrentWindowState);

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
    win.webContents.setIgnoreMenuShortcuts(true);
    if (matchesMainProcessBrowserBlock(input)) {
      event.preventDefault();
    }
  });

  win.once("ready-to-show", () => {
    if (state.maximized) {
      win.maximize();
    }
    win.show();
    win.focus();
  });

  mainWindow = win;
  return win;
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function bootstrapAppWindow() {
  startBackendProcess();
  await waitForUrl(`http://127.0.0.1:${getBackendPort()}${BACKEND_READY_PATH}`, HEALTH_TIMEOUT_MS);

  const appUrl = getAppUrl();
  if (process.env.REMOTE_CODE_DEV_SERVER_URL) {
    await waitForUrl(appUrl, RENDERER_TIMEOUT_MS);
  }

  const win = createMainWindow();
  await win.loadURL(appUrl);
}

if (singleInstanceLock) {
  app.on("second-instance", () => {
    focusMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  collectCurrentWindowState();
  killBackendProcess();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await bootstrapAppWindow();
    return;
  }
  focusMainWindow();
});

ipcMain.handle("runtime:get-info", () => ({
  runtime: "chromium",
  platform: process.platform,
  version: app.getVersion(),
}));

ipcMain.handle("app:open-folder-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("app:open-external", async (_event, url) => {
  if (typeof url !== "string" || !url.trim()) {
    return false;
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("app:show-notification", async (_event, payload) => {
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string") {
    return false;
  }
  if (!Notification.isSupported()) {
    return false;
  }
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: false,
  });
  notification.show();
  return true;
});

ipcMain.on("window:set-focus-context", (_event, context) => {
  if (!context || typeof context.kind !== "string") {
    currentFocusContext = { kind: "panel" };
    return;
  }
  currentFocusContext = {
    kind: context.kind,
    sessionType: typeof context.sessionType === "string" ? context.sessionType : undefined,
  };
});

ipcMain.handle("window:get-state", () => loadWindowState());

ipcMain.handle("window:save-state", (_event, state) => saveWindowState(state));

app.whenReady()
  .then(async () => {
    await bootstrapAppWindow();
  })
  .catch((error) => {
    dialog.showErrorBox(APP_PRODUCT_NAME, String(error instanceof Error ? error.message : error));
    app.quit();
  });
