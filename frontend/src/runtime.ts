export interface DesktopRuntimeInfo {
  runtime: "chromium";
  platform: string;
  version: string;
  debugPerf?: boolean;
}

export interface DesktopFocusContext {
  kind: "terminal" | "ide" | "panel" | "form";
  sessionType?: string;
}

export interface DesktopLaunchContext {
  windowId: number;
  role: "main" | "project" | "session";
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workPath: string | null;
}

export interface DesktopWindowSummary {
  windowId: number;
  role: "main" | "project" | "session";
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workPath: string | null;
  title: string;
  hidden: boolean;
  focused: boolean;
  badgeCount: number;
  ownedSessionIds: string[];
}

export interface DesktopPreferences {
  closeBehavior: "tray" | "quit";
  launchAtLogin: boolean;
  trayHintShown?: boolean;
}

export interface RecentProject {
  projectId: string;
  name: string;
  workPath: string;
  lastOpenedAt: string;
}

export interface UpdateManifest {
  version: string;
  minimumSupportedVersion: string;
  platform: string;
  arch: string;
  assetName: string;
  downloadUrl: string;
  publishedAt: string;
}

export interface DesktopPresencePayload {
  projectId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  workPath?: string | null;
  ownedSessionIds?: string[];
}

type DesktopApi = {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  getLaunchContext: () => Promise<DesktopLaunchContext | null>;
  openProjectWindow: (project: {
    projectId: string;
    projectName?: string | null;
    workPath?: string | null;
  }) => Promise<DesktopWindowSummary | null>;
  openSessionWindow: (session: {
    sessionId: string;
    sessionName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    workPath?: string | null;
  }) => Promise<DesktopWindowSummary | null>;
  listOpenWindows: () => Promise<DesktopWindowSummary[]>;
  focusWindow: (windowId: number) => Promise<boolean>;
  syncPresence: (payload: DesktopPresencePayload) => void;
  openFolderDialog: () => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
  showNotification: (title: string, body: string) => Promise<boolean>;
  setFocusContext: (context: DesktopFocusContext) => void;
  getWindowState: () => Promise<unknown>;
  saveWindowState: (state: unknown) => Promise<unknown>;
  getDesktopPreferences: () => Promise<DesktopPreferences>;
  updateDesktopPreferences: (payload: Partial<DesktopPreferences>) => Promise<DesktopPreferences>;
  getRecentProjects: () => Promise<RecentProject[]>;
  recordRecentProject: (payload: RecentProject | Omit<RecentProject, "lastOpenedAt">) => Promise<RecentProject[]>;
  removeRecentProject: (projectId: string) => Promise<RecentProject[]>;
  setBadgeCount: (badgeCount: number) => Promise<number>;
  getCurrentVersion: () => Promise<string>;
  getLatestManifest: () => Promise<UpdateManifest | null>;
  onCommand: (listener: (payload: { type: string; projectId?: string }) => void) => () => void;
  onWindowRegistryUpdated: (listener: (payload: DesktopWindowSummary[]) => void) => () => void;
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
  return getDesktopApi()?.getRuntimeInfo() ?? null;
}

export async function getLaunchContext(): Promise<DesktopLaunchContext | null> {
  return getDesktopApi()?.getLaunchContext() ?? null;
}

export async function openProjectWindow(projectId: string, projectName?: string | null, workPath?: string | null): Promise<DesktopWindowSummary | null> {
  const api = getDesktopApi();
  if (!api) return null;
  return api.openProjectWindow({ projectId, projectName, workPath });
}

export async function openSessionWindow(
  sessionId: string,
  sessionName?: string | null,
  projectId?: string | null,
  projectName?: string | null,
  workPath?: string | null,
): Promise<DesktopWindowSummary | null> {
  const api = getDesktopApi();
  if (!api) return null;
  return api.openSessionWindow({ sessionId, sessionName, projectId, projectName, workPath });
}

export async function listOpenWindows(): Promise<DesktopWindowSummary[]> {
  return getDesktopApi()?.listOpenWindows() ?? [];
}

export async function focusDesktopWindow(windowId: number): Promise<boolean> {
  return getDesktopApi()?.focusWindow(windowId) ?? false;
}

export function syncDesktopPresence(payload: DesktopPresencePayload): void {
  getDesktopApi()?.syncPresence(payload);
}

export async function openFolderDialog(): Promise<string | null> {
  return getDesktopApi()?.openFolderDialog() ?? null;
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
  return getDesktopApi()?.showNotification(title, body) ?? false;
}

export function setDesktopFocusContext(context: DesktopFocusContext): void {
  getDesktopApi()?.setFocusContext(context);
}

export async function getDesktopPreferences(): Promise<DesktopPreferences | null> {
  return getDesktopApi()?.getDesktopPreferences() ?? null;
}

export async function updateDesktopPreferences(payload: Partial<DesktopPreferences>): Promise<DesktopPreferences | null> {
  return getDesktopApi()?.updateDesktopPreferences(payload) ?? null;
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  return getDesktopApi()?.getRecentProjects() ?? [];
}

export async function recordRecentProject(projectId: string, name: string, workPath: string): Promise<RecentProject[]> {
  const api = getDesktopApi();
  if (!api) return [];
  return api.recordRecentProject({ projectId, name, workPath });
}

export async function removeRecentProject(projectId: string): Promise<RecentProject[]> {
  return getDesktopApi()?.removeRecentProject(projectId) ?? [];
}

export async function setDesktopBadgeCount(badgeCount: number): Promise<number> {
  return getDesktopApi()?.setBadgeCount(badgeCount) ?? 0;
}

export async function getCurrentDesktopVersion(): Promise<string | null> {
  return getDesktopApi()?.getCurrentVersion() ?? null;
}

export async function getLatestUpdateManifest(): Promise<UpdateManifest | null> {
  return getDesktopApi()?.getLatestManifest() ?? null;
}

export function subscribeDesktopCommand(listener: (payload: { type: string; projectId?: string }) => void): () => void {
  return getDesktopApi()?.onCommand(listener) ?? (() => {});
}

export function subscribeDesktopWindowRegistry(listener: (payload: DesktopWindowSummary[]) => void): () => void {
  return getDesktopApi()?.onWindowRegistryUpdated(listener) ?? (() => {});
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
