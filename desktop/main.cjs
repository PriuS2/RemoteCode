const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");
const path = require("node:path");

const { createBackendManager } = require("./backend.cjs");
const { createDesktopStateManager } = require("./state.cjs");
const { createDesktopWindowManager } = require("./window-manager.cjs");

const SHARED_APP_NAME = "Remote Code";
const APP_PRODUCT_NAME = "Remote Code Desktop";

const sharedUserDataPath = path.join(app.getPath("appData"), SHARED_APP_NAME);
app.setPath("userData", sharedUserDataPath);
app.name = APP_PRODUCT_NAME;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

const stateManager = createDesktopStateManager(app);
const backendManager = createBackendManager({
  app,
  appProductName: APP_PRODUCT_NAME,
  dialog,
});
const windowManager = createDesktopWindowManager({
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  backendManager,
  stateManager,
  sharedAppName: SHARED_APP_NAME,
  appProductName: APP_PRODUCT_NAME,
});

if (singleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    windowManager.dispatchDesktopCommand(windowManager.parseDesktopCommand(argv));
  });
}

app.on("window-all-closed", () => {
  // Intentionally keep the app alive in the tray/background.
});

app.on("before-quit", () => {
  windowManager.markQuitting();
  backendManager.markQuitting();
  backendManager.stop();
});

app.on("activate", async () => {
  await windowManager.ensureMainWindow();
});

windowManager.registerIpc();

app.whenReady()
  .then(async () => {
    windowManager.buildStartupMenuState();
    await windowManager.ensureMainWindow();
    await windowManager.restoreRelaunchWindows();
    windowManager.dispatchDesktopCommand(windowManager.parseDesktopCommand(process.argv));
  })
  .catch((error) => {
    dialog.showErrorBox(APP_PRODUCT_NAME, String(error instanceof Error ? error.message : error));
    app.quit();
  });
