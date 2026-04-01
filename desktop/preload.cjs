const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld("remoteCodeDesktop", {
  getRuntimeInfo: () => ipcRenderer.invoke("runtime:get-info"),
  getLaunchContext: () => ipcRenderer.invoke("window:get-launch-context"),
  openProjectWindow: (project) => ipcRenderer.invoke("window:open-project", project),
  openSessionWindow: (session) => ipcRenderer.invoke("window:open-session", session),
  listOpenWindows: () => ipcRenderer.invoke("window:list-open-windows"),
  focusWindow: (windowId) => ipcRenderer.invoke("window:focus-window", windowId),
  syncPresence: (payload) => ipcRenderer.send("window:sync-presence", payload),
  openFolderDialog: () => ipcRenderer.invoke("app:open-folder-dialog"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  showNotification: (title, body) => ipcRenderer.invoke("app:show-notification", { title, body }),
  setFocusContext: (context) => ipcRenderer.send("window:set-focus-context", context),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  saveWindowState: (state) => ipcRenderer.invoke("window:save-state", state),
  getDesktopPreferences: () => ipcRenderer.invoke("app:get-desktop-preferences"),
  updateDesktopPreferences: (payload) => ipcRenderer.invoke("app:update-desktop-preferences", payload),
  getRecentProjects: () => ipcRenderer.invoke("app:get-recent-projects"),
  recordRecentProject: (payload) => ipcRenderer.invoke("app:record-recent-project", payload),
  removeRecentProject: (projectId) => ipcRenderer.invoke("app:remove-recent-project", projectId),
  revealInFileExplorer: (filePath) => ipcRenderer.invoke("app:reveal-in-file-explorer", filePath),
  setBadgeCount: (badgeCount) => ipcRenderer.invoke("app:set-badge-count", badgeCount),
  getCurrentVersion: () => ipcRenderer.invoke("updater:get-current-version"),
  getLatestManifest: () => ipcRenderer.invoke("updater:get-latest-manifest"),
  onCommand: (listener) => subscribe("app:command", listener),
  onWindowRegistryUpdated: (listener) => subscribe("window:registry-updated", listener),
});
