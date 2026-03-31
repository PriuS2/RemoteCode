import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, MessageDialog, PromptDialog } from "./Dialog";
import { IconFolder, FileIcon } from "../utils/fileIcons";
import { joinPath } from "../utils/pathUtils";
import hljs from "highlight.js";
import { apiFetch, readErrorMessage } from "../utils/api";
import { canUseLocalDesktopFeatures } from "../runtime";
import type { TextPreviewResponse } from "../types/api";
import { uiPx } from "../utils/uiScale";

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
  rootPath: string;
  onInsertPath: (text: string) => void;
  onClose: () => void;
  isMobile: boolean;
  embedded?: boolean;
  showCloseButton?: boolean;
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

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".webm", ".ogv", ".ogg", ".m4v", ".mov",
]);

function isVideoFile(ext: string | null): boolean {
  return ext !== null && VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

const PDF_EXTENSIONS = new Set([
  ".pdf",
]);

function isPdfFile(ext: string | null): boolean {
  return ext !== null && PDF_EXTENSIONS.has(ext.toLowerCase());
}

interface PreviewFile {
  name: string;
  path: string;
  extension: string | null;
  size?: number | null;
}

type PreviewMode = "text" | "image" | "audio" | "video" | "pdf";
const DEFAULT_PREVIEW_LINE_COUNT = 400;

function getRelativePath(rootPath: string, fullPath: string): string {
  // Normalize both paths to forward slashes and remove a trailing slash.
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
  const root = norm(rootPath);
  const full = norm(fullPath);

  if (full.toLowerCase().startsWith(root.toLowerCase())) {
    const rel = full.slice(root.length).replace(/^\//, "");
    return rel ? `@${rel}` : "@.";
  }
  // When outside the root, keep the absolute path with forward slashes.
  return `@${full}`;
}

function getRawFileUrl(path: string): string {
  return `/api/file-raw?path=${encodeURIComponent(path)}`;
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
  rootPath,
  onInsertPath,
  onClose,
  isMobile,
  embedded = false,
  showCloseButton = true,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("fileExplorerView") as ViewMode) || "list";
  });
  const [showHidden, setShowHidden] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [explorerFontSize, setExplorerFontSize] = useState(() => {
    const v = localStorage.getItem("explorerFontSize");
    return v ? Number(v) : 12;
  });

  useEffect(() => {
    localStorage.setItem("explorerFontSize", String(explorerFontSize));
  }, [explorerFontSize]);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("text");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewSize, setPreviewSize] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMediaSrc, setPreviewMediaSrc] = useState<string | null>(null);
  const [previewStartLine, setPreviewStartLine] = useState(1);
  const [previewEndLine, setPreviewEndLine] = useState(1);
  const [previewTotalLines, setPreviewTotalLines] = useState(1);
  const [previewHasPrev, setPreviewHasPrev] = useState(false);
  const [previewHasNext, setPreviewHasNext] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; entry: FileEntry;
  } | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalPending, setModalPending] = useState(false);
  const [messageDialog, setMessageDialog] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  const setPreviewBlobUrl = useCallback((url: string | null) => {
    if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
    previewBlobUrlRef.current = url;
    setPreviewMediaSrc(url);
  }, []);

  useEffect(() => {
    return () => { if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current); };
  }, []);

  const isLocal = canUseLocalDesktopFeatures();

  const handleOpenNative = useCallback(async (path?: string) => {
    try {
      await apiFetch("/api/open-explorer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: path ?? currentPath }),
      });
    } catch {
      // ignore
    }
  }, [currentPath]);

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to load"));
      }
      const data: FilesResponse = await res.json();
      setCurrentPath(data.current);
      setEntries(data.entries);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

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
  const filteredEntries = filterQuery.trim()
    ? visibleEntries.filter((entry) =>
      entry.name.toLowerCase().includes(filterQuery.trim().toLowerCase()))
    : visibleEntries;

  const handleNavigate = (folderName: string) => {
    fetchFiles(joinPath(currentPath, folderName));
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
    const fullPath = joinPath(currentPath, entry.name);
    const previewFile = {
      name: entry.name,
      path: fullPath,
      extension: entry.extension,
      size: entry.size,
    };

    if (isTextFile(entry.extension, entry.name)) {
      openTextPreview(previewFile, 1);
    } else if (isImageFile(entry.extension)) {
      openImagePreview(previewFile);
    } else if (isVideoFile(entry.extension)) {
      openVideoPreview(previewFile);
    } else if (isAudioFile(entry.extension)) {
      openAudioPreview(previewFile);
    } else if (isPdfFile(entry.extension)) {
      openPdfPreview(previewFile);
    } else {
      const rel = getRelativePath(rootPath, fullPath);
      onInsertPath(rel);
    }
  };

  const openTextPreview = useCallback(async (file: PreviewFile, startLine = 1) => {
    setPreviewFile(file);
    setPreviewMode("text");
    setPreviewLoading(true);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewBlobUrl(null);
    setPreviewMediaSrc(null);
    setPreviewSize(0);
    try {
      const res = await apiFetch(
        `/api/file-content?path=${encodeURIComponent(file.path)}&start_line=${startLine}&line_count=${DEFAULT_PREVIEW_LINE_COUNT}`,
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to read file"));
      }
      const data: TextPreviewResponse = await res.json();
      setPreviewContent(data.content);
      setPreviewTruncated(data.truncated);
      setPreviewSize(data.size);
      setPreviewStartLine(data.start_line);
      setPreviewEndLine(data.end_line);
      setPreviewTotalLines(data.total_lines);
      setPreviewHasPrev(data.has_prev);
      setPreviewHasNext(data.has_next);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to read file");
    } finally {
      setPreviewLoading(false);
    }
  }, [setPreviewBlobUrl]);

  const openImagePreview = useCallback(async (file: PreviewFile) => {
    setPreviewBlobUrl(null);
    setPreviewFile(file);
    setPreviewMode("image");
    setPreviewLoading(true);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewMediaSrc(null);
    setPreviewTruncated(false);
    setPreviewSize(0);
    setPreviewStartLine(1);
    setPreviewEndLine(1);
    setPreviewTotalLines(1);
    setPreviewHasPrev(false);
    setPreviewHasNext(false);
    try {
      const res = await apiFetch(getRawFileUrl(file.path));
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load image"));
      const blob = await res.blob();
      setPreviewBlobUrl(URL.createObjectURL(blob));
      setPreviewSize(blob.size);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load image");
    } finally {
      setPreviewLoading(false);
    }
  }, [setPreviewBlobUrl]);

  const openAudioPreview = useCallback(async (file: PreviewFile) => {
    setPreviewBlobUrl(null);
    setPreviewFile(file);
    setPreviewMode("audio");
    setPreviewLoading(true);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewMediaSrc(null);
    setPreviewTruncated(false);
    setPreviewSize(0);
    setPreviewStartLine(1);
    setPreviewEndLine(1);
    setPreviewTotalLines(1);
    setPreviewHasPrev(false);
    setPreviewHasNext(false);
    try {
      const res = await apiFetch(getRawFileUrl(file.path));
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load audio"));
      const blob = await res.blob();
      setPreviewBlobUrl(URL.createObjectURL(blob));
      setPreviewSize(blob.size);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load audio");
    } finally {
      setPreviewLoading(false);
    }
  }, [setPreviewBlobUrl]);

  const openVideoPreview = useCallback((file: PreviewFile) => {
    setPreviewBlobUrl(null);
    setPreviewFile(file);
    setPreviewMode("video");
    setPreviewLoading(false);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewMediaSrc(`/api/video-stream?path=${encodeURIComponent(file.path)}`);
    setPreviewTruncated(false);
    setPreviewSize(file.size ?? 0);
    setPreviewStartLine(1);
    setPreviewEndLine(1);
    setPreviewTotalLines(1);
    setPreviewHasPrev(false);
    setPreviewHasNext(false);
  }, [setPreviewBlobUrl]);

  const openPdfPreview = useCallback(async (file: PreviewFile) => {
    setPreviewBlobUrl(null);
    setPreviewFile(file);
    setPreviewMode("pdf");
    setPreviewLoading(true);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewMediaSrc(null);
    setPreviewTruncated(false);
    setPreviewSize(0);
    setPreviewStartLine(1);
    setPreviewEndLine(1);
    setPreviewTotalLines(1);
    setPreviewHasPrev(false);
    setPreviewHasNext(false);
    try {
      const res = await apiFetch(getRawFileUrl(file.path));
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load PDF"));
      const blob = await res.blob();
      setPreviewBlobUrl(URL.createObjectURL(blob));
      setPreviewSize(blob.size);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load PDF");
    } finally {
      setPreviewLoading(false);
    }
  }, [setPreviewBlobUrl]);

  const handleInsertEntry = (entry: FileEntry) => {
    const fullPath = joinPath(currentPath, entry.name);
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
      const res = await apiFetch(`/api/file-raw?path=${encodeURIComponent(fullPath)}`);
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
  }, []);

  const canPreview = useCallback((entry: FileEntry) => {
    return (
      isTextFile(entry.extension, entry.name)
      || isImageFile(entry.extension)
      || isAudioFile(entry.extension)
      || isVideoFile(entry.extension)
      || isPdfFile(entry.extension)
    );
  }, []);

  const startRename = useCallback((entry: FileEntry) => {
    setModalError(null);
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  }, []);

  const cancelRename = useCallback(() => {
    if (modalPending) return;
    setRenamingEntry(null);
    setRenameValue("");
    setModalError(null);
  }, [modalPending]);

  const handleRename = useCallback(async () => {
    if (!renamingEntry) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingEntry.name) { cancelRename(); return; }
    setModalPending(true);
    setModalError(null);
    try {
      const res = await apiFetch("/api/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, oldName: renamingEntry.name, newName }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Rename failed"));
      }
      cancelRename();
      fetchFiles(currentPath);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setModalPending(false);
    }
  }, [renamingEntry, renameValue, currentPath, fetchFiles, cancelRename]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setCreatingFolder(false); setNewFolderName(""); return; }
    try {
      const res = await apiFetch("/api/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to create folder"));
      }
      setCreatingFolder(false);
      setNewFolderName("");
      fetchFiles(currentPath);
    } catch (e: unknown) {
      setMessageDialog(e instanceof Error ? e.message : "Failed to create folder");
    }
  }, [newFolderName, currentPath, fetchFiles]);

  const handleDelete = useCallback(async (entry: FileEntry) => {
    setModalPending(true);
    setModalError(null);
    try {
      const res = await apiFetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name: entry.name }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Delete failed"));
      }
      fetchFiles(currentPath);
      setDeleteConfirm(null);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setModalPending(false);
    }
  }, [currentPath, fetchFiles]);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!contextMenu) return [];
    const entry = contextMenu.entry;
    const fullPath = joinPath(currentPath, entry.name);

    if (entry.type === "folder") {
      const items: ContextMenuEntry[] = [
        { label: "Open", icon: <CtxFolderOpenIcon />, onClick: () => { handleNavigate(entry.name); closeContextMenu(); } },
      ];
      if (isLocal) {
        items.push({ label: "Open Server Folder", icon: <CtxOpenExternalIcon />, onClick: () => { handleOpenNative(fullPath); closeContextMenu(); } });
      }
      items.push({ label: "Rename", icon: <CtxRenameIcon />, onClick: () => { startRename(entry); closeContextMenu(); } });
      items.push("separator");
      items.push({ label: "Insert Path (@)", icon: <CtxAtIcon />, onClick: () => { handleInsertEntry(entry); closeContextMenu(); } });
      items.push({ label: "Copy Name", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(entry.name); closeContextMenu(); } });
      items.push({ label: "Copy Full Path", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(fullPath); closeContextMenu(); } });
      items.push("separator");
      items.push({ label: "Delete", icon: <CtxDeleteIcon />, onClick: () => { setModalError(null); setDeleteConfirm(entry); closeContextMenu(); } });
      return items;
    }

    // File menu
    const items: ContextMenuEntry[] = [];
    if (canPreview(entry)) {
      items.push({ label: "Open (Preview)", icon: <CtxPreviewIcon />, onClick: () => { handleFileClick(entry); closeContextMenu(); } });
    }
    if (isLocal) {
      items.push({ label: "Open File on Server", icon: <CtxOpenFileIcon />, onClick: () => { handleOpenNative(fullPath); closeContextMenu(); } });
      items.push({ label: "Open Current Server Folder", icon: <CtxOpenExternalIcon />, onClick: () => { handleOpenNative(currentPath); closeContextMenu(); } });
    }
    items.push({ label: "Download", icon: <CtxDownloadIcon />, onClick: () => { downloadFile(fullPath, entry.name); closeContextMenu(); } });
    items.push({ label: "Rename", icon: <CtxRenameIcon />, onClick: () => { startRename(entry); closeContextMenu(); } });
    items.push("separator");
    items.push({ label: "Insert Path (@)", icon: <CtxAtIcon />, onClick: () => { handleInsertEntry(entry); closeContextMenu(); } });
    items.push({ label: "Copy Name", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(entry.name); closeContextMenu(); } });
    items.push({ label: "Copy Full Path", icon: <CtxCopyIcon />, onClick: () => { navigator.clipboard.writeText(fullPath); closeContextMenu(); } });
    items.push("separator");
    items.push({ label: "Delete", icon: <CtxDeleteIcon />, onClick: () => { setModalError(null); setDeleteConfirm(entry); closeContextMenu(); } });
    return items;
  }, [contextMenu, currentPath, isLocal, handleOpenNative, downloadFile, closeContextMenu, canPreview, startRename]);

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(`Uploading ${files.length} file(s)...`);
    try {
      const formData = new FormData();
      for (const f of files) formData.append("files", f);
      const res = await apiFetch(
        `/api/upload?path=${encodeURIComponent(currentPath)}`,
        {
          method: "POST",
          body: formData,
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Upload failed"));
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
  }, [currentPath, fetchFiles]);

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
    setPreviewBlobUrl(null);
    setPreviewFile(null);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewMediaSrc(null);
    setPreviewTruncated(false);
    setPreviewSize(0);
    setPreviewStartLine(1);
    setPreviewEndLine(1);
    setPreviewTotalLines(1);
    setPreviewHasPrev(false);
    setPreviewHasNext(false);
  }, [setPreviewBlobUrl]);

  const isImagePreview = previewFile !== null && previewMode === "image";
  const isAudioPreview = previewFile !== null && previewMode === "audio";
  const isVideoPreview = previewFile !== null && previewMode === "video";
  const isPdfPreview = previewFile !== null && previewMode === "pdf";

  const bodyOrPreview = previewFile ? (
    isImagePreview ? (
      <ImagePreview
        file={previewFile}
        imageUrl={previewMediaSrc}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewError}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
      />
    ) : isAudioPreview ? (
      <AudioPreview
        file={previewFile}
        audioUrl={previewMediaSrc}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewError}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
      />
    ) : isVideoPreview ? (
      <VideoPreview
        file={previewFile}
        videoSrc={previewMediaSrc}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewError}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
        onPlayerError={() => setPreviewError("브라우저가 이 영상 포맷 또는 코덱을 재생하지 못합니다.")}
      />
    ) : isPdfPreview ? (
      <PdfPreview
        file={previewFile}
        pdfUrl={previewMediaSrc}
        openUrl={getRawFileUrl(previewFile.path)}
        loading={previewLoading}
        size={previewSize}
        errorMessage={previewError}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
      />
    ) : (
      <FilePreview
        file={previewFile}
        content={previewContent}
        loading={previewLoading}
        errorMessage={previewError}
        truncated={previewTruncated}
        size={previewSize}
        startLine={previewStartLine}
        endLine={previewEndLine}
        totalLines={previewTotalLines}
        hasPrev={previewHasPrev}
        hasNext={previewHasNext}
        onClose={closePreview}
        onInsertPath={handleInsertPreviewPath}
        onInsertSelection={handleInsertSelection}
        onLoadWindow={(line) => openTextPreview(previewFile, line)}
      />
    )
  ) : (
    <ExplorerBody
      entries={filteredEntries}
      viewMode={viewMode}
      loading={loading}
      error={error}
      canGoBack={canGoBack}
      onBack={handleBack}
      onNavigate={handleNavigate}
      onFileClick={handleFileClick}
      onInsertEntry={handleInsertEntry}
      onContextMenu={handleContextMenu}
      isMobile={isMobile}
      renamingEntry={null}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onRenameSubmit={handleRename}
      onRenameCancel={cancelRename}
      creatingFolder={creatingFolder}
      newFolderName={newFolderName}
      onNewFolderNameChange={setNewFolderName}
      onNewFolderSubmit={handleCreateFolder}
      onNewFolderCancel={() => { setCreatingFolder(false); setNewFolderName(""); }}
    />
  );

  const uploadOverlay = dragOver && !previewFile && (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "var(--success-soft)",
        border: "2px dashed var(--success)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <UploadIcon size={32} />
        <span style={{ color: "var(--success)", fontSize: uiPx(13), fontWeight: 600 }}>Drop files to upload</span>
      </div>
    </div>
  );

  const uploadStatus = uploadProgress && (
    <div style={{
      padding: "4px 8px",
      fontSize: uiPx(11),
      color: uploading ? "var(--accent)" : uploadProgress.includes("failed") || uploadProgress.includes("denied") || uploadProgress.includes("large") ? "var(--danger)" : "var(--success)",
      background: "var(--surface-1)",
      borderTop: "1px solid var(--border-subtle)",
      textAlign: "center",
      flexShrink: 0,
    }}>
      {uploading && "Uploading... "}{uploadProgress}
    </div>
  );

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="*/*"
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
  if (isMobile && !embedded) {
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
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
          fontSize: explorerFontSize,
        } as React.CSSProperties}
      >
        {hiddenInput}
        <ExplorerHeader
          displayPath={displayPath}
          viewMode={viewMode}
          showHidden={showHidden}
          filterQuery={filterQuery}
          canGoBack={canGoBack}
          onBack={handleBack}
          onRefresh={() => fetchFiles(currentPath)}
          isLocal={isLocal}
          onOpenNative={() => handleOpenNative()}
          openNativeLabel="Open Current Server Folder"
          openNativeTitle="Open the current folder on the server"
          onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
          onToggleHidden={() => setShowHidden((h) => !h)}
          onFilterChange={setFilterQuery}
          onUpload={() => fileInputRef.current?.click()}
          onNewFolder={() => { setCreatingFolder(true); setNewFolderName(""); }}
          onClose={onClose}
          isPreview={!!previewFile}
          explorerFontSize={explorerFontSize}
          onFontSizeChange={setExplorerFontSize}
          showCloseButton={showCloseButton}
        />
        {bodyOrPreview}
        {uploadStatus}
        {uploadOverlay}
        {contextMenu && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenuItems} onClose={closeContextMenu} />
        )}
        {deleteConfirm && (
          <ConfirmDialog
            title={`Delete ${deleteConfirm.type === "folder" ? "Folder" : "File"}`}
            description={
              deleteConfirm.type === "folder"
                ? `Delete '${deleteConfirm.name}' and all of its contents on the server?`
                : `Delete '${deleteConfirm.name}' on the server?`
            }
            confirmLabel="Delete"
            danger
            pending={modalPending}
            error={modalError}
            onConfirm={() => { void handleDelete(deleteConfirm); }}
            onCancel={() => { if (!modalPending) { setDeleteConfirm(null); setModalError(null); } }}
          />
        )}
        {renamingEntry && (
          <PromptDialog
            title="Rename Item"
            label="New name"
            value={renameValue}
            confirmLabel="Save"
            pending={modalPending}
            error={modalError}
            onChange={setRenameValue}
            onConfirm={() => { void handleRename(); }}
            onCancel={cancelRename}
          />
        )}
        {messageDialog && (
          <MessageDialog title="Explorer Error" message={messageDialog} onClose={() => setMessageDialog(null)} />
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
        background: "var(--surface-1)",
        borderRight: embedded ? undefined : "1px solid var(--border-subtle)",
        position: "relative",
        fontSize: explorerFontSize,
      } as React.CSSProperties}
    >
      {hiddenInput}
      <ExplorerHeader
        displayPath={displayPath}
        viewMode={viewMode}
        showHidden={showHidden}
        filterQuery={filterQuery}
        canGoBack={canGoBack}
        onBack={handleBack}
        onRefresh={() => fetchFiles(currentPath)}
        isLocal={isLocal}
        onOpenNative={() => handleOpenNative()}
        openNativeLabel="Open Current Server Folder"
        openNativeTitle="Open the current folder on the server"
        onToggleView={() => setViewMode((v) => (v === "grid" ? "list" : "grid"))}
        onToggleHidden={() => setShowHidden((h) => !h)}
        onFilterChange={setFilterQuery}
        onUpload={() => fileInputRef.current?.click()}
        onNewFolder={() => { setCreatingFolder(true); setNewFolderName(""); }}
        onClose={onClose}
        isPreview={!!previewFile}
        explorerFontSize={explorerFontSize}
        onFontSizeChange={setExplorerFontSize}
        showCloseButton={showCloseButton}
      />
      {bodyOrPreview}
      {uploadStatus}
      {uploadOverlay}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenuItems} onClose={closeContextMenu} />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title={`Delete ${deleteConfirm.type === "folder" ? "Folder" : "File"}`}
          description={
            deleteConfirm.type === "folder"
              ? `Delete '${deleteConfirm.name}' and all of its contents on the server?`
              : `Delete '${deleteConfirm.name}' on the server?`
          }
          confirmLabel="Delete"
          danger
          pending={modalPending}
          error={modalError}
          onConfirm={() => { void handleDelete(deleteConfirm); }}
          onCancel={() => { if (!modalPending) { setDeleteConfirm(null); setModalError(null); } }}
        />
      )}
      {renamingEntry && (
        <PromptDialog
          title="Rename Item"
          label="New name"
          value={renameValue}
          confirmLabel="Save"
          pending={modalPending}
          error={modalError}
          onChange={setRenameValue}
          onConfirm={() => { void handleRename(); }}
          onCancel={cancelRename}
        />
      )}
      {messageDialog && (
        <MessageDialog title="Explorer Error" message={messageDialog} onClose={() => setMessageDialog(null)} />
      )}
    </div>
  );
}

/* ---- Header ---- */

function ExplorerHeader({
  displayPath,
  viewMode,
  showHidden,
  filterQuery,
  canGoBack,
  onBack,
  onRefresh,
  isLocal,
  onOpenNative,
  openNativeLabel,
  openNativeTitle,
  onToggleView,
  onToggleHidden,
  onFilterChange,
  onUpload,
  onNewFolder,
  onClose,
  isPreview,
  explorerFontSize,
  onFontSizeChange,
  showCloseButton = true,
}: {
  displayPath: string;
  viewMode: ViewMode;
  showHidden: boolean;
  filterQuery: string;
  canGoBack: boolean;
  onBack: () => void;
  onRefresh: () => void;
  isLocal: boolean;
  onOpenNative: () => void;
  openNativeLabel: string;
  openNativeTitle: string;
  onToggleView: () => void;
  onToggleHidden: () => void;
  onFilterChange: (value: string) => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onClose: () => void;
  isPreview?: boolean;
  explorerFontSize: number;
  onFontSizeChange: (fn: (s: number) => number) => void;
  showCloseButton?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.35em",
        padding: "0.35em 0.5em 0.45em",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
        background: "var(--surface-1)",
        fontSize: explorerFontSize,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.3em", width: "100%" }}>
        <button
          onClick={onBack}
          disabled={!canGoBack}
          title="Back"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: canGoBack ? "var(--text-primary)" : "var(--border-strong)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
            padding: "0.15em 0.3em",
            display: "flex",
            alignItems: "center",
            borderRadius: 3,
            flexShrink: 0,
          }}
        >
          <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2L4 6l4 4" />
          </svg>
        </button>

        <span
          title={displayPath}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "0.95em",
            color: "var(--accent)",
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
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              padding: "0.15em 0.3em",
              display: "flex",
              alignItems: "center",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            <RefreshIcon />
          </button>

          {/* Open in system explorer (local network only) */}
          {isLocal && (
            <button
              onClick={onOpenNative}
              title={`${openNativeTitle} (server-side action)`}
              className="panel-icon-button"
              style={{
                ["--panel-fg" as any]: "var(--text-muted)",
                ["--panel-hover-fg" as any]: "var(--warn)",
                padding: "0.15em 0.3em",
                display: "flex",
                alignItems: "center",
                borderRadius: 3,
                flexShrink: 0,
              }}
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
              color: showHidden ? "var(--success)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "0.15em 0.3em",
              fontSize: "0.85em",
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
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              padding: "0.15em 0.3em",
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
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--success)",
              padding: "0.15em 0.3em",
              display: "flex",
              alignItems: "center",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            <UploadIcon />
          </button>

          {/* New Folder */}
          <button
            onClick={onNewFolder}
            title="New folder"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--warn)",
              padding: "0.15em 0.3em",
              display: "flex",
              alignItems: "center",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            <NewFolderIcon />
          </button>
          </>
        )}

        {!isPreview && (
          <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <button
            onClick={() => onFontSizeChange((s) => Math.max(8, s - 1))}
            title="Decrease font size"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              fontSize: "1em", fontWeight: 700, padding: "0 0.2em", lineHeight: 1, borderRadius: 3,
            }}
          >-</button>
          <span style={{ fontSize: "0.75em", color: "var(--text-muted)", minWidth: "1.2em", textAlign: "center" }}>
            {explorerFontSize}
          </span>
          <button
            onClick={() => onFontSizeChange((s) => Math.min(20, s + 1))}
            title="Increase font size"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              fontSize: "1em", fontWeight: 700, padding: "0 0.2em", lineHeight: 1, borderRadius: 3,
            }}
          >+</button>
          </div>
        )}

        {showCloseButton && (
          <button
            onClick={onClose}
            title="Close"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              padding: "0.15em 0.3em",
              display: "flex",
              alignItems: "center",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        )}
      </div>

      {!isPreview && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <input
            type="text"
            value={filterQuery}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter current folder"
            style={{
              flex: 1,
            minWidth: 0,
            padding: "0.45em 0.65em",
            borderRadius: 6,
            border: "1px solid var(--border-strong)",
            background: "var(--surface-2)",
            color: "var(--text-primary)",
            fontSize: "0.82em",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {isLocal && (
            <span style={{ fontSize: "0.72em", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {openNativeLabel}
            </span>
          )}
        </div>
      )}
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
  isMobile,
  renamingEntry,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  creatingFolder,
  newFolderName,
  onNewFolderNameChange,
  onNewFolderSubmit,
  onNewFolderCancel,
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
  isMobile: boolean;
  renamingEntry: FileEntry | null;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  creatingFolder: boolean;
  newFolderName: string;
  onNewFolderNameChange: (v: string) => void;
  onNewFolderSubmit: () => void;
  onNewFolderCancel: () => void;
}) {
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 12, color: "var(--danger)" }}>{error}</div>
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
          {creatingFolder && (
            <NewFolderInlineGrid
              value={newFolderName}
              onChange={onNewFolderNameChange}
              onSubmit={onNewFolderSubmit}
              onCancel={onNewFolderCancel}
            />
          )}
          {entries.map((entry) => (
            <GridItem
              key={entry.name}
              entry={entry}
              onNavigate={onNavigate}
              onFileClick={onFileClick}
              onInsertEntry={onInsertEntry}
              onContextMenu={onContextMenu}
              isRenaming={renamingEntry?.name === entry.name}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
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
      {creatingFolder && (
        <NewFolderInlineList
          value={newFolderName}
          onChange={onNewFolderNameChange}
          onSubmit={onNewFolderSubmit}
          onCancel={onNewFolderCancel}
        />
      )}
      {entries.map((entry) => (
        <ListItem
          key={entry.name}
          entry={entry}
          onNavigate={onNavigate}
          onFileClick={onFileClick}
          onInsertEntry={onInsertEntry}
          onContextMenu={onContextMenu}
          isMobile={isMobile}
          isRenaming={renamingEntry?.name === entry.name}
          renameValue={renameValue}
          onRenameValueChange={onRenameValueChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
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
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onInsertEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}) {
  const isFolder = entry.type === "folder";
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select name without extension for files
      if (entry.type === "file" && entry.extension) {
        const nameWithoutExt = entry.name.length - entry.extension.length;
        renameInputRef.current.setSelectionRange(0, nameWithoutExt);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [isRenaming, entry.name, entry.type, entry.extension]);

  return (
    <div
      onClick={() => {
        if (isRenaming) return;
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      onContextMenu={(e) => { if (!isRenaming) onContextMenu(e, entry); }}
      className="panel-list-row"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px 6px",
        borderRadius: 6,
        cursor: isRenaming ? "default" : "pointer",
        position: "relative",
      }}
    >
      {isFolder ? (
        <IconFolder size={32} />
      ) : (
        <FileIcon extension={entry.extension} size={32} />
      )}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onRenameSubmit(); }
            if (e.key === "Escape") onRenameCancel();
          }}
          onBlur={onRenameCancel}
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 4,
            fontSize: "0.85em",
            color: "var(--text-primary)",
            background: "var(--surface-2)",
            border: "1px solid var(--accent)",
            borderRadius: 3,
            padding: "1px 4px",
            width: "100%",
            textAlign: "center",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <span
          style={{
            marginTop: 4,
            fontSize: "0.85em",
            color: "var(--text-primary)",
            textAlign: "center",
            width: "100%",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-all",
            lineHeight: 1.3,
          }}
          title={entry.name}
        >
          {entry.name}
        </span>
      )}
      {/* @ insert button */}
      {!isRenaming && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsertEntry(entry);
          }}
          title="Insert path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            ["--panel-bg" as any]: "transparent",
            ["--panel-border" as any]: "var(--border-strong)",
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--success)",
            fontSize: uiPx(12),
            fontWeight: 700,
            borderRadius: 4,
            padding: "2px 5px",
            lineHeight: 1,
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
  onInsertEntry,
  onContextMenu,
  isMobile,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  entry: FileEntry;
  onNavigate: (name: string) => void;
  onFileClick: (entry: FileEntry) => void;
  onInsertEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  isMobile: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}) {
  const isFolder = entry.type === "folder";
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      if (entry.type === "file" && entry.extension) {
        const nameWithoutExt = entry.name.length - entry.extension.length;
        renameInputRef.current.setSelectionRange(0, nameWithoutExt);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [isRenaming, entry.name, entry.type, entry.extension]);

  return (
    <div
      onClick={() => {
        if (isRenaming) return;
        if (isFolder) onNavigate(entry.name);
        else onFileClick(entry);
      }}
      onContextMenu={(e) => { if (!isRenaming) onContextMenu(e, entry); }}
      className="panel-list-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        cursor: isRenaming ? "default" : "pointer",
        color: "var(--text-primary)",
      }}
    >
      {isFolder ? (
        <IconFolder size={16} />
      ) : (
        <FileIcon extension={entry.extension} size={16} />
      )}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onRenameSubmit(); }
            if (e.key === "Escape") onRenameCancel();
          }}
          onBlur={onRenameCancel}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--text-primary)",
            background: "var(--surface-2)",
            border: "1px solid var(--accent)",
            borderRadius: 3,
            padding: "1px 4px",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        />
      ) : (
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
      )}
      {/* Size (files only) */}
      {!isRenaming && !isFolder && entry.size != null && (
        <span style={{ fontSize: "0.85em", color: "var(--text-muted)", flexShrink: 0 }}>
          {formatSize(entry.size)}
        </span>
      )}
      {/* @ insert button */}
      {!isRenaming && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsertEntry(entry);
          }}
          title="Insert path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ["--panel-bg" as any]: "transparent",
            ["--panel-border" as any]: "var(--border-strong)",
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--success)",
            fontSize: uiPx(12),
            fontWeight: 700,
            borderRadius: 4,
            padding: "2px 6px",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          @
        </button>
      )}
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
      className="panel-menu"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        borderRadius: 6,
        padding: "4px 0",
        minWidth: 180,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        fontSize: uiPx(12),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === "separator") {
          return <div key={`sep-${i}`} style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />;
        }
        return (
          <div
            key={item.label}
            onClick={item.onClick}
            className="panel-list-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              cursor: "pointer",
              color: "var(--text-primary)",
            }}
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
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
    <circle cx="7" cy="7" r="1.5" />
  </svg>
);

const CtxOpenFileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--success)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1H3.5A1.5 1.5 0 0 0 2 2.5v9A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V5L8 1z" />
    <path d="M8 1v4h4" />
  </svg>
);

const CtxFolderOpenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--warn)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h2.5L7 3.5h4A1.5 1.5 0 0 1 12.5 5v1" />
    <path d="M1 6.5h10.5a1 1 0 0 1 1 .8l-1.2 4.5a1 1 0 0 1-1 .7H2.5a1 1 0 0 1-1-.7L.3 7.3a1 1 0 0 1 1-.8z" />
  </svg>
);

const CtxDownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 1.5v8" />
    <path d="M4 7l3 3 3-3" />
    <path d="M2 12h10" />
  </svg>
);

const CtxAtIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--success)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="2" />
    <path d="M9 5.5v2a1.5 1.5 0 0 0 3 0V7a5 5 0 1 0-2 4" />
  </svg>
);

const CtxCopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-primary)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="7" height="7" rx="1" />
    <path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
  </svg>
);

const CtxOpenExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--warn)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 7.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h3.5" />
    <path d="M8.5 2H12v3.5" />
    <path d="M6.5 7.5L12 2" />
  </svg>
);

const CtxRenameIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 1.5l2 2-7.5 7.5H3v-2l7.5-7.5z" />
    <path d="M8.5 3.5l2 2" />
  </svg>
);

const CtxDeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--danger)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4h9" />
    <path d="M5 4V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4" />
    <path d="M3.5 4l.5 8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8" />
    <path d="M5.5 6.5v3" />
    <path d="M8.5 6.5v3" />
  </svg>
);

/* ---- Delete Confirm Dialog ---- */

function DeleteConfirmDialog({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: FileEntry;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onConfirm, onCancel]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "var(--overlay-backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-dialog"
        style={{
          borderRadius: 8,
          padding: "20px 24px",
          minWidth: 300,
          maxWidth: 400,
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
        }}
      >
        <div style={{ fontSize: uiPx(14), color: "var(--text-primary)", marginBottom: 12, fontWeight: 600 }}>
          Delete {entry.type === "folder" ? "Folder" : "File"}
        </div>
        <div style={{ fontSize: uiPx(12), color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
          Are you sure you want to delete{" "}
          <span style={{ color: "var(--danger)", fontWeight: 600 }}>"{entry.name}"</span>?
          {entry.type === "folder" && (
            <span style={{ display: "block", marginTop: 6, color: "var(--danger)", fontSize: uiPx(11) }}>
              This will delete the folder and all its contents.
            </span>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            className="secondary-button"
            style={{
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: uiPx(12),
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="panel-icon-button"
            style={{
              ["--panel-bg" as any]: "var(--danger)",
              ["--panel-fg" as any]: "var(--accent-contrast)",
              ["--panel-hover-bg" as any]: "color-mix(in srgb, var(--danger) 85%, var(--surface-1))",
              ["--panel-hover-fg" as any]: "var(--accent-contrast)",
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: uiPx(12),
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
  errorMessage,
  truncated,
  size,
  startLine,
  endLine,
  totalLines,
  hasPrev,
  hasNext,
  onClose,
  onInsertPath,
  onInsertSelection,
  onLoadWindow,
}: {
  file: PreviewFile;
  content: string;
  loading: boolean;
  errorMessage: string | null;
  truncated: boolean;
  size: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onInsertPath: () => void;
  onInsertSelection?: (startLine: number, endLine: number, text: string) => void;
  onLoadWindow?: (startLine: number) => void;
}) {
  const [previewFontSize, setPreviewFontSize] = useState(() => {
    const v = localStorage.getItem("previewFontSize");
    return v ? Number(v) : 12;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [jumpValue, setJumpValue] = useState("");
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

  useEffect(() => {
    clearSelection();
  }, [file.path, startLine, endLine]);

  const getSelectedText = useCallback(() => {
    if (rangeFrom === null || rangeTo === null) return "";
    const allLines = content.split("\n");
    return allLines.slice(rangeFrom - startLine, rangeTo - startLine + 1).join("\n");
  }, [content, rangeFrom, rangeTo, startLine]);

  const lines = useMemo(() => content.split("\n"), [content]);
  const lineNumbers = useMemo(
    () => lines.map((_, index) => startLine + index),
    [lines, startLine],
  );
  const lineCount = lineNumbers.length;
  const gutterWidth = Math.max(String(Math.max(endLine, totalLines)).length * 8 + 16, 32);
  const matchLines = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return lines
      .map((line, index) => ({ lineNumber: lineNumbers[index], matches: line.toLowerCase().includes(query) }))
      .filter((item) => item.matches)
      .map((item) => item.lineNumber);
  }, [lineNumbers, lines, searchQuery]);
  const activeMatchLine = matchLines.length > 0 ? matchLines[activeMatchIndex % matchLines.length] : null;

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

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, startLine, endLine]);

  useEffect(() => {
    if (activeMatchLine === null) return;
    const target = contentRef.current?.querySelector(`[data-absolute-line="${activeMatchLine}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center" });
    }
  }, [activeMatchLine]);

  const loadLineWindow = useCallback((targetLine: number) => {
    if (!onLoadWindow) return;
    const clamped = Math.max(1, targetLine);
    onLoadWindow(clamped);
  }, [onLoadWindow]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--surface-1)",
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
            fontSize: uiPx(11),
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: uiPx(10), color: "var(--text-muted)", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        {truncated && (
          <span style={{ fontSize: uiPx(10), color: "var(--warn)", flexShrink: 0 }}>
            L{startLine}-{endLine} / {totalLines}
          </span>
        )}
        {/* Font size controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button
            onClick={() => setPreviewFontSize((s) => Math.max(8, s - 1))}
            title="Decrease font size"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              fontSize: uiPx(12), fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
          >
            -
          </button>
          <span style={{ fontSize: uiPx(9), color: "var(--text-muted)", minWidth: 20, textAlign: "center" }}>
            {previewFontSize}
          </span>
          <button
            onClick={() => setPreviewFontSize((s) => Math.min(24, s + 1))}
            title="Increase font size"
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              fontSize: uiPx(12), fontWeight: 700, padding: "0 3px", lineHeight: 1, borderRadius: 3,
            }}
          >
            +
          </button>
        </div>
        {/* Insert @path button */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ["--panel-bg" as any]: "transparent",
            ["--panel-border" as any]: "var(--border-strong)",
            ["--panel-fg" as any]: "var(--success)",
            ["--panel-hover-bg" as any]: "var(--success-soft)",
            padding: "1px 6px",
            fontSize: uiPx(10),
            fontWeight: 700,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
        >
          @
        </button>
        {/* Close preview */}
        <button
          onClick={onClose}
          title="Close preview"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--preview-toolbar-bg)",
          flexWrap: "wrap",
        }}
      >
        {truncated && (
          <>
            <button
              onClick={() => loadLineWindow(Math.max(1, startLine - DEFAULT_PREVIEW_LINE_COUNT))}
              disabled={!hasPrev}
              style={previewToolbarButton(!hasPrev)}
            >
              Prev Chunk
            </button>
            <button
              onClick={() => loadLineWindow(endLine + 1)}
              disabled={!hasNext}
              style={previewToolbarButton(!hasNext)}
            >
              Next Chunk
            </button>
          </>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search loaded chunk"
            style={previewToolbarInput}
          />
          <button
            onClick={() => setActiveMatchIndex((index) => (matchLines.length ? (index - 1 + matchLines.length) % matchLines.length : 0))}
            disabled={matchLines.length === 0}
            style={previewToolbarButton(matchLines.length === 0)}
          >
            Prev
          </button>
          <button
            onClick={() => setActiveMatchIndex((index) => (matchLines.length ? (index + 1) % matchLines.length : 0))}
            disabled={matchLines.length === 0}
            style={previewToolbarButton(matchLines.length === 0)}
          >
            Next
          </button>
          <span style={{ fontSize: uiPx(10), color: "var(--text-muted)" }}>
            {matchLines.length > 0 ? `${activeMatchIndex + 1}/${matchLines.length}` : "0 matches"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            min={1}
            value={jumpValue}
            onChange={(event) => setJumpValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && jumpValue.trim()) {
                const target = Number(jumpValue);
                if (!Number.isNaN(target)) {
                  if (target >= startLine && target <= endLine) {
                    const row = contentRef.current?.querySelector(`[data-absolute-line="${target}"]`);
                    if (row instanceof HTMLElement) {
                      row.scrollIntoView({ block: "center" });
                    }
                  } else {
                    loadLineWindow(Math.max(1, target - Math.floor(DEFAULT_PREVIEW_LINE_COUNT / 2)));
                  }
                }
              }
            }}
            placeholder="Line"
            style={{ ...previewToolbarInput, width: 88 }}
          />
          <button
            onClick={() => {
              const target = Number(jumpValue);
              if (!Number.isNaN(target) && target > 0) {
                if (target >= startLine && target <= endLine) {
                  const row = contentRef.current?.querySelector(`[data-absolute-line="${target}"]`);
                  if (row instanceof HTMLElement) row.scrollIntoView({ block: "center" });
                } else {
                  loadLineWindow(Math.max(1, target - Math.floor(DEFAULT_PREVIEW_LINE_COUNT / 2)));
                }
              }
            }}
            style={previewToolbarButton(false)}
          >
            Jump
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: uiPx(12) }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: uiPx(12) }}>
          {errorMessage}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
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
                background: "color-mix(in srgb, var(--surface-2) 92%, transparent)",
                borderBottom: "1px solid var(--border-strong)",
                backdropFilter: "blur(4px)",
              }}
            >
              <span style={{ fontSize: uiPx(11), color: "var(--accent)" }}>
                L{rangeFrom}{rangeFrom !== rangeTo ? `-${rangeTo}` : ""}
              </span>
              <span style={{ fontSize: uiPx(10), color: "var(--text-muted)" }}>
                ({rangeTo - rangeFrom + 1} lines)
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => {
                  onInsertSelection(rangeFrom, rangeTo, getSelectedText());
                  clearSelection();
                }}
                title="Insert @path with selected lines"
                className="panel-icon-button panel-icon-button--chip"
                style={{
                  ["--panel-bg" as any]: "var(--surface-2)",
                  ["--panel-border" as any]: "var(--border-strong)",
                  ["--panel-fg" as any]: "var(--success)",
                  ["--panel-hover-bg" as any]: "var(--surface-3)",
                  fontSize: uiPx(11),
                  fontWeight: 700,
                  borderRadius: 4,
                  padding: "2px 10px",
                  lineHeight: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                @ Insert
              </button>
              <button
                onClick={clearSelection}
                title="Clear selection"
                className="panel-icon-button"
                style={{
                  ...previewIconButtonStyle(),
                }}
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
                const lineNum = lineNumbers[i] ?? startLine + i;
                const inRange = rangeFrom !== null && rangeTo !== null
                  && lineNum >= rangeFrom && lineNum <= rangeTo;
                return (
                  <tr key={i}>
                    <td
                      data-line={lineNum}
                      data-absolute-line={lineNum}
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
                        color: inRange ? "var(--preview-gutter-active-fg)" : "var(--preview-gutter-fg)",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                        verticalAlign: "top",
                        borderRight: "1px solid var(--preview-gutter-border)",
                        background: inRange ? "var(--preview-gutter-active-bg)" : "var(--preview-gutter-bg)",
                        position: "sticky",
                        left: 0,
                        cursor: "pointer",
                      }}
                    >
                      {lineNum}
                    </td>
                    <td
                      data-absolute-line={lineNum}
                      className="hljs"
                      style={{
                        padding: "0 12px",
                        whiteSpace: "pre",
                        verticalAlign: "top",
                        background:
                          inRange
                            ? "var(--preview-line-selection-bg)"
                            : lineNum === activeMatchLine
                              ? "var(--preview-match-active-bg)"
                              : matchLines.includes(lineNum)
                                ? "var(--preview-match-bg)"
                                : undefined,
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
                fontSize: uiPx(10),
                color: "var(--preview-status-fg)",
                borderTop: "1px solid var(--preview-status-border)",
                background: "var(--preview-status-bg)",
                textAlign: "center",
                position: "sticky",
                left: 0,
              }}
            >
              Large file preview loaded for lines {startLine}-{endLine} of {totalLines}.
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function previewToolbarButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "var(--preview-toolbar-button-disabled-bg)" : "var(--preview-toolbar-button-bg)",
    border: "1px solid var(--preview-toolbar-input-border)",
    color: disabled ? "var(--preview-toolbar-button-disabled-fg)" : "var(--preview-toolbar-button-fg)",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: uiPx(11),
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const previewToolbarInput: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--preview-toolbar-input-border)",
  background: "var(--preview-toolbar-input-bg)",
  color: "var(--preview-toolbar-input-fg)",
  fontSize: uiPx(11),
  outline: "none",
  boxSizing: "border-box",
};

const previewHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  borderBottom: "1px solid var(--border-subtle)",
  flexShrink: 0,
  background: "var(--surface-1)",
};

const previewTitleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: uiPx(11),
  fontWeight: 600,
  color: "var(--text-primary)",
};

const previewMetaStyle: React.CSSProperties = {
  fontSize: uiPx(10),
  color: "var(--text-muted)",
  flexShrink: 0,
};

function previewIconButtonStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    ["--panel-fg" as any]: "var(--text-muted)",
    ["--panel-hover-fg" as any]: "var(--text-primary)",
    padding: "2px 4px",
    display: "flex",
    alignItems: "center",
    borderRadius: 3,
    flexShrink: 0,
    ...extra,
  };
}

function previewChipButtonStyle(
  foreground: string,
  hoverBackground: string,
  extra?: React.CSSProperties,
): React.CSSProperties {
  return {
    ["--panel-bg" as any]: "transparent",
    ["--panel-border" as any]: "var(--border-strong)",
    ["--panel-fg" as any]: foreground,
    ["--panel-hover-bg" as any]: hoverBackground,
    padding: "1px 6px",
    fontSize: uiPx(10),
    fontWeight: 600,
    borderRadius: 3,
    flexShrink: 0,
    lineHeight: "16px",
    ...extra,
  };
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

  // Double click/tap: toggle fit ??100%
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
      <div style={previewHeaderStyle}>
        <FileIcon extension={file.extension} size={16} />
        <span style={previewTitleStyle} title={file.name}>
          {file.name}
        </span>
        {size > 0 && (
          <span style={previewMetaStyle}>
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
            className="panel-icon-button"
            style={{
              ...previewIconButtonStyle({
                fontSize: uiPx(12),
                fontWeight: 700,
                padding: "0 3px",
                lineHeight: 1,
              }),
            }}
          >
            -
          </button>
          <span style={{ fontSize: uiPx(9), color: "var(--text-muted)", minWidth: 28, textAlign: "center" }}>
            {zoomPercent}%
          </span>
          <button
            onClick={() => {
              const c = containerRef.current;
              if (c) zoomAtPoint(1.3, c.clientWidth / 2, c.clientHeight / 2);
            }}
            title="Zoom in"
            className="panel-icon-button"
            style={{
              ...previewIconButtonStyle({
                fontSize: uiPx(12),
                fontWeight: 700,
                padding: "0 3px",
                lineHeight: 1,
              }),
            }}
          >
            +
          </button>
        </div>
        {/* Fit */}
        <button
          onClick={fitToView}
          title="Fit to view"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ...previewChipButtonStyle("var(--info)", "var(--info-soft)"),
          }}
        >
          Fit
        </button>
        {/* Insert @path */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ...previewChipButtonStyle("var(--success)", "var(--success-soft)", { fontWeight: 700 }),
          }}
        >
          @
        </button>
        {/* Close */}
        <button
          onClick={onClose}
          title="Close preview"
          className="panel-icon-button"
          style={{
            ...previewIconButtonStyle(),
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: uiPx(12) }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: uiPx(12) }}>
          {errorMessage}
        </div>
      ) : imageUrl ? (
        <div
          className="image-preview-canvas"
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
          }}
        >
          <img
            className="image-preview-canvas__image"
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

/* ---- PDF Preview ---- */

function PdfPreview({
  file,
  pdfUrl,
  openUrl,
  loading,
  size,
  errorMessage,
  onClose,
  onInsertPath,
}: {
  file: PreviewFile;
  pdfUrl: string | null;
  openUrl: string;
  loading: boolean;
  size: number;
  errorMessage: string | null;
  onClose: () => void;
  onInsertPath: () => void;
}) {
  const headerButtonStyle: React.CSSProperties = {
    padding: "1px 6px",
    fontSize: uiPx(10),
    fontWeight: 600,
    borderRadius: 3,
    flexShrink: 0,
    lineHeight: "16px",
  };

  const linkButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--surface-1)",
    color: "var(--text-primary)",
    textDecoration: "none",
    fontSize: uiPx(12),
    fontWeight: 600,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--surface-1)",
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
            fontSize: uiPx(11),
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: uiPx(10), color: "var(--text-muted)", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ...headerButtonStyle,
            ["--panel-bg" as any]: "transparent",
            ["--panel-border" as any]: "var(--border-strong)",
            ["--panel-fg" as any]: "var(--success)",
            ["--panel-hover-bg" as any]: "var(--success-soft)",
            fontWeight: 700,
          }}
        >
          @
        </button>
        <button
          onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
          title="Open in new tab"
          className="panel-icon-button panel-icon-button--chip"
          style={{ ...headerButtonStyle, ["--panel-bg" as any]: "transparent", ["--panel-border" as any]: "var(--border-strong)", ["--panel-fg" as any]: "var(--accent)", ["--panel-hover-bg" as any]: "var(--accent-soft)" }}
        >
          Open
        </button>
        <button
          onClick={onClose}
          title="Close preview"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
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

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: uiPx(12) }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: uiPx(12) }}>
          {errorMessage}
        </div>
      ) : pdfUrl ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            backgroundColor: "var(--surface-inset)",
            padding: 12,
          }}
        >
          <object
            data={pdfUrl}
            type="application/pdf"
            width="100%"
            height="100%"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "var(--surface-base)",
            }}
          >
            <div
              style={{
                height: "100%",
                minHeight: 240,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                color: "var(--text-primary)",
                textAlign: "center",
                padding: 24,
              }}
            >
              <div style={{ fontSize: uiPx(14), fontWeight: 600 }}>
                PDF 미리보기를 사용할 수 없습니다.
              </div>
              <div style={{ fontSize: uiPx(12), color: "var(--text-secondary)", maxWidth: 360, lineHeight: 1.5 }}>
                현재 브라우저에서 내장 PDF 뷰어를 지원하지 않거나 비활성화되어 있습니다. 새 탭에서 열거나 다운로드해 확인하세요.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={linkButtonStyle}
                >
                  새 탭 열기
                </a>
                <a
                  href={openUrl}
                  download={file.name}
                  style={linkButtonStyle}
                >
                  다운로드
                </a>
              </div>
            </div>
          </object>
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
      <div style={previewHeaderStyle}>
        <FileIcon extension={file.extension} size={16} />
        <span style={previewTitleStyle} title={file.name}>
          {file.name}
        </span>
        {size > 0 && (
          <span style={previewMetaStyle}>
            {formatSize(size)}
          </span>
        )}
        {/* Insert @path */}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ...previewChipButtonStyle("var(--success)", "var(--success-soft)", { fontWeight: 700 }),
          }}
        >
          @
        </button>
        {/* Close */}
        <button
          onClick={onClose}
          title="Close preview"
          className="panel-icon-button"
          style={{
            ...previewIconButtonStyle(),
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: uiPx(12) }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: uiPx(12) }}>
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
            backgroundColor: "var(--surface-inset)",
            padding: 24,
          }}
        >
          {/* Large audio icon */}
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span style={{ color: "var(--text-primary)", fontSize: uiPx(13), fontWeight: 500, textAlign: "center", wordBreak: "break-all" }}>
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

/* ---- Video Preview ---- */

function VideoPreview({
  file,
  videoSrc,
  loading,
  size,
  errorMessage,
  onClose,
  onInsertPath,
  onPlayerError,
}: {
  file: PreviewFile;
  videoSrc: string | null;
  loading: boolean;
  size: number;
  errorMessage: string | null;
  onClose: () => void;
  onInsertPath: () => void;
  onPlayerError: () => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--surface-1)",
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
            fontSize: uiPx(11),
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        {size > 0 && (
          <span style={{ fontSize: uiPx(10), color: "var(--text-muted)", flexShrink: 0 }}>
            {formatSize(size)}
          </span>
        )}
        <button
          onClick={onInsertPath}
          title="Insert @path"
          className="panel-icon-button panel-icon-button--chip"
          style={{
            ["--panel-bg" as any]: "transparent",
            ["--panel-border" as any]: "var(--border-strong)",
            ["--panel-fg" as any]: "var(--success)",
            ["--panel-hover-bg" as any]: "var(--success-soft)",
            padding: "1px 6px",
            fontSize: uiPx(10),
            fontWeight: 700,
            borderRadius: 3,
            flexShrink: 0,
            lineHeight: "16px",
          }}
        >
          @
        </button>
        <button
          onClick={onClose}
          title="Close preview"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
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

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: uiPx(12) }}>
          Loading...
        </div>
      ) : errorMessage ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: uiPx(12) }}>
          {errorMessage}
        </div>
      ) : videoSrc ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--surface-inset)",
            padding: 12,
          }}
        >
          <video
            controls
            playsInline
            preload="metadata"
            src={videoSrc}
            style={{
              width: "100%",
              height: "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              backgroundColor: "#000000",
              borderRadius: 8,
            }}
            onError={onPlayerError}
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
      className="panel-list-row"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px 6px",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      <ParentFolderIcon size={32} />
      <span
        style={{
          marginTop: 4,
          fontSize: uiPx(10),
          color: "var(--text-secondary)",
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
      className="panel-list-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: uiPx(12),
        color: "var(--text-secondary)",
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
      fill="var(--text-muted)"
      opacity="0.6"
    />
    <path
      d="M5 9.5L8 7L11 9.5"
      stroke="var(--text-primary)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const RefreshIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 6a4.5 4.5 0 0 1 7.65-3.2L10.5 4" />
    <path d="M10.5 1.5V4H8" />
    <path d="M10.5 6a4.5 4.5 0 0 1-7.65 3.2L1.5 8" />
    <path d="M1.5 10.5V8H4" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6.5v3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H5" />
    <path d="M7.5 1.5H10.5V4.5" />
    <path d="M5.5 6.5L10.5 1.5" />
  </svg>
);

const GridIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="1" y="1" width="4" height="4" rx="0.5" />
    <rect x="7" y="1" width="4" height="4" rx="0.5" />
    <rect x="1" y="7" width="4" height="4" rx="0.5" />
    <rect x="7" y="7" width="4" height="4" rx="0.5" />
  </svg>
);

const ListIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
    <line x1="1" y1="3" x2="11" y2="3" />
    <line x1="1" y1="6" x2="11" y2="6" />
    <line x1="1" y1="9" x2="11" y2="9" />
  </svg>
);

const UploadIcon = ({ size = "1em" }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8V2" />
    <path d="M3.5 4.5L6 2l2.5 2.5" />
    <path d="M2 9h8" />
  </svg>
);

const NewFolderIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 3C1 2.45 1.45 2 2 2h2.5l1 1.5H10c.55 0 1 .45 1 1V9c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1V3z" />
    <path d="M5.5 5.5v3" />
    <path d="M4 7h3" />
  </svg>
);

/* ---- New Folder Inline Input Components ---- */

function NewFolderInlineGrid({
  value, onChange, onSubmit, onCancel,
}: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px 6px",
        borderRadius: 6,
        background: "var(--surface-2)",
      }}
    >
      <IconFolder size={32} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        placeholder="New folder"
        style={{
          marginTop: 4,
          fontSize: "0.85em",
          color: "var(--text-primary)",
          background: "var(--surface-1)",
          border: "1px solid var(--success)",
          borderRadius: 3,
          padding: "1px 4px",
          width: "100%",
          textAlign: "center",
          outline: "none",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

function NewFolderInlineList({
  value, onChange, onSubmit, onCancel,
}: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderRadius: 4,
        background: "var(--surface-2)",
        color: "var(--text-primary)",
      }}
    >
      <IconFolder size={16} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        placeholder="New folder"
        style={{
          flex: 1,
          minWidth: 0,
          color: "var(--text-primary)",
          background: "var(--surface-1)",
          border: "1px solid var(--success)",
          borderRadius: 3,
          padding: "1px 4px",
          outline: "none",
          fontFamily: "inherit",
          fontSize: "inherit",
        }}
      />
    </div>
  );
}

