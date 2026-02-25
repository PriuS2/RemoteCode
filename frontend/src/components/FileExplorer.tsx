import { useState, useEffect, useCallback } from "react";
import { IconFolder, FileIcon } from "../utils/fileIcons";

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
  drives: string[] | null;
}

interface FileExplorerProps {
  token: string;
  rootPath: string;
  onInsertPath: (text: string) => void;
  onClose: () => void;
  isMobile: boolean;
}

type ViewMode = "grid" | "list";

function getRelativePath(rootPath: string, fullPath: string): string {
  // Normalize both paths: backslash → forward slash, remove trailing slash
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
  const root = norm(rootPath);
  const full = norm(fullPath);

  if (full.toLowerCase().startsWith(root.toLowerCase())) {
    const rel = full.slice(root.length).replace(/^\//, "");
    return rel ? `@./${rel}` : "@./";
  }
  // Outside root — use absolute (forward slashes)
  return `@${full}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FileExplorer({
  token,
  rootPath,
  onInsertPath,
  onClose,
  isMobile,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("fileExplorerView") as ViewMode) || "list";
  });
  const [showHidden, setShowHidden] = useState(false);

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/files?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to load");
      }
      const data: FilesResponse = await res.json();
      setCurrentPath(data.current);
      setEntries(data.entries);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFiles(rootPath);
  }, [rootPath, fetchFiles]);

  useEffect(() => {
    localStorage.setItem("fileExplorerView", viewMode);
  }, [viewMode]);

  const displayPath = getRelativePath(rootPath, currentPath);

  const visibleEntries = showHidden
    ? entries
    : entries.filter((e) => !e.name.startsWith("."));

  const handleNavigate = (folderName: string) => {
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "\\";
    fetchFiles(currentPath + sep + folderName);
  };

  const handleBack = () => {
    // Don't go above rootPath
    const normCur = currentPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const normRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    if (normCur === normRoot) return;

    const parent = currentPath.replace(/[\\/][^\\/]+$/, "");
    if (parent && parent !== currentPath) {
      fetchFiles(parent);
    }
  };

  const handleFileClick = (entry: FileEntry) => {
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "/";
    const fullPath = currentPath + sep + entry.name;
    const rel = getRelativePath(rootPath, fullPath);
    onInsertPath(rel);
  };

  const handleFolderInsert = (entry: FileEntry) => {
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "/";
    const fullPath = currentPath + sep + entry.name;
    const rel = getRelativePath(rootPath, fullPath);
    onInsertPath(rel.endsWith("/") ? rel : rel + "/");
  };

  const canGoBack = (() => {
    const normCur = currentPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const normRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    return normCur !== normRoot;
  })();

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <div
        style={{
          position: "fixed",
          top: 44,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          background: "#1e1e2e",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ExplorerHeader
          displayPath={displayPath}
          viewMode={viewMode}
          showHidden={showHidden}
          canGoBack={canGoBack}
          onBack={handleBack}
          onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
          onToggleHidden={() => setShowHidden((h) => !h)}
          onClose={onClose}
        />
        <ExplorerBody
          entries={visibleEntries}
          viewMode={viewMode}
          loading={loading}
          error={error}
          onNavigate={handleNavigate}
          onFileClick={handleFileClick}
          onFolderInsert={handleFolderInsert}
        />
      </div>
    );
  }

  // Desktop: inline panel
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        background: "#181825",
        borderRight: "1px solid #313244",
      }}
    >
      <ExplorerHeader
        displayPath={displayPath}
        viewMode={viewMode}
        showHidden={showHidden}
        canGoBack={canGoBack}
        onBack={handleBack}
        onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
        onToggleHidden={() => setShowHidden((h) => !h)}
        onClose={onClose}
      />
      <ExplorerBody
        entries={visibleEntries}
        viewMode={viewMode}
        loading={loading}
        error={error}
        onNavigate={handleNavigate}
        onFileClick={handleFileClick}
        onFolderInsert={handleFolderInsert}
      />
    </div>
  );
}

/* ---- Header ---- */

function ExplorerHeader({
  displayPath,
  viewMode,
  showHidden,
  canGoBack,
  onBack,
  onToggleView,
  onToggleHidden,
  onClose,
}: {
  displayPath: string;
  viewMode: ViewMode;
  showHidden: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onToggleView: () => void;
  onToggleHidden: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 6px",
        height: 28,
        borderBottom: "1px solid #313244",
        flexShrink: 0,
        background: "#181825",
      }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={!canGoBack}
        title="Back"
        style={{
          background: "none",
          border: "none",
          color: canGoBack ? "#cdd6f4" : "#45475a",
          cursor: canGoBack ? "pointer" : "default",
          padding: "2px 4px",
          display: "flex",
          alignItems: "center",
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2L4 6l4 4" />
        </svg>
      </button>

      {/* Path */}
      <span
        title={displayPath}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          color: "#89b4fa",
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
        }}
      >
        {displayPath}
      </span>

      {/* Hidden toggle */}
      <button
        onClick={onToggleHidden}
        title={showHidden ? "Hide hidden files" : "Show hidden files"}
        style={{
          background: "none",
          border: "none",
          color: showHidden ? "#a6e3a1" : "#6c7086",
          cursor: "pointer",
          padding: "2px 4px",
          fontSize: 10,
          fontWeight: 700,
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        .*
      </button>

      {/* View mode toggle */}
      <button
        onClick={onToggleView}
        title={viewMode === "grid" ? "List view" : "Grid view"}
        style={{
          background: "none",
          border: "none",
          color: "#6c7086",
          cursor: "pointer",
          padding: "2px 4px",
          display: "flex",
          alignItems: "center",
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        {viewMode === "grid" ? <ListIcon /> : <GridIcon />}
      </button>

      {/* Close */}
      <button
        onClick={onClose}
        title="Close"
        style={{
          background: "none",
          border: "none",
          color: "#6c7086",
          cursor: "pointer",
          padding: "2px 4px",
          display: "flex",
          alignItems: "center",
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  );
}

/* ---- Body ---- */

function ExplorerBody({
  entries,
  viewMode,
  loading,
  error,
  onNavigate,
  onFileClick,
  onFolderInsert,
}: {
  entries: FileEntry[];
  viewMode: ViewMode;
  loading: boolean;
  error: string | null;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onFolderInsert: (entry: FileEntry) => void;
}) {
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#6c7086", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 12, color: "#f38ba8", fontSize: 12 }}>{error}</div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#6c7086", fontSize: 12 }}>
        Empty folder
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 6,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
            gap: 2,
          }}
        >
          {entries.map((entry) => (
            <GridItem
              key={entry.name}
              entry={entry}
              onNavigate={onNavigate}
              onFileClick={onFileClick}
              onFolderInsert={onFolderInsert}
            />
          ))}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "2px 4px" }}>
      {entries.map((entry) => (
        <ListItem
          key={entry.name}
          entry={entry}
          onNavigate={onNavigate}
          onFileClick={onFileClick}
          onFolderInsert={onFolderInsert}
        />
      ))}
    </div>
  );
}

/* ---- Grid Item ---- */

function GridItem({
  entry,
  onNavigate,
  onFileClick,
  onFolderInsert,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onFolderInsert: (entry: FileEntry) => void;
}) {
  const isFolder = entry.type === "folder";

  return (
    <div
      onClick={() => {
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px 6px",
        borderRadius: 6,
        cursor: "pointer",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#313244";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {isFolder ? (
        <IconFolder size={32} />
      ) : (
        <FileIcon extension={entry.extension} size={32} />
      )}
      <span
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "#cdd6f4",
          textAlign: "center",
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={entry.name}
      >
        {entry.name}
      </span>
      {/* Folder @ insert button */}
      {isFolder && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFolderInsert(entry);
          }}
          title="Insert path"
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            background: "none",
            border: "none",
            color: "#6c7086",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 3,
            padding: "1px 3px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#a6e3a1";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#6c7086";
          }}
        >
          @
        </button>
      )}
    </div>
  );
}

/* ---- List Item ---- */

function ListItem({
  entry,
  onNavigate,
  onFileClick,
  onFolderInsert,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onFolderInsert: (entry: FileEntry) => void;
}) {
  const isFolder = entry.type === "folder";

  return (
    <div
      onClick={() => {
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
        color: "#cdd6f4",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#313244";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {isFolder ? (
        <IconFolder size={16} />
      ) : (
        <FileIcon extension={entry.extension} size={16} />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={entry.name}
      >
        {entry.name}
      </span>
      {/* Size (files only) */}
      {!isFolder && entry.size != null && (
        <span style={{ fontSize: 10, color: "#6c7086", flexShrink: 0 }}>
          {formatSize(entry.size)}
        </span>
      )}
      {/* Modified date */}
      {entry.modified && (
        <span style={{ fontSize: 10, color: "#6c7086", flexShrink: 0, minWidth: 0 }}>
          {formatDate(entry.modified)}
        </span>
      )}
      {/* Folder @ insert button */}
      {isFolder && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFolderInsert(entry);
          }}
          title="Insert path"
          style={{
            background: "none",
            border: "none",
            color: "#6c7086",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 3,
            padding: "1px 4px",
            flexShrink: 0,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#a6e3a1";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#6c7086";
          }}
        >
          @
        </button>
      )}
    </div>
  );
}

/* ---- Icons ---- */

const GridIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="1" y="1" width="4" height="4" rx="0.5" />
    <rect x="7" y="1" width="4" height="4" rx="0.5" />
    <rect x="1" y="7" width="4" height="4" rx="0.5" />
    <rect x="7" y="7" width="4" height="4" rx="0.5" />
  </svg>
);

const ListIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
    <line x1="1" y1="3" x2="11" y2="3" />
    <line x1="1" y1="6" x2="11" y2="6" />
    <line x1="1" y1="9" x2="11" y2="9" />
  </svg>
);
