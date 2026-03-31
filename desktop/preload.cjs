const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteCodeDesktop", {
  getRuntimeInfo: () => ipcRenderer.invoke("runtime:get-info"),
  openFolderDialog: () => ipcRenderer.invoke("app:open-folder-dialog"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  showNotification: (title, body) => ipcRenderer.invoke("app:show-notification", { title, body }),
  setFocusContext: (context) => ipcRenderer.send("window:set-focus-context", context),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  saveWindowState: (state) => ipcRenderer.invoke("window:save-state", state),
});
