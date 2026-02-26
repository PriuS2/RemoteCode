import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { IconFolder, FileIcon } from "../utils/fileIcons";
import hljs from "highlight.js";

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

interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}
type ContextMenuEntry = ContextMenuItem | "separator";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".tsv", ".log", ".json", ".jsonl",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".pyw", ".pyi",
  ".rs", ".go", ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".rb", ".php", ".swift", ".scala", ".lua", ".r",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".sql", ".graphql", ".gql",
  ".sh", ".bash", ".zsh", ".fish", ".bat", ".ps1", ".cmd",
  ".dockerfile", ".gitignore", ".gitattributes", ".editorconfig",
  ".makefile", ".cmake",
  ".lock", ".pid",
]);

const TEXT_NAMES = new Set([
  "makefile", "dockerfile", "vagrantfile", "procfile",
  "gemfile", "rakefile", "cmakelists.txt",
  ".gitignore", ".gitattributes", ".editorconfig",
  ".prettierrc", ".eslintrc", ".babelrc",
  "license", "readme", "changelog", "authors",
]);

function isTextFile(ext: string | null, name?: string): boolean {
  if (ext && TEXT_EXTENSIONS.has(ext.toLowerCase())) return true;
  if (name && TEXT_NAMES.has(name.toLowerCase())) return true;
  return false;
}

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg",
]);

function isImageFile(ext: string | null): boolean {
  return ext !== null && IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".wma", ".opus",
]);

function isAudioFile(ext: string | null): boolean {
  return ext !== null && AUDIO_EXTENSIONS.has(ext.toLowerCase());
}

interface PreviewFile {
  name: string;
  path: string;
  extension: string | null;
}

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
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewSize, setPreviewSize] = useState(0);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; entry: FileEntry;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUrlRef = useRef<string | null>(null);

  const setImageUrl = useCallback((url: string | null) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = url;
    setPreviewImageUrl(url);
  }, []);

  useEffect(() => {
    return () => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); };
  }, []);

  const isLocal = (() => {
    const h = window.location.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.startsWith("192.168.") ||
      h.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  })();

  const handleOpenNative = useCallback(async (path?: string) => {
    try {
      await fetch("/api/open-explorer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: path ?? currentPath }),
      });
    } catch {
      // ignore
    }
  }, [token, currentPath]);

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

    if (isTextFile(entry.extension, entry.name)) {
      openPreview({ name: entry.name, path: fullPath, extension: entry.extension });
    } else if (isImageFile(entry.extension)) {
      openImagePreview({ name: entry.name, path: fullPath, extension: entry.extension });
    } else if (isAudioFile(entry.extension)) {
      openImagePreview({ name: entry.name, path: fullPath, extension: entry.extension });
    } else {
      const rel = getRelativePath(rootPath, fullPath);
      onInsertPath(rel);
    }
  };

  const openPreview = useCallback(async (file: PreviewFile) => {
    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewContent("");
    setPreviewTruncated(false);
    try {
      const res = await fetch(
        `/api/file-content?path=${encodeURIComponent(file.path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to read file");
      }
      const data = await res.json();
      setPreviewContent(data.content);
      setPreviewTruncated(data.truncated);
      setPreviewSize(data.size);
    } catch (e: unknown) {
      setPreviewContent(e instanceof Error ? `Error: ${e.message}` : "Failed to read file");
    } finally {
      setPreviewLoading(false);
    }
  }, [token]);

  const openImagePreview = useCallback(async (file: PreviewFile) => {
    setImageUrl(null);
    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewContent("");
    try {
      const res = await fetch(
        `/api/file-raw?path=${encodeURIComponent(file.path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Failed to load image");
      const blob = await res.blob();
      setImageUrl(URL.createObjectURL(blob));
      setPreviewSize(blob.size);
    } catch (e: unknown) {
      setPreviewContent(e instanceof Error ? `Error: ${e.message}` : "Failed to load image");
    } finally {
      setPreviewLoading(false);
    }
  }, [token, setImageUrl]);

  const handleInsertEntry = (entry: FileEntry) => {
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "/";
    const fullPath = currentPath + sep + entry.name;
    const rel = getRelativePath(rootPath, fullPath);
    if (entry.type === "folder") {
      onInsertPath(rel.endsWith("/") ? rel : rel + "/");
    } else {
      onInsertPath(rel);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const downloadFile = useCallback(async (fullPath: string, fileName: string) => {
    try {
      const res = await fetch(
        `/api/file-raw?path=${encodeURIComponent(fullPath)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, [token]);

  const canPreview = useCallback((entry: FileEntry) => {
    return isTextFile(entry.extension, entry.name) || isImageFile(entry.extension) || isAudioFile(entry.extension);
  }, []);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!contextMenu) return [];
    const entry = contextMenu.entry;
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "/";
    const fullPath = currentPath + sep + entry.name;

    if (entry.type === "folder") {
      const items: ContextMenuEntry[] = [
        { label: "열기", icon: <CtxFolderOpenIcon />, onClick: () => { handleNavigate(entry.name); closeContextMenu(); } },
      ];
      if (isLocal) {
        items.push({ label: "탐색기에서 열기", icon: <CtxOpenExternalIcon />, onClick: () => { handleOpenNative(fullPath); closeContextMenu(); } });
      }
      items.push("separator");
      items.push({ label: "경로 삽입 (@)", icon: <CtxAtIcon />, onClick: () => { handleInsertEntry(entry); closeContextMenu(); } });
      items.push({ label: "이름 복사", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(entry.name); closeContextMenu(); } });
      items.push({ label: "전체 경로 복사", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(fullPath); closeContextMenu(); } });
      return items;
    }

    // File menu
    const items: ContextMenuEntry[] = [];
    if (canPreview(entry)) {
      items.push({ label: "열기 (프리뷰)", icon: <CtxPreviewIcon />, onClick: () => { handleFileClick(entry); closeContextMenu(); } });
    }
    if (isLocal) {
      items.push({ label: "열기 (파일)", icon: <CtxOpenFileIcon />, onClick: () => { handleOpenNative(fullPath); closeContextMenu(); } });
      items.push({ label: "경로 열기", icon: <CtxOpenExternalIcon />, onClick: () => { handleOpenNative(currentPath); closeContextMenu(); } });
    }
    items.push({ label: "다운로드", icon: <CtxDownloadIcon />, onClick: () => { downloadFile(fullPath, entry.name); closeContextMenu(); } });
    items.push("separator");
    items.push({ label: "경로 삽입 (@)", icon: <CtxAtIcon />, onClick: () => { handleInsertEntry(entry); closeContextMenu(); } });
    items.push({ label: "이름 복사", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(entry.name); closeContextMenu(); } });
    items.push({ label: "전체 경로 복사", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(fullPath); closeContextMenu(); } });
    return items;
  }, [contextMenu, currentPath, isLocal, handleOpenNative, downloadFile, closeContextMenu, canPreview]);

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(`Uploading ${files.length} file(s)...`);
    try {
      const formData = new FormData();
      for (const f of files) formData.append("files", f);
      const res = await fetch(
        `/api/upload?path=${encodeURIComponent(currentPath)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Upload failed");
      }
      const data = await res.json();
      setUploadProgress(`${data.count} file(s) uploaded`);
      fetchFiles(currentPath);
      setTimeout(() => setUploadProgress(""), 2000);
    } catch (e: unknown) {
      setUploadProgress(e instanceof Error ? e.message : "Upload failed");
      setTimeout(() => setUploadProgress(""), 3000);
    } finally {
      setUploading(false);
    }
  }, [currentPath, token, fetchFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (previewFile) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) uploadFiles(files);
  }, [uploadFiles, previewFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!previewFile) setDragOver(true);
  }, [previewFile]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only close if leaving the container (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const canGoBack = (() => {
    const normCur = currentPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const normRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    return normCur !== normRoot;
  })();

  const handleInsertPreviewPath = () => {
    if (!previewFile) return;
    const rel = getRelativePath(rootPath, previewFile.path);
    onInsertPath(rel);
  };

  const handleInsertSelection = (startLine: number, endLine: number, text: string) => {
    if (!previewFile) return;
    const rel = getRelativePath(rootPath, previewFile.path);
    const lineRange = startLine === endLine
      ? `{line : ${startLine}}`
      : `{line : ${startLine}:${endLine}}`;
    onInsertPath(`${rel}\n${lineRange}\n${text}`);
  };

  const closePreview = useCallback(() => {
    setImageUrl(null);
    setPreviewFile(null);
    setPreviewContent("");
  }, [setImageUrl]);

  const isImagePreview = previewFile !== null && isImageFile(previewFile.extension);
  const isAudioPreview = previewFile !== null && isAudioFile(previewFile.extension);

  const bodyOrPreview = previewFile ? (
    isImagePreview ? (
      <ImagePreview
        file={previewFile}
        imageUrl={previewImageUrl}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewContent || null}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
      />
    ) : isAudioPreview ? (
      <AudioPreview
        file={previewFile}
        audioUrl={previewImageUrl}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewContent || null}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
      />
    ) : (
      <FilePreview
        file={previewFile}
        content={previewContent}
        loading={previewLoading}
        truncated={previewTruncated}
        size={previewSize}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
        onInsertSelection={handleInsertSelection}
      />
    )
  ) : (
    <ExplorerBody
      entries={visibleEntries}
      viewMode={viewMode}
      loading={loading}
      error={error}
      canGoBack={canGoBack}
      onBack={handleBack}
      onNavigate={handleNavigate}
      onFileClick={handleFileClick}
      onInsertEntry={handleInsertEntry}
      onContextMenu={handleContextMenu}
    />
  );

  const uploadOverlay = dragOver && !previewFile && (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(166,227,161,0.08)",
        border: "2px dashed #a6e3a1",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <UploadIcon size={32} />
        <span style={{ color: "#a6e3a1", fontSize: 13, fontWeight: 600 }}>Drop files to upload</span>
      </div>
    </div>
  );

  const uploadStatus = uploadProgress && (
    <div style={{
      padding: "4px 8px",
      fontSize: 11,
      color: uploading ? "#89b4fa" : uploadProgress.includes("failed") || uploadProgress.includes("denied") || uploadProgress.includes("large") ? "#f38ba8" : "#a6e3a1",
      background: "#181825",
      borderTop: "1px solid #313244",
      textAlign: "center",
      flexShrink: 0,
    }}>
      {uploading && "⏳ "}{uploadProgress}
    </div>
  );

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      style={{ display: "none" }}
      onChange={(e) => {
        if (e.target.files && e.target.files.length > 0) {
          uploadFiles(e.target.files);
        }
        e.target.value = "";
      }}
    />
  );

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
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
        {hiddenInput}
        <ExplorerHeader
          displayPath={displayPath}
          viewMode={viewMode}
          showHidden={showHidden}
          canGoBack={canGoBack}
          onBack={handleBack}
          onRefresh={() => fetchFiles(currentPath)}
          isLocal={isLocal}
          onOpenNative={() => handleOpenNative()}
          onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
          onToggleHidden={() => setShowHidden((h) => !h)}
          onUpload={() => fileInputRef.current?.click()}
          onClose={onClose}
          isPreview={!!previewFile}
        />
        {bodyOrPreview}
        {uploadStatus}
        {uploadOverlay}
        {contextMenu && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenuItems} onClose={closeContextMenu} />
        )}
      </div>
    );
  }

  // Desktop: inline panel
  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        background: "#181825",
        borderRight: "1px solid #313244",
        position: "relative",
      }}
    >
      {hiddenInput}
      <ExplorerHeader
        displayPath={displayPath}
        viewMode={viewMode}
        showHidden={showHidden}
        canGoBack={canGoBack}
        onBack={handleBack}
        onRefresh={() => fetchFiles(currentPath)}
        isLocal={isLocal}
        onOpenNative={() => handleOpenNative()}
        onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
        onToggleHidden={() => setShowHidden((h) => !h)}
        onUpload={() => fileInputRef.current?.click()}
        onClose={onClose}
        isPreview={!!previewFile}
      />
      {bodyOrPreview}
      {uploadStatus}
      {uploadOverlay}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenuItems} onClose={closeContextMenu} />
      )}
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
  onRefresh,
  isLocal,
  onOpenNative,
  onToggleView,
  onToggleHidden,
  onUpload,
  onClose,
  isPreview,
}: {
  displayPath: string;
  viewMode: ViewMode;
  showHidden: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onRefresh: () => void;
  isLocal: boolean;
  onOpenNative: () => void;
  onToggleView: () => void;
  onToggleHidden: () => void;
  onUpload: () => void;
  onClose: () => void;
  isPreview?: boolean;
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

      {!isPreview && (
        <>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            title="Refresh"
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
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            <RefreshIcon />
          </button>

          {/* Open in system explorer (local network only) */}
          {isLocal && (
            <button
              onClick={onOpenNative}
              title="Open in system explorer"
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
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#f9e2af"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
            >
              <OpenExternalIcon />
            </button>
          )}

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

          {/* Upload */}
          <button
            onClick={onUpload}
            title="Upload files"
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
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#a6e3a1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            <UploadIcon />
          </button>
        </>
      )}

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
  canGoBack,
  onBack,
  onNavigate,
  onFileClick,
  onInsertEntry,
  onContextMenu,
}: {
  entries: FileEntry[];
  viewMode: ViewMode;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  onBack: () => void;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onInsertEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
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
          {canGoBack && <ParentGridItem onBack={onBack} />}
          {entries.map((entry) => (
            <GridItem
              key={entry.name}
              entry={entry}
              onNavigate={onNavigate}
              onFileClick={onFileClick}
              onInsertEntry={onInsertEntry}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "2px 4px" }}>
      {canGoBack && <ParentListItem onBack={onBack} />}
      {entries.map((entry) => (
        <ListItem
          key={entry.name}
          entry={entry}
          onNavigate={onNavigate}
          onFileClick={onFileClick}
          onInsertEntry={onInsertEntry}
          onContextMenu={onContextMenu}
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
  onInsertEntry,
  onContextMenu,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onInsertEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}) {
  const isFolder = entry.type === "folder";

  return (
    <div
      onClick={() => {
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      onContextMenu={(e) => onContextMenu(e, entry)}
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
      {/* @ insert button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onInsertEntry(entry);
        }}
        title="Insert path"
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          background: "none",
          border: "1px solid #45475a",
          color: "#6c7086",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 4,
          padding: "2px 5px",
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
    </div>
  );
}

/* ---- List Item ---- */

function ListItem({
  entry,
  onNavigate,
  onFileClick,
  onInsertEntry,
  onContextMenu,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onInsertEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}) {
  const isFolder = entry.type === "folder";

  return (
    <div
      onClick={() => {
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      onContextMenu={(e) => onContextMenu(e, entry)}
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
      {/* @ insert button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onInsertEntry(entry);
        }}
        title="Insert path"
        style={{
          background: "none",
          border: "1px solid #45475a",
          color: "#6c7086",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 4,
          padding: "2px 6px",
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
    </div>
  );
}

/* ---- Context Menu ---- */

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Adjust position to stay within viewport
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x, ny = y;
    if (x + rect.width > window.innerWidth - 4) nx = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight - 4) ny = window.innerHeight - rect.height - 4;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  // Close events: mousedown outside, Escape, scroll, resize, contextmenu elsewhere
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleDismiss = () => onClose();

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        background: "#1e1e2e",
        border: "1px solid #45475a",
        borderRadius: 6,
        padding: "4px 0",
        minWidth: 180,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        fontSize: 12,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === "separator") {
          return <div key={`sep-${i}`} style={{ height: 1, background: "#313244", margin: "4px 0" }} />;
        }
        return (
          <div
            key={item.label}
            onClick={item.onClick}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              cursor: "pointer",
              color: "#cdd6f4",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#313244"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{item.icon}</span>
            <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/* ---- Context Menu Icons ---- */

const CtxPreviewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#89b4fa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
    <circle cx="7" cy="7" r="1.5" />
  </svg>
);

const CtxOpenFileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#a6e3a1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1H3.5A1.5 1.5 0 0 0 2 2.5v9A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V5L8 1z" />
    <path d="M8 1v4h4" />
  </svg>
);

const CtxFolderOpenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#f9e2af" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.5L7 3.5h4A1.5 1.5 0 0 1 12.5 5v1" />
    <path d="M1 6.5h10.5a1 1 0 0 1 1 .8l-1.2 4.5a1 1 0 0 1-1 .7H2.5a1 1 0 0 1-1-.7L.3 7.3a1 1 0 0 1 1-.8z" />
  </svg>
);

const CtxDownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#89b4fa" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5v8" />
    <path d="M4 7l3 3 3-3" />
    <path d="M2 12h10" />
  </svg>
);

const CtxAtIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#a6e3a1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="2" />
    <path d="M9 5.5v2a1.5 1.5 0 0 0 3 0V7a5 5 0 1 0-2 4" />
  </svg>
);

const CtxCopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#cdd6f4" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="7" height="7" rx="1" />
    <path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
  </svg>
);

const CtxOpenExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#f9e2af" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 7.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h3.5" />
    <path d="M8.5 2H12v3.5" />
    <path d="M6.5 7.5L12 2" />
  </svg>
);

/* ---- File Preview ---- */

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".pyw": "python", ".pyi": "python",
  ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".cs": "csharp",
  ".rb": "ruby", ".php": "php", ".swift": "swift", ".scala": "scala",
  ".lua": "lua", ".r": "r",
  ".html": "xml", ".htm": "xml", ".xml": "xml",
  ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "less",
  ".json": "json", ".jsonl": "json",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "ini", ".ini": "ini",
  ".sql": "sql", ".graphql": "graphql", ".gql": "graphql",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".fish": "bash",
  ".bat": "dos", ".cmd": "dos", ".ps1": "powershell",
  ".md": "markdown", ".csv": "plaintext", ".tsv": "plaintext",
  ".txt": "plaintext", ".log": "plaintext",
  ".dockerfile": "dockerfile",
};

function FilePreview({
  file,
  content,
  loading,
  truncated,
  size,
  onClose,
  onInsertPath,
  onInsertSelection,
}: {
  file: PreviewFile;
  content: string;
  loading: boolean;
  truncated: boolean;
  size: number;
  onClose: () => void;
  onInsertPath: () => void;
  onInsertSelection?: (startLine: number, endLine: number, text: string) => void;
}) {
  const [previewFontSize, setPreviewFontSize] = useState(() => {
    const v = localStorage.getItem("previewFontSize");
    return v ? Number(v) : 12;
  });
  // Line selection: drag on gutter to select range
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragEndRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem("previewFontSize", String(previewFontSize));
  }, [previewFontSize]);

  const handleGutterMouseDown = (lineNum: number) => {
    setSelStart(lineNum);
    setSelEnd(null);
    setHoverLine(null);
    dragEndRef.current = lineNum;
    isDraggingRef.current = true;
    document.body.style.userSelect = "none";
  };

  const handleGutterTouchStart = (lineNum: number, e: React.TouchEvent) => {
    e.preventDefault();
    setSelStart(lineNum);
    setSelEnd(null);
    setHoverLine(null);
    dragEndRef.current = lineNum;
    isDraggingRef.current = true;
  };

  // Finalize drag on mouseup/touchend anywhere
  useEffect(() => {
    const finalizeDrag = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.userSelect = "";
        const endLine = dragEndRef.current;
        if (endLine !== null) {
          setSelEnd(endLine);
          setHoverLine(null);
        }
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        const lineAttr = (el as HTMLElement).getAttribute("data-line")
          || (el.parentElement as HTMLElement | null)?.getAttribute("data-line");
        if (lineAttr) {
          const ln = Number(lineAttr);
          dragEndRef.current = ln;
          setHoverLine(ln);
        }
      }
    };
    document.addEventListener("mouseup", finalizeDrag);
    document.addEventListener("touchend", finalizeDrag);
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      document.removeEventListener("mouseup", finalizeDrag);
      document.removeEventListener("touchend", finalizeDrag);
      document.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  // The effective visual range (accounting for hover preview)
  const rangeFrom = selStart !== null
    ? Math.min(selStart, selEnd ?? hoverLine ?? selStart)
    : null;
  const rangeTo = selStart !== null
    ? Math.max(selStart, selEnd ?? hoverLine ?? selStart)
    : null;

  // Is range finalized (both clicks done)?
  const rangeFinalized = selStart !== null && selEnd !== null;

  const clearSelection = () => {
    setSelStart(null);
    setSelEnd(null);
    setHoverLine(null);
  };

  // Reset selection when file changes
  useEffect(() => {
    clearSelection();
  }, [file.path]);

  // Build selected text from lines
  const getSelectedText = useCallback(() => {
    if (rangeFrom === null || rangeTo === null) return "";
    const allLines = content.split("\n");
    return allLines.slice(rangeFrom - 1, rangeTo).join("\n");
  }, [content, rangeFrom, rangeTo]);

  const lines = useMemo(() => content.split("\n"), [content]);
  const lineCount = lines.length;
  const gutterWidth = Math.max(String(lineCount).length * 8 + 16, 32);

  const highlighted = useMemo(() => {
    if (!content || loading) return "";
    const lang = file.extension ? EXT_TO_LANG[file.extension.toLowerCase()] : undefined;
    try {
      if (lang && lang !== "plaintext") {
        return hljs.highlight(content, { language: lang }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return "";
    }
  }, [content, loading, file.extension]);

  const highlightedLines = useMemo(() => {
    if (!highlighted) return lines.map((l) => l || " ");
    return highlighted.split("\n");
  }, [highlighted, lines]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Preview header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid #313244",
          flexShrink: 0,
          background: "#181825",
        }}
      >
        <FileIcon extension={file.extension} size={16} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 600,
            color: "#cdd6f4",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: 10, color: "#6c7086", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        {/* Font size controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button
            onClick={() => setPreviewFontSize((s) => Math.max(8, s - 1))}
            title="Decrease font size"
            style={{
              background: "none", border: "none", color: "#6c7086", cursor: "pointer",
              fontSize: 12, fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            -
          </button>
          <span style={{ fontSize: 9, color: "#6c7086", minWidth: 20, textAlign: "center" }}>
            {previewFontSize}
          </span>
          <button
            onClick={() => setPreviewFontSize((s) => Math.min(24, s + 1))}
            title="Increase font size"
            style={{
              background: "none", border: "none", color: "#6c7086", cursor: "pointer",
              fontSize: 12, fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            +
          </button>
        </div>
        {/* Insert @path button */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          style={{
            background: "none",
            border: "1px solid #45475a",
            color: "#a6e3a1",
            cursor: "pointer",
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#a6e3a118";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
          }}
        >
          @
        </button>
        {/* Close preview */}
        <button
          onClick={onClose}
          title="Close preview"
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>

      {/* Content area */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#6c7086", fontSize: 12 }}>
          Loading...
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {/* Selection bar - absolute overlay, no layout shift */}
          {rangeFinalized && onInsertSelection && rangeFrom !== null && rangeTo !== null && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                background: "rgba(30, 30, 46, 0.97)",
                borderBottom: "1px solid #45475a",
                backdropFilter: "blur(4px)",
              }}
            >
              <span style={{ fontSize: 11, color: "#89b4fa" }}>
                L{rangeFrom}{rangeFrom !== rangeTo ? `-${rangeTo}` : ""}
              </span>
              <span style={{ fontSize: 10, color: "#6c7086" }}>
                ({rangeTo - rangeFrom + 1} lines)
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="sel-insert-btn"
                onClick={() => {
                  onInsertSelection(rangeFrom, rangeTo, getSelectedText());
                  clearSelection();
                }}
                title="Insert @path with selected lines"
                style={{
                  background: "#313244",
                  border: "1px solid #45475a",
                  color: "#a6e3a1",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 4,
                  padding: "2px 10px",
                  lineHeight: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#45475a";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#313244";
                }}
              >
                @ Insert
              </button>
              <button
                onClick={clearSelection}
                title="Clear selection"
                style={{
                  background: "none",
                  border: "none",
                  color: "#6c7086",
                  cursor: "pointer",
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 3,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="3" y1="3" x2="9" y2="9" />
                  <line x1="9" y1="3" x2="3" y2="9" />
                </svg>
              </button>
            </div>
          )}
          <div
            ref={contentRef}
            style={{
              width: "100%",
              height: "100%",
              overflow: "auto",
              margin: 0,
            }}
          >
          <table
            style={{
              borderCollapse: "collapse",
              fontFamily: "'Cascadia Code', 'Consolas', monospace",
              fontSize: previewFontSize,
              lineHeight: 1.6,
              tabSize: 4,
              width: "100%",
            }}
          >
            <tbody>
              {highlightedLines.map((line, i) => {
                const lineNum = i + 1;
                const inRange = rangeFrom !== null && rangeTo !== null
                  && lineNum >= rangeFrom && lineNum <= rangeTo;
                return (
                  <tr key={i}>
                    <td
                      data-line={lineNum}
                      onMouseDown={() => handleGutterMouseDown(lineNum)}
                      onTouchStart={(e) => handleGutterTouchStart(lineNum, e)}
                      onMouseEnter={() => {
                        if (isDraggingRef.current) {
                          setHoverLine(lineNum);
                          dragEndRef.current = lineNum;
                        }
                      }}
                      style={{
                        width: gutterWidth,
                        minWidth: gutterWidth,
                        padding: "0 8px 0 8px",
                        textAlign: "right",
                        color: inRange ? "#89b4fa" : "#45475a",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                        verticalAlign: "top",
                        borderRight: "1px solid #313244",
                        background: inRange ? "#1e1e2e" : "#11111b",
                        position: "sticky",
                        left: 0,
                        cursor: "pointer",
                      }}
                    >
                      {lineNum}
                    </td>
                    <td
                      className="hljs"
                      style={{
                        padding: "0 12px",
                        whiteSpace: "pre",
                        verticalAlign: "top",
                        background: inRange ? "rgba(137,180,250,0.08)" : undefined,
                      }}
                      dangerouslySetInnerHTML={{ __html: line || " " }}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
          {truncated && (
            <div
              style={{
                padding: "6px 10px",
                fontSize: 10,
                color: "#f9e2af",
                borderTop: "1px solid #313244",
                background: "#181825",
                textAlign: "center",
                position: "sticky",
                left: 0,
              }}
            >
              File truncated (showing first 512KB of {formatSize(size)})
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Image Preview ---- */

function ImagePreview({
  file,
  imageUrl,
  loading,
  size,
  errorMessage,
  onClose,
  onInsertPath,
}: {
  file: PreviewFile;
  imageUrl: string | null;
  loading: boolean;
  size: number;
  errorMessage: string | null;
  onClose: () => void;
  onInsertPath: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [isFit, setIsFit] = useState(true);

  const gestureRef = useRef<{
    type: "drag" | "pinch" | null;
    lastX: number; lastY: number;
    pinchDist: number;
  }>({ type: null, lastX: 0, lastY: 0, pinchDist: 0 });

  const getFitView = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.naturalWidth) return { scale: 1, x: 0, y: 0 };
    const sw = c.clientWidth / img.naturalWidth;
    const sh = c.clientHeight / img.naturalHeight;
    const s = Math.min(sw, sh, 1);
    return {
      scale: s,
      x: (c.clientWidth - img.naturalWidth * s) / 2,
      y: (c.clientHeight - img.naturalHeight * s) / 2,
    };
  }, []);

  const fitToView = useCallback(() => {
    setView(getFitView());
    setIsFit(true);
  }, [getFitView]);

  const handleImgLoad = useCallback(() => {
    requestAnimationFrame(fitToView);
  }, [fitToView]);

  // Reset when image changes
  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    setIsFit(true);
  }, [imageUrl]);

  // Zoom at a container-local point
  const zoomAtPoint = useCallback((factor: number, px: number, py: number) => {
    setView(prev => {
      const ns = Math.min(Math.max(prev.scale * factor, 0.02), 30);
      return {
        scale: ns,
        x: px - (px - prev.x) * (ns / prev.scale),
        y: py - (py - prev.y) * (ns / prev.scale),
      };
    });
    setIsFit(false);
  }, []);

  // PC: mouse wheel zoom (needs passive: false for preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAtPoint(
        e.deltaY < 0 ? 1.15 : 1 / 1.15,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtPoint, imageUrl, loading]);

  // PC: mouse drag to pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    gestureRef.current = { type: "drag", lastX: e.clientX, lastY: e.clientY, pinchDist: 0 };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const g = gestureRef.current;
      if (g.type !== "drag") return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };
    const onUp = () => { gestureRef.current.type = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Mobile: touch pinch-to-zoom + pan
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      gestureRef.current = {
        type: "pinch",
        lastX: (t1.clientX + t2.clientX) / 2,
        lastY: (t1.clientY + t2.clientY) / 2,
        pinchDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      };
    } else if (e.touches.length === 1) {
      gestureRef.current = {
        type: "drag",
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        pinchDist: 0,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const g = gestureRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (g.type === "pinch" && e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;

      if (g.pinchDist > 0) {
        zoomAtPoint(dist / g.pinchDist, midX - rect.left, midY - rect.top);
      }
      const dx = midX - g.lastX;
      const dy = midY - g.lastY;
      if (dx || dy) {
        setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }

      g.pinchDist = dist;
      g.lastX = midX;
      g.lastY = midY;
    } else if (g.type === "drag" && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.lastX;
      const dy = e.touches[0].clientY - g.lastY;
      g.lastX = e.touches[0].clientX;
      g.lastY = e.touches[0].clientY;
      setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    }
  }, [zoomAtPoint]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      gestureRef.current.type = null;
    } else if (e.touches.length === 1) {
      gestureRef.current = {
        type: "drag",
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        pinchDist: 0,
      };
    }
  }, []);

  // Double click/tap: toggle fit ↔ 100%
  const handleDoubleClick = useCallback(() => {
    if (isFit) {
      const c = containerRef.current;
      const img = imgRef.current;
      if (!c || !img) return;
      setView({
        scale: 1,
        x: (c.clientWidth - img.naturalWidth) / 2,
        y: (c.clientHeight - img.naturalHeight) / 2,
      });
      setIsFit(false);
    } else {
      fitToView();
    }
  }, [isFit, fitToView]);

  const zoomPercent = Math.round(view.scale * 100);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid #313244",
          flexShrink: 0,
          background: "#181825",
        }}
      >
        <FileIcon extension={file.extension} size={16} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 600,
            color: "#cdd6f4",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: 10, color: "#6c7086", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        {/* Zoom controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button
            onClick={() => {
              const c = containerRef.current;
              if (c) zoomAtPoint(1 / 1.3, c.clientWidth / 2, c.clientHeight / 2);
            }}
            title="Zoom out"
            style={{
              background: "none", border: "none", color: "#6c7086", cursor: "pointer",
              fontSize: 12, fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            -
          </button>
          <span style={{ fontSize: 9, color: "#6c7086", minWidth: 28, textAlign: "center" }}>
            {zoomPercent}%
          </span>
          <button
            onClick={() => {
              const c = containerRef.current;
              if (c) zoomAtPoint(1.3, c.clientWidth / 2, c.clientHeight / 2);
            }}
            title="Zoom in"
            style={{
              background: "none", border: "none", color: "#6c7086", cursor: "pointer",
              fontSize: 12, fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
          >
            +
          </button>
        </div>
        {/* Fit */}
        <button
          onClick={fitToView}
          title="Fit to view"
          style={{
            background: "none",
            border: "1px solid #45475a",
            color: "#89b4fa",
            cursor: "pointer",
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#89b4fa18";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
          }}
        >
          Fit
        </button>
        {/* Insert @path */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          style={{
            background: "none",
            border: "1px solid #45475a",
            color: "#a6e3a1",
            cursor: "pointer",
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#a6e3a118";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
          }}
        >
          @
        </button>
        {/* Close */}
        <button
          onClick={onClose}
          title="Close preview"
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#6c7086", fontSize: 12 }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "#f38ba8", fontSize: 12 }}>
          {errorMessage}
        </div>
      ) : imageUrl ? (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            cursor: "grab",
            touchAction: "none",
            backgroundImage:
              "linear-gradient(45deg, #1e1e2e 25%, transparent 25%), " +
              "linear-gradient(-45deg, #1e1e2e 25%, transparent 25%), " +
              "linear-gradient(45deg, transparent 75%, #1e1e2e 75%), " +
              "linear-gradient(-45deg, transparent 75%, #1e1e2e 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            backgroundColor: "#11111b",
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={file.name}
            draggable={false}
            onLoad={handleImgLoad}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "0 0",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              userSelect: "none",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---- Audio Preview ---- */

function AudioPreview({
  file,
  audioUrl,
  loading,
  size,
  errorMessage,
  onClose,
  onInsertPath,
}: {
  file: PreviewFile;
  audioUrl: string | null;
  loading: boolean;
  size: number;
  errorMessage: string | null;
  onClose: () => void;
  onInsertPath: () => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid #313244",
          flexShrink: 0,
          background: "#181825",
        }}
      >
        <FileIcon extension={file.extension} size={16} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 600,
            color: "#cdd6f4",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: 10, color: "#6c7086", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        {/* Insert @path */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          style={{
            background: "none",
            border: "1px solid #45475a",
            color: "#a6e3a1",
            cursor: "pointer",
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#a6e3a118";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
          }}
        >
          @
        </button>
        {/* Close */}
        <button
          onClick={onClose}
          title="Close preview"
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cdd6f4"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6c7086"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#6c7086", fontSize: 12 }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "#f38ba8", fontSize: 12 }}>
          {errorMessage}
        </div>
      ) : audioUrl ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            backgroundColor: "#11111b",
            padding: 24,
          }}
        >
          {/* Large audio icon */}
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span style={{ color: "#cdd6f4", fontSize: 13, fontWeight: 500, textAlign: "center", wordBreak: "break-all" }}>
            {file.name}
          </span>
          {/* Native audio player */}
          <audio
            controls
            src={audioUrl}
            style={{ width: "100%", maxWidth: 400 }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---- Parent (..) Items ---- */

function ParentGridItem({ onBack }: { onBack: () => void }) {
  return (
    <div
      onClick={onBack}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px 6px",
        borderRadius: 6,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#313244";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <ParentFolderIcon size={32} />
      <span
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "#a6adc8",
          textAlign: "center",
        }}
      >
        ..
      </span>
    </div>
  );
}

function ParentListItem({ onBack }: { onBack: () => void }) {
  return (
    <div
      onClick={onBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
        color: "#a6adc8",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#313244";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <ParentFolderIcon size={16} />
      <span>..</span>
    </div>
  );
}

/* ---- Icons ---- */

const ParentFolderIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 2H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
      fill="#6c7086"
      opacity="0.6"
    />
    <path
      d="M5 9.5L8 7L11 9.5"
      stroke="#cdd6f4"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 6a4.5 4.5 0 0 1 7.65-3.2L10.5 4" />
    <path d="M10.5 1.5V4H8" />
    <path d="M10.5 6a4.5 4.5 0 0 1-7.65 3.2L1.5 8" />
    <path d="M1.5 10.5V8H4" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6.5v3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H5" />
    <path d="M7.5 1.5H10.5V4.5" />
    <path d="M5.5 6.5L10.5 1.5" />
  </svg>
);

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

const UploadIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8V2" />
    <path d="M3.5 4.5L6 2l2.5 2.5" />
    <path d="M2 9h8" />
  </svg>
);
