/// <reference types="vite/client" />

interface Window {
  remoteCodeDesktop?: {
    getRuntimeInfo: () => Promise<{
      runtime: "chromium";
      platform: string;
      version: string;
    }>;
    openFolderDialog: () => Promise<string | null>;
    openExternal: (url: string) => Promise<boolean>;
    showNotification: (title: string, body: string) => Promise<boolean>;
    setFocusContext: (context: {
      kind: "terminal" | "ide" | "panel" | "form";
      sessionType?: string;
    }) => void;
    getWindowState: () => Promise<unknown>;
    saveWindowState: (state: unknown) => Promise<unknown>;
  };
}
