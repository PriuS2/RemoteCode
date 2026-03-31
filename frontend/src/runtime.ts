export interface DesktopRuntimeInfo {
  runtime: "chromium";
  platform: string;
  version: string;
}

export interface DesktopFocusContext {
  kind: "terminal" | "ide" | "panel" | "form";
  sessionType?: string;
}

type DesktopApi = {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  openFolderDialog: () => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
  showNotification: (title: string, body: string) => Promise<boolean>;
  setFocusContext: (context: DesktopFocusContext) => void;
  getWindowState: () => Promise<unknown>;
  saveWindowState: (state: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    remoteCodeDesktop?: DesktopApi;
  }
}

function getDesktopApi(): DesktopApi | null {
  return typeof window !== "undefined" ? window.remoteCodeDesktop ?? null : null;
}

function normalizeKey(rawKey: string): string {
  const key = rawKey.toLowerCase();
  if (key === "left") return "arrowleft";
  if (key === "right") return "arrowright";
  if (key === "esc") return "escape";
  return key;
}

function hasCtrlOrMeta(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("[contenteditable='true']"));
}

function isLocalNetworkHost(hostname: string): boolean {
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("192.168.")
    || hostname.startsWith("10.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function isGlobalBrowserShortcut(event: KeyboardEvent): boolean {
  const key = normalizeKey(event.key);

  if (key === "f5" || key === "browserback" || key === "browserforward") {
    return true;
  }

  if (event.altKey && (key === "arrowleft" || key === "arrowright")) {
    return true;
  }

  if (!hasCtrlOrMeta(event)) {
    return false;
  }

  if (["r", "p", "o", "t", "n", "w", "s"].includes(key)) {
    return true;
  }

  return ["0", "=", "+", "-", "_"].includes(key);
}

function isTerminalProtectedShortcut(event: KeyboardEvent): boolean {
  const key = normalizeKey(event.key);

  if (event.altKey && ["arrowleft", "arrowright", "b", "d", "f", "v"].includes(key)) {
    return true;
  }

  if (key === "home" || key === "end") {
    return true;
  }

  if (event.shiftKey && key === "enter") {
    return true;
  }

  if (!hasCtrlOrMeta(event)) {
    return false;
  }

  return [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "k",
    "r",
    "u",
    "v",
    "w",
    "x",
    "z",
    "arrowleft",
    "arrowright",
    "backspace",
    "delete",
  ].includes(key);
}

export function isDesktopChromium(): boolean {
  return Boolean(getDesktopApi());
}

export function canUseLocalDesktopFeatures(): boolean {
  if (isDesktopChromium()) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return isLocalNetworkHost(window.location.hostname);
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  const api = getDesktopApi();
  if (!api) {
    return null;
  }
  return api.getRuntimeInfo();
}

export async function openFolderDialog(): Promise<string | null> {
  const api = getDesktopApi();
  if (!api) {
    return null;
  }
  return api.openFolderDialog();
}

export async function openExternal(url: string): Promise<void> {
  const api = getDesktopApi();
  if (api) {
    await api.openExternal(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function showDesktopNotification(title: string, body: string): Promise<boolean> {
  const api = getDesktopApi();
  if (!api) {
    return false;
  }
  return api.showNotification(title, body);
}

export function setDesktopFocusContext(context: DesktopFocusContext): void {
  const api = getDesktopApi();
  if (!api) {
    return;
  }
  api.setFocusContext(context);
}

export function installDesktopExternalLinkHandler(): () => void {
  if (!isDesktopChromium()) {
    return () => {};
  }

  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const href = anchor.href;
    if (!href.startsWith("http://") && !href.startsWith("https://")) {
      return;
    }

    if (href.startsWith(window.location.origin)) {
      return;
    }

    event.preventDefault();
    void openExternal(href);
  };

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

export function installDesktopShortcutGuard(getContext: () => DesktopFocusContext): () => void {
  if (!isDesktopChromium()) {
    return () => {};
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const context = getContext();
    const editableTarget = isEditableTarget(event.target);

    if (isGlobalBrowserShortcut(event)) {
      event.preventDefault();
      return;
    }

    if (editableTarget) {
      return;
    }

    if (context.kind === "terminal" && isTerminalProtectedShortcut(event)) {
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
