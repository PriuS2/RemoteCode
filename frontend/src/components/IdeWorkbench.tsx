import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { FileIcon, IconFolder } from "../utils/fileIcons";
import { apiFetch, readErrorDetail } from "../utils/api";
import { joinPath } from "../utils/pathUtils";
import { loadMonacoEditor } from "../utils/loadMonaco";
import { GenericLspClient } from "../utils/genericLspClient";
import type { IdeFileResponse, IdeLanguageStatus, IdeSaveFileResponse } from "../types/api";

interface IdeWorkbenchProps {
  sessionId: string;
  rootPath: string;
  theme: "light" | "dark";
}

interface FileEntry {
  name: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
  extension: string | null;
}

interface FilesResponse {
  current: string;
  parent: string | null;
  entries: FileEntry[];
}

interface IdeTab {
  path: string;
  name: string;
  languageId: string;
  version: string | null;
  readonly: boolean;
  tooLarge: boolean;
  size: number;
  dirty: boolean;
  savedContent: string;
}

interface PersistedState {
  browserPath?: string;
  openPaths?: string[];
  activePath?: string | null;
  sidebarWidth?: number;
  viewStates?: Record<string, unknown>;
}

type LspRuntimeState = {
  connected: boolean;
  detail: string | null;
};

function storageKey(sessionId: string) {
  return `ide:${sessionId}`;
}

function readPersistedState(sessionId: string): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    return raw ? JSON.parse(raw) as PersistedState : {};
  } catch {
    return {};
  }
}

function fileNameFromPath(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getLanguageLabel(languageId: string, statuses: IdeLanguageStatus[]) {
  return statuses.find((status) => status.language_id === languageId)?.label ?? languageId;
}

function getLanguageStatusCopy(
  activeLanguageId: string | null,
  statuses: IdeLanguageStatus[],
  lspRuntimeStates: Record<string, LspRuntimeState>,
) {
  if (!activeLanguageId) {
    return {
      color: "var(--text-muted)",
      text: "No language service",
    };
  }

  const status = statuses.find((item) => item.language_id === activeLanguageId);
  if (!status) {
    return {
      color: "var(--text-muted)",
      text: `${activeLanguageId} language status unavailable`,
    };
  }

  if (status.transport !== "lsp") {
    return {
      color: status.available ? "var(--text-secondary)" : "var(--warn)",
      text: status.detail ?? `${status.label} support`,
    };
  }

  const runtime = lspRuntimeStates[activeLanguageId];
  if (runtime?.connected) {
    return {
      color: "var(--success)",
      text: runtime.detail ?? `${status.label} LSP ready`,
    };
  }

  if (!status.available) {
    return {
      color: "var(--warn)",
      text: status.detail ?? `${status.label} LSP unavailable`,
    };
  }

  return {
    color: "var(--text-muted)",
    text: runtime?.detail ?? status.detail ?? `${status.label} LSP idle`,
  };
}

function findSiblingTabPath(tabs: IdeTab[], closingPath: string) {
  const index = tabs.findIndex((tab) => tab.path === closingPath);
  if (index === -1) return null;
  return tabs[index + 1]?.path ?? tabs[index - 1]?.path ?? null;
}

export default function IdeWorkbench({ sessionId, rootPath, theme }: IdeWorkbenchProps) {
  const persistedState = useMemo(() => readPersistedState(sessionId), [sessionId]);
  const [browserPath, setBrowserPath] = useState(() => persistedState.browserPath || rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<IdeTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(() => persistedState.activePath || null);
  const [statuses, setStatuses] = useState<IdeLanguageStatus[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [issuesCount, setIssuesCount] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => persistedState.sidebarWidth ?? 270);
  const [editorReady, setEditorReady] = useState(false);
  const [editorBootError, setEditorBootError] = useState<string | null>(null);
  const [lspRuntimeStates, setLspRuntimeStates] = useState<Record<string, LspRuntimeState>>({});
  const persistedOpenPathsRef = useRef<string[]>(persistedState.openPaths ?? []);
  const viewStatesRef = useRef<Record<string, unknown>>(persistedState.viewStates ?? {});
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const dragHostRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(theme);
  const editorBootRequestRef = useRef(0);
  const editorBootingRef = useRef(false);
  const modelsRef = useRef(new Map<string, Monaco.editor.ITextModel>());
  const tabsRef = useRef<IdeTab[]>([]);
  const activePathRef = useRef<string | null>(activePath);
  const restoredRef = useRef(false);
  const markerDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const lspClientsRef = useRef(new Map<string, GenericLspClient>());

  tabsRef.current = tabs;
  activePathRef.current = activePath;
  themeRef.current = theme;

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const languageStatusMap = useMemo(
    () => new Map(statuses.map((status) => [status.language_id, status])),
    [statuses],
  );
  const activeLanguageStatus = useMemo(
    () => getLanguageStatusCopy(activeTab?.languageId ?? null, statuses, lspRuntimeStates),
    [activeTab?.languageId, lspRuntimeStates, statuses],
  );

  const fetchEntries = useCallback(async (path: string) => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const response = await apiFetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to load files");
        throw new Error(detail.message);
      }
      const data: FilesResponse = await response.json();
      setBrowserPath(data.current);
      setEntries(data.entries);
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "Failed to load files");
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  const fetchLanguages = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/ide/sessions/${sessionId}/languages`);
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to load IDE languages");
        throw new Error(detail.message);
      }
      const data: IdeLanguageStatus[] = await response.json();
      setStatuses(data);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load IDE language status");
    }
  }, [sessionId]);

  const updateIssueCount = useCallback(() => {
    const monaco = monacoRef.current;
    const currentPath = activePathRef.current;
    if (!monaco || !currentPath) {
      setIssuesCount(0);
      return;
    }

    const model = modelsRef.current.get(currentPath);
    if (!model) {
      setIssuesCount(0);
      return;
    }

    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    setIssuesCount(markers.length);
  }, []);

  const setRuntimeState = useCallback((languageId: string, state: LspRuntimeState) => {
    setLspRuntimeStates((prev) => {
      const current = prev[languageId];
      if (current?.connected === state.connected && current?.detail === state.detail) {
        return prev;
      }
      return { ...prev, [languageId]: state };
    });
  }, []);

  const getLspClient = useCallback((languageId: string) => {
    const monaco = monacoRef.current;
    const status = languageStatusMap.get(languageId);
    if (!monaco || !status || status.transport !== "lsp" || !status.available) {
      return null;
    }

    const existing = lspClientsRef.current.get(languageId);
    if (existing) {
      return existing;
    }

    const client = new GenericLspClient({
      monaco,
      sessionId,
      rootPath,
      languageId,
      languageLabel: status.label,
      onStateChange: (state) => setRuntimeState(languageId, state),
      onDiagnosticsChanged: updateIssueCount,
    });
    lspClientsRef.current.set(languageId, client);
    return client;
  }, [languageStatusMap, rootPath, sessionId, setRuntimeState, updateIssueCount]);

  const syncModelWithLsp = useCallback((model: Monaco.editor.ITextModel | null) => {
    if (!model) {
      return;
    }
    const client = getLspClient(model.getLanguageId());
    if (!client) {
      return;
    }
    client.ensureProviders();
    void client.openDocument(model);
  }, [getLspClient]);

  const queueModelSync = useCallback((model: Monaco.editor.ITextModel | null) => {
    if (!model) {
      return;
    }
    getLspClient(model.getLanguageId())?.queueDocumentSync(model);
  }, [getLspClient]);

  const notifyModelSaved = useCallback((model: Monaco.editor.ITextModel | null) => {
    if (!model) {
      return;
    }
    getLspClient(model.getLanguageId())?.notifySaved(model);
  }, [getLspClient]);

  const closeModelForLsp = useCallback((model: Monaco.editor.ITextModel | null) => {
    if (!model) {
      return;
    }
    getLspClient(model.getLanguageId())?.closeDocument(model);
  }, [getLspClient]);

  const persistState = useCallback(() => {
    const editor = editorRef.current;
    const currentPath = activePathRef.current;
    if (editor && currentPath) {
      viewStatesRef.current[currentPath] = editor.saveViewState() ?? null;
    }

    const payload: PersistedState = {
      browserPath,
      openPaths: tabsRef.current.map((tab) => tab.path),
      activePath: activePathRef.current,
      sidebarWidth,
      viewStates: viewStatesRef.current,
    };
    localStorage.setItem(storageKey(sessionId), JSON.stringify(payload));
  }, [browserPath, sessionId, sidebarWidth]);

  const upsertTab = useCallback((nextTab: IdeTab) => {
    setTabs((prev) => {
      const existingIndex = prev.findIndex((tab) => tab.path === nextTab.path);
      if (existingIndex === -1) {
        return [...prev, nextTab];
      }
      const next = [...prev];
      next[existingIndex] = nextTab;
      return next;
    });
  }, []);

  const setEditorModel = useCallback((filePath: string | null) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) {
      return;
    }

    const previousPath = activePathRef.current;
    if (previousPath) {
      viewStatesRef.current[previousPath] = editor.saveViewState() ?? null;
    }

    if (!filePath) {
      editor.setModel(null);
      setIssuesCount(0);
      return;
    }

    const model = modelsRef.current.get(filePath);
    const tab = tabsRef.current.find((item) => item.path === filePath);
    if (!model || !tab) {
      editor.setModel(null);
      setIssuesCount(0);
      return;
    }

    editor.setModel(model);
    editor.updateOptions({ readOnly: tab.readonly || tab.tooLarge });
    const savedState = viewStatesRef.current[filePath];
    if (savedState) {
      editor.restoreViewState(savedState as Monaco.editor.ICodeEditorViewState);
    } else {
      editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      editor.setPosition({ lineNumber: 1, column: 1 });
    }
    editor.focus();
    updateIssueCount();
    syncModelWithLsp(model);
  }, [syncModelWithLsp, updateIssueCount]);

  const openFile = useCallback(async (filePath: string, forceReload = false) => {
    const existing = tabsRef.current.find((tab) => tab.path === filePath);
    if (existing && !forceReload) {
      setActivePath(filePath);
      setEditorModel(filePath);
      return;
    }

    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/ide/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`);
      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to open file");
        throw new Error(detail.message);
      }

      const file: IdeFileResponse = await response.json();
      const monaco = monacoRef.current;
      if (!monaco) {
        return;
      }

      const uri = monaco.Uri.file(file.path);
      let model = modelsRef.current.get(file.path) ?? monaco.editor.getModel(uri) ?? null;
      if (!model) {
        model = monaco.editor.createModel(file.content, file.language_id, uri);
        modelsRef.current.set(file.path, model);
      } else {
        const previousLanguageId = model.getLanguageId();
        if (previousLanguageId !== file.language_id) {
          getLspClient(previousLanguageId)?.closeDocument(model);
          monaco.editor.setModelLanguage(model, file.language_id);
        }
        model.setValue(file.content);
      }

      const nextTab: IdeTab = {
        path: file.path,
        name: fileNameFromPath(file.path),
        languageId: file.language_id,
        version: file.version,
        readonly: file.readonly,
        tooLarge: file.too_large,
        size: file.size,
        dirty: false,
        savedContent: file.content,
      };
      upsertTab(nextTab);
      setActivePath(file.path);
      window.setTimeout(() => setEditorModel(file.path), 0);

      if (file.too_large) {
        setStatusMessage(`${nextTab.name} is larger than 1 MB and opened read-only.`);
      } else if (file.readonly) {
        setStatusMessage(`${nextTab.name} opened read-only.`);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to open file");
    }
  }, [getLspClient, sessionId, setEditorModel, upsertTab]);

  const saveActiveTab = useCallback(async () => {
    const tab = tabsRef.current.find((item) => item.path === activePathRef.current);
    const model = tab ? modelsRef.current.get(tab.path) ?? null : null;
    if (!tab || !model || tab.readonly || tab.tooLarge || !tab.dirty) {
      return;
    }

    setSavePending(true);
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/ide/sessions/${sessionId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: tab.path,
          content: model.getValue(),
          expected_version: tab.version,
        }),
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response, "Failed to save file");
        throw new Error(detail.message);
      }

      const result: IdeSaveFileResponse = await response.json();
      upsertTab({
        ...tab,
        version: result.version,
        size: result.size,
        dirty: false,
        savedContent: model.getValue(),
      });
      setStatusMessage(`Saved ${tab.name}`);
      notifyModelSaved(model);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save file");
    } finally {
      setSavePending(false);
    }
  }, [notifyModelSaved, sessionId, upsertTab]);

  const closeTab = useCallback((filePath: string) => {
    const nextActive = findSiblingTabPath(tabsRef.current, filePath);
    const model = modelsRef.current.get(filePath) ?? null;
    if (model) {
      closeModelForLsp(model);
      model.dispose();
      modelsRef.current.delete(filePath);
      delete viewStatesRef.current[filePath];
    }

    setTabs((prev) => prev.filter((tab) => tab.path !== filePath));
    if (activePathRef.current === filePath) {
      setActivePath(nextActive);
      window.setTimeout(() => setEditorModel(nextActive), 0);
    }
  }, [closeModelForLsp, setEditorModel]);

  const bootEditor = useCallback(async () => {
    if (!editorHostRef.current || editorRef.current || editorBootingRef.current) {
      return;
    }

    const requestId = ++editorBootRequestRef.current;
    editorBootingRef.current = true;

    try {
      const monaco = await loadMonacoEditor();
      if (requestId !== editorBootRequestRef.current) {
        return;
      }

      const host = editorHostRef.current;
      if (!host || editorRef.current) {
        return;
      }

      monacoRef.current = monaco;
      monaco.editor.setTheme(themeRef.current === "dark" ? "vs-dark" : "vs");

      const editor = monaco.editor.create(host, {
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        roundedSelection: true,
        smoothScrolling: true,
        tabSize: 2,
        insertSpaces: true,
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveActiveTab();
      });

      editor.onDidChangeModelContent(() => {
        const currentPath = activePathRef.current;
        const currentModel = currentPath ? modelsRef.current.get(currentPath) ?? null : null;
        if (!currentPath || !currentModel) {
          return;
        }

        setTabs((prev) => prev.map((tab) => {
          if (tab.path !== currentPath) {
            return tab;
          }
          const dirty = currentModel.getValue() !== tab.savedContent;
          return dirty === tab.dirty ? tab : { ...tab, dirty };
        }));

        queueModelSync(currentModel);
      });

      markerDisposableRef.current = monaco.editor.onDidChangeMarkers(() => {
        updateIssueCount();
      });

      editorRef.current = editor;
      setEditorReady(true);
    } catch (error) {
      setEditorBootError(error instanceof Error ? error.message : "Failed to initialize Monaco");
    } finally {
      if (requestId === editorBootRequestRef.current) {
        editorBootingRef.current = false;
      }
    }
  }, [queueModelSync, saveActiveTab, updateIssueCount]);

  useEffect(() => {
    void fetchEntries(browserPath);
  }, [browserPath, fetchEntries]);

  useEffect(() => {
    void fetchLanguages();
  }, [fetchLanguages]);

  useEffect(() => {
    void bootEditor();
    return () => {
      editorBootRequestRef.current += 1;
      editorBootingRef.current = false;
      markerDisposableRef.current?.dispose();
      markerDisposableRef.current = null;
      lspClientsRef.current.forEach((client) => client.dispose());
      lspClientsRef.current.clear();
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
      modelsRef.current.forEach((model) => model.dispose());
      modelsRef.current.clear();
      if (editorHostRef.current) {
        editorHostRef.current.innerHTML = "";
      }
    };
  }, [bootEditor]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) {
      return;
    }
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useEffect(() => {
    const host = editorHostRef.current;
    const editor = editorRef.current;
    if (!host || !editor) {
      return;
    }

    const observer = new ResizeObserver(() => {
      editor.layout();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [editorReady]);

  useEffect(() => {
    if (!editorReady || restoredRef.current || persistedOpenPathsRef.current.length === 0) {
      return;
    }

    restoredRef.current = true;
    const run = async () => {
      for (const filePath of persistedOpenPathsRef.current) {
        await openFile(filePath);
      }
      if (persistedState.activePath) {
        setActivePath(persistedState.activePath);
        setEditorModel(persistedState.activePath);
      }
    };
    void run();
  }, [editorReady, openFile, persistedState.activePath, setEditorModel]);

  useEffect(() => {
    persistState();
  }, [activePath, browserPath, persistState, sidebarWidth, tabs]);

  useEffect(() => {
    if (!activePath) {
      setEditorModel(null);
      return;
    }
    setEditorModel(activePath);
  }, [activePath, setEditorModel]);

  const startSidebarDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const host = dragHostRef.current;
    const startLeft = host?.getBoundingClientRect().left ?? 0;

    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(220, Math.min(420, moveEvent.clientX - startLeft));
      setSidebarWidth(nextWidth);
    };

    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const sortedEntries = useMemo(() => {
    const folders = entries.filter((entry) => entry.type === "folder");
    const files = entries.filter((entry) => entry.type === "file");
    return [...folders, ...files];
  }, [entries]);

  return (
    <div
      ref={dragHostRef}
      style={{ height: "100%", display: "flex", minHeight: 0, background: "var(--surface-1)" }}
    >
      <aside
        className="ide-workbench-sidebar"
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                IDE Session
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                Explorer
              </div>
            </div>
            <button
              type="button"
              className="terminal-tool-button"
              title="Refresh explorer"
              onClick={() => { void fetchEntries(browserPath); }}
            >
              Refresh
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all" }}>
            {browserPath}
          </div>
        </div>

        <div style={{ padding: "8px 8px 0" }}>
          <button
            type="button"
            className="secondary-button"
            style={{ width: "100%", padding: "8px 10px", fontSize: 12 }}
            disabled={browserPath === rootPath}
            onClick={() => {
              if (browserPath === rootPath) {
                return;
              }
              const nextPath = browserPath.replace(/[\\/][^\\/]+$/, "") || rootPath;
              setBrowserPath(nextPath);
            }}
          >
            Up One Level
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
          {entriesLoading && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>Loading files...</div>
          )}
          {entriesError && (
            <div style={{ padding: 16, color: "var(--danger)", fontSize: 12 }}>{entriesError}</div>
          )}
          {!entriesLoading && !entriesError && sortedEntries.map((entry) => {
            const fullPath = joinPath(browserPath, entry.name);
            const isActiveFile = entry.type === "file" && activePath === fullPath;

            return (
              <button
                key={fullPath}
                type="button"
                onClick={() => {
                  if (entry.type === "folder") {
                    setBrowserPath(fullPath);
                    return;
                  }
                  void openFile(fullPath);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid transparent",
                  background: isActiveFile ? "color-mix(in srgb, var(--accent) 16%, var(--surface-2))" : "transparent",
                  color: "var(--text-primary)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 4,
                }}
              >
                {entry.type === "folder" ? <IconFolder size={16} /> : <FileIcon extension={entry.extension} size={16} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {entry.type === "folder" ? "Folder" : formatBytes(entry.size ?? 0)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div
        className="ide-workbench-drag-handle"
        onMouseDown={startSidebarDrag}
        style={{
          width: 6,
          cursor: "col-resize",
          flexShrink: 0,
        }}
      />

      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-2)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", overflowX: "auto" }}>
            {tabs.length === 0 && (
              <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-muted)" }}>
                Open a file to start editing.
              </div>
            )}
            {tabs.map((tab) => (
              <div
                key={tab.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  maxWidth: 240,
                  padding: "10px 12px",
                  borderRight: "1px solid var(--border-subtle)",
                  background: tab.path === activePath ? "var(--surface-1)" : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => setActivePath(tab.path)}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 0,
                  }}
                >
                  <FileIcon extension={tab.path.split(".").length > 1 ? `.${tab.path.split(".").pop()}` : null} size={14} />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {tab.name}
                  </span>
                  {tab.dirty && <span style={{ color: "var(--warn)", fontSize: 11 }}>*</span>}
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(tab.path)}
                  style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                  aria-label={`Close ${tab.name}`}
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 8,
              borderLeft: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => { void saveActiveTab(); }}
              disabled={!activeTab || !activeTab.dirty || activeTab.readonly || activeTab.tooLarge || savePending}
              style={{ padding: "8px 12px", fontSize: 12 }}
            >
              {savePending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => { if (activePath) void openFile(activePath, true); }}
              disabled={!activePath}
              style={{ padding: "8px 12px", fontSize: 12 }}
            >
              Reload
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            style={{
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--text-secondary)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {statusMessage}
          </div>
        )}

        {!editorReady && !editorBootError && (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            Loading Monaco editor...
          </div>
        )}

        {editorBootError && (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            {editorBootError}
          </div>
        )}

        <div ref={editorHostRef} style={{ flex: 1, minHeight: 0, display: editorBootError ? "none" : "block" }} />

        <div
          className="ide-workbench-statusbar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 12px",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: 11,
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span>{activeTab ? getLanguageLabel(activeTab.languageId, statuses) : "No file"}</span>
            <span>{activeTab ? formatBytes(activeTab.size) : "0 B"}</span>
            <span style={{ color: issuesCount > 0 ? "var(--warn)" : "var(--text-muted)" }}>
              {issuesCount} issue{issuesCount === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: activeLanguageStatus.color }}>
              {activeLanguageStatus.text}
            </span>
            <span>{activeTab?.dirty ? "Unsaved changes" : "Saved"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
