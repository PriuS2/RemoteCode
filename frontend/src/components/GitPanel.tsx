import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { computeGraphLayout, type GitLogEntry } from "../utils/gitGraph";
import { apiFetch } from "../utils/api";
import { uiPx } from "../utils/uiScale";

/* =========================================================
   Types
   ========================================================= */

interface GitStatusFile {
  path: string;
  status: string;
  staged: boolean;
  old_path: string | null;
}

interface GitStatusResponse {
  is_git_repo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  untracked: GitStatusFile[];
  has_conflicts: boolean;
  detached: boolean;
}

interface GitDiffHunk {
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: { type: string; content: string; old_no: number | null; new_no: number | null }[];
}

interface GitDiffResponse {
  file_path: string;
  old_path: string | null;
  hunks: GitDiffHunk[];
  is_binary: boolean;
  additions: number;
  deletions: number;
}

interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
}

interface GitBranchesResponse {
  local: GitBranchInfo[];
  remote: GitBranchInfo[];
  current: string | null;
  detached: boolean;
}

interface GitCommitDetail {
  hash: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
  parents: string[];
  files: GitStatusFile[];
  additions: number;
  deletions: number;
}

/* =========================================================
   Props
   ========================================================= */

interface GitPanelProps {
  workPath: string;
  onClose: () => void;
  isMobile: boolean;
  embedded?: boolean;
  showHeaderTitle?: boolean;
  showWindowControls?: boolean;
}

/* =========================================================
   Helpers
   ========================================================= */

const STATUS_COLORS: Record<string, string> = {
  M: "var(--warn)",
  A: "var(--success)",
  D: "var(--danger)",
  R: "var(--info)",
  C: "var(--info)",
  U: "var(--danger)",
  "?": "var(--text-muted)",
};

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
  "?": "Untracked",
};

function statusColor(s: string) {
  return STATUS_COLORS[s] || "var(--text-primary)";
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

function basename(p: string) {
  return p.split(/[/\\]/).pop() || p;
}

/* =========================================================
   Main Component
   ========================================================= */

export default function GitPanel({
  workPath,
  onClose,
  isMobile,
  embedded = false,
  showHeaderTitle = true,
  showWindowControls = true,
}: GitPanelProps) {
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<"status" | "log">("status");
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileStaged, setSelectedFileStaged] = useState(false);
  const [diffContent, setDiffContent] = useState<GitDiffResponse | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetail | null>(null);
  const [commitDiffFile, setCommitDiffFile] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<GitDiffResponse | null>(null);
  const [branches, setBranches] = useState<GitBranchesResponse | null>(null);
  const [branchDropdown, setBranchDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [untrackedCollapsed, setUntrackedCollapsed] = useState(false);
  const [mobileDiffView, setMobileDiffView] = useState(false);
  const [mobileCommitView, setMobileCommitView] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [stashes, setStashes] = useState<{ index: number; message: string }[]>([]);
  const [showStash, setShowStash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  
  // Font size state (similar to FileExplorer)
  const [gitFontSize, setGitFontSize] = useState(() => {
    const v = localStorage.getItem("gitFontSize");
    return v ? Number(v) : 12;
  });

  useEffect(() => {
    localStorage.setItem("gitFontSize", String(gitFontSize));
  }, [gitFontSize]);

  // Commit metadata visibility toggle (for Log tab)
  const [showCommitMetadata, setShowCommitMetadata] = useState(() => {
    const v = localStorage.getItem("gitShowCommitMetadata");
    return v ? v === "true" : true;
  });

  useEffect(() => {
    localStorage.setItem("gitShowCommitMetadata", String(showCommitMetadata));
  }, [showCommitMetadata]);

  const headers = useMemo(() => ({}), []);

  /* ---- API calls ---- */

  const fetchStatus = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/git/status?path=${encodeURIComponent(workPath)}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      const data: GitStatusResponse = await r.json();
      setIsGitRepo(data.is_git_repo);
      if (data.is_git_repo) setStatus(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const fetchLog = useCallback(async (skip = 0) => {
    try {
      const r = await apiFetch(`/api/git/log?path=${encodeURIComponent(workPath)}&skip=${skip}&count=50`, { headers });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      if (skip === 0) {
        setCommits(data.commits);
      } else {
        setCommits((prev) => [...prev, ...data.commits]);
      }
      setHasMoreCommits(data.has_more);
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const fetchBranches = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/git/branches?path=${encodeURIComponent(workPath)}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      setBranches(await r.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const fetchDiff = useCallback(async (file: string, staged: boolean) => {
    try {
      const r = await apiFetch(`/api/git/diff?path=${encodeURIComponent(workPath)}&file=${encodeURIComponent(file)}&staged=${staged}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      setDiffContent(await r.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const fetchCommitDetail = useCallback(async (hash: string) => {
    try {
      const r = await apiFetch(`/api/git/commit-detail?path=${encodeURIComponent(workPath)}&hash=${encodeURIComponent(hash)}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      setCommitDetail(await r.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const fetchCommitDiff = useCallback(async (hash: string, file: string) => {
    try {
      const r = await apiFetch(`/api/git/commit-diff?path=${encodeURIComponent(workPath)}&hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(file)}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      setCommitDiff(await r.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, [workPath, headers]);

  const doStage = useCallback(async (files: string[]) => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/stage", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, files }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus]);

  const doUnstage = useCallback(async (files: string[]) => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/unstage", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, files }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus]);

  const doDiscard = useCallback(async (files: string[]) => {
    if (!confirm(`Discard changes to ${files.length} file(s)?`)) return;
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/discard", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, files }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus]);

  const doCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/commit", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, message: commitMessage }) });
      if (!r.ok) throw new Error(await r.text());
      setCommitMessage("");
      await fetchStatus();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, commitMessage, fetchStatus]);

  const doCheckout = useCallback(async (branch: string) => {
    setLoading(true);
    setBranchDropdown(false);
    try {
      const r = await apiFetch("/api/git/checkout", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, branch }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      await fetchBranches();
      if (activeTab === "log") await fetchLog();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchBranches, fetchLog, activeTab]);

  const doPull = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/pull", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      if (activeTab === "log") await fetchLog();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchLog, activeTab]);

  const doPush = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/push", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      await fetchBranches();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchBranches]);

  const doPatch = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/patch", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath }) });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      if (data.patch) {
        await navigator.clipboard.writeText(data.patch);
        setError("Patch copied to clipboard!");
        setTimeout(() => setError(null), 2000);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [workPath, headers]);

  const doCreateBranch = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setLoading(true);
    setBranchDropdown(false);
    setShowNewBranch(false);
    setNewBranchName("");
    try {
      const r = await apiFetch("/api/git/create-branch", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, name: name.trim(), checkout: true }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      await fetchBranches();
      if (activeTab === "log") await fetchLog();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchBranches, fetchLog, activeTab]);

  const fetchStashes = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/git/stash-list?path=${encodeURIComponent(workPath)}`, { headers });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStashes(data.stashes);
    } catch (e: any) { setError(e.message); }
  }, [workPath, headers]);

  const doStash = useCallback(async (message?: string) => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/stash", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath, message: message || "" }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      await fetchStashes();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchStashes]);

  const doStashPop = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/stash-pop", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStatus();
      await fetchStashes();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStatus, fetchStashes]);

  const doStashDrop = useCallback(async () => {
    if (!confirm("Drop the latest stash?")) return;
    setLoading(true);
    try {
      const r = await apiFetch("/api/git/stash-drop", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: workPath }) });
      if (!r.ok) throw new Error(await r.text());
      await fetchStashes();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [workPath, headers, fetchStashes]);

  /* ---- Initial load ---- */

  useEffect(() => {
    fetchStatus();
    fetchBranches();
    fetchStashes();
  }, [fetchStatus, fetchBranches, fetchStashes]);

  useEffect(() => {
    if (isGitRepo && activeTab === "log" && commits.length === 0) {
      fetchLog();
    }
  }, [isGitRepo, activeTab, commits.length, fetchLog]);

  /* ---- Diff on file select ---- */

  useEffect(() => {
    if (selectedFile) {
      fetchDiff(selectedFile, selectedFileStaged);
      if (isMobile) setMobileDiffView(true);
    } else {
      setDiffContent(null);
    }
  }, [selectedFile, selectedFileStaged, fetchDiff, isMobile]);

  /* ---- Commit detail on select ---- */

  useEffect(() => {
    if (selectedCommit) {
      fetchCommitDetail(selectedCommit);
      setCommitDiffFile(null);
      setCommitDiff(null);
      if (isMobile) setMobileCommitView(true);
    } else {
      setCommitDetail(null);
    }
  }, [selectedCommit, fetchCommitDetail, isMobile]);

  useEffect(() => {
    if (selectedCommit && commitDiffFile) {
      fetchCommitDiff(selectedCommit, commitDiffFile);
    } else {
      setCommitDiff(null);
    }
  }, [selectedCommit, commitDiffFile, fetchCommitDiff]);

  /* ---- Click-outside to close branch dropdown ---- */

  useEffect(() => {
    if (!branchDropdown) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdown(false);
        setShowNewBranch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdown]);

  /* ---- Error auto-clear ---- */

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  /* ---- Graph layout ---- */

  const graphLayout = useMemo(() => {
    if (commits.length === 0) return null;
    return computeGraphLayout(commits);
  }, [commits]);

  /* ---- Refresh ---- */

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
    await fetchBranches();
    if (activeTab === "log") {
      setCommits([]);
      await fetchLog();
    }
    setLoading(false);
  }, [fetchStatus, fetchBranches, fetchLog, activeTab]);

  /* =========================================================
     Not a git repo
     ========================================================= */

  if (isGitRepo === false) {
    const inner = (
      <div className="panel-shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PanelHeader
          title="Git"
          onClose={onClose}
          onRefresh={handleRefresh}
          loading={loading}
          gitFontSize={gitFontSize}
          onFontSizeChange={setGitFontSize}
          showTitle={showHeaderTitle}
          showWindowControls={showWindowControls}
        />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div>
            <div style={{ fontSize: uiPx(14), color: "var(--text-muted)", marginBottom: 8 }}>Not a Git repository</div>
            <div style={{ fontSize: uiPx(12), color: "var(--text-secondary)" }}>Run <code style={{ background: "var(--surface-2)", padding: "2px 6px", borderRadius: 3 }}>git init</code> in the terminal to initialize.</div>
          </div>
        </div>
      </div>
    );
    if (isMobile && !embedded) return createPortal(<div className="panel-shell" style={{ position: "fixed", top: 44, left: 0, right: 0, bottom: 0, zIndex: 60 }}>{inner}</div>, document.body);
    return inner;
  }

  /* =========================================================
     Loading state
     ========================================================= */

  if (isGitRepo === null) {
    const inner = (
      <div className="panel-shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PanelHeader
          title="Git"
          onClose={onClose}
          onRefresh={handleRefresh}
          loading={true}
          gitFontSize={gitFontSize}
          onFontSizeChange={setGitFontSize}
          showTitle={showHeaderTitle}
          showWindowControls={showWindowControls}
        />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text-muted)" }}>Loading...</span>
        </div>
      </div>
    );
    if (isMobile && !embedded) return createPortal(<div className="panel-shell" style={{ position: "fixed", top: 44, left: 0, right: 0, bottom: 0, zIndex: 60 }}>{inner}</div>, document.body);
    return inner;
  }

  /* =========================================================
     Main panel content
     ========================================================= */

  const hasStagedChanges = status ? status.staged.length > 0 : false;

  const panelContent = (
    <div className="panel-shell" style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, borderRight: isMobile || embedded ? undefined : "1px solid var(--border-subtle)", fontSize: gitFontSize }}>
      {/* Header */}
      <PanelHeader
        title="Git"
        onClose={onClose}
        onRefresh={handleRefresh}
        loading={loading}
        gitFontSize={gitFontSize}
        onFontSizeChange={setGitFontSize}
        showTitle={showHeaderTitle}
        showWindowControls={showWindowControls}
      >
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 0, marginLeft: 8 }}>
          <TabBtn label="Status" active={activeTab === "status"} onClick={() => setActiveTab("status")} gitFontSize={gitFontSize} />
          <TabBtn label="Log" active={activeTab === "log"} onClick={() => setActiveTab("log")} gitFontSize={gitFontSize} />
        </div>
        {/* Log tab: commit metadata toggle */}
        {activeTab === "log" && (
          <button
            onClick={() => setShowCommitMetadata((v) => !v)}
            title={showCommitMetadata ? "Hide commit metadata" : "Show commit metadata"}
            className="panel-icon-button"
            style={{
              ["--panel-fg" as any]: showCommitMetadata ? "var(--accent)" : "var(--text-muted)",
              ["--panel-hover-fg" as any]: "var(--text-primary)",
              fontSize: Math.round(gitFontSize * 0.85),
              padding: "2px 6px", marginLeft: 8, borderRadius: 3,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: Math.round(gitFontSize * 0.75) }}>{showCommitMetadata ? "ON" : "OFF"}</span>
            <span>Info</span>
          </button>
        )}
      </PanelHeader>

      {/* Error bar */}
      {error && (
        <div style={{ padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), background: "var(--danger-soft)", color: "var(--danger)", borderBottom: "1px solid var(--border-subtle)" }}>
          {error}
        </div>
      )}

      {/* Branch bar */}
      {status && (
        <div ref={branchDropdownRef} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, position: "relative" }}>
          <BranchIcon size={Math.round(gitFontSize)} />
          <button
            onClick={() => { setBranchDropdown((v) => !v); if (!branches) fetchBranches(); }}
            className="panel-icon-button"
            style={{ ["--panel-fg" as any]: "var(--accent)", ["--panel-hover-fg" as any]: "var(--text-primary)", fontSize: Math.round(gitFontSize * 0.92), fontWeight: 600, padding: 0 }}
          >
            {status.detached ? `(${status.branch || "HEAD"})` : status.branch || "unknown"}
          </button>
          {status.upstream && (
            <span style={{ color: "var(--text-muted)" }}>
              {status.ahead > 0 && <span style={{ color: "var(--success)" }}>{"\u2191"}{status.ahead}</span>}
              {status.behind > 0 && <span style={{ color: "var(--danger)", marginLeft: 4 }}>{"\u2193"}{status.behind}</span>}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <SmallBtn title="Pull" onClick={doPull} disabled={loading || !status.upstream} gitFontSize={gitFontSize}>{"\u2193"} Pull</SmallBtn>
          <SmallBtn title={status.upstream ? "Push" : "Publish Branch"} onClick={doPush} disabled={loading || status.detached} gitFontSize={gitFontSize}>{"\u2191"} {status.upstream ? "Push" : "Publish"}</SmallBtn>
          {/* Branch dropdown */}
          {branchDropdown && branches && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
              background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: 4,
              maxHeight: 200, overflowY: "auto", boxShadow: "var(--shadow-floating)",
            }}>
              {/* Create new branch */}
              {showNewBranch ? (
                <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: 4 }}>
                  <input
                    autoFocus
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") doCreateBranch(newBranchName); if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); } }}
                    placeholder="new-branch-name"
                    style={{
                      flex: 1, background: "var(--surface-3)", border: "1px solid var(--border-strong)", borderRadius: 3,
                      color: "var(--text-primary)", fontSize: Math.round(gitFontSize * 0.92), padding: "2px 6px", outline: "none", minWidth: 0,
                    }}
                  />
                  <button onClick={() => doCreateBranch(newBranchName)} disabled={!newBranchName.trim()} className="panel-icon-button" style={{
                    ["--panel-bg" as any]: newBranchName.trim() ? "var(--success)" : "var(--surface-3)",
                    ["--panel-fg" as any]: newBranchName.trim() ? "var(--accent-contrast)" : "var(--text-muted)",
                    ["--panel-hover-bg" as any]: "var(--success)",
                    ["--panel-hover-fg" as any]: "var(--accent-contrast)",
                    fontSize: Math.round(gitFontSize * 0.85), padding: "2px 6px", fontWeight: 600,
                  }}>Create</button>
                </div>
              ) : (
                <div
                  onClick={() => setShowNewBranch(true)}
                  className="panel-list-row"
                  style={{ padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), cursor: "pointer", color: "var(--success)", borderBottom: "1px solid var(--border-subtle)", ["--row-hover-bg" as any]: "var(--surface-3)" }}
                >
                  + New Branch
                </div>
              )}
              {branches.local.map((b) => (
                <div
                  key={b.name}
                  onClick={() => !b.is_current && doCheckout(b.name)}
                  className={`panel-list-row${b.is_current ? " is-selected" : ""}`}
                  style={{
                    padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), cursor: b.is_current ? "default" : "pointer",
                    color: b.is_current ? "var(--accent)" : "var(--text-primary)",
                    ["--row-hover-bg" as any]: "var(--surface-3)",
                    ["--row-selected-bg" as any]: "var(--accent-soft)",
                  }}
                >
                  {b.is_current ? "* " : ""}{b.name}
                  {b.tracking && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>{"\u2192"} {b.tracking}</span>}
                </div>
              ))}
              {branches.remote.length > 0 && (
                <div style={{ padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.85), color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}>Remote</div>
              )}
              {branches.remote.map((b) => (
                <div key={b.name} style={{ padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-muted)" }}>{b.name}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stash bar */}
      {activeTab === "status" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: Math.round(gitFontSize * 0.85), borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <StashIcon size={Math.round(gitFontSize * 0.92)} />
          <span style={{ color: "var(--text-muted)" }}>Stash{stashes.length > 0 ? ` (${stashes.length})` : ""}</span>
          <div style={{ flex: 1 }} />
          <SmallBtn title="Stash All" onClick={() => doStash()} disabled={loading || (!status?.unstaged.length && !status?.untracked.length && !status?.staged.length)} gitFontSize={gitFontSize}>Stash</SmallBtn>
          {stashes.length > 0 && (
            <>
              <SmallBtn title="Pop Stash" onClick={doStashPop} disabled={loading} gitFontSize={gitFontSize}>Pop</SmallBtn>
              <SmallBtn title="Drop Stash" onClick={doStashDrop} disabled={loading} gitFontSize={gitFontSize}>Drop</SmallBtn>
            </>
          )}
          <button
            onClick={() => { setShowStash((v) => !v); if (stashes.length === 0) fetchStashes(); }}
            className="panel-icon-button"
            style={{ ["--panel-fg" as any]: showStash ? "var(--accent)" : "var(--text-muted)", ["--panel-hover-fg" as any]: "var(--text-primary)", fontSize: Math.round(gitFontSize * 0.75), padding: "0 2px" }}
          >
            {showStash ? "\u25BC" : "\u25B6"}
          </button>
        </div>
      )}
      {showStash && stashes.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--border-subtle)", maxHeight: 100, overflowY: "auto", flexShrink: 0 }}>
          {stashes.map((s) => (
            <div key={s.index} style={{ padding: "2px 8px 2px 24px", fontSize: Math.round(gitFontSize * 0.85), color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--text-muted)" }}>stash@{`{${s.index}}`}</span>{" "}
              {s.message}
            </div>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: activeTab === "log" ? "hidden" : "auto", minHeight: 0 }}>
        {activeTab === "status" && status && (
          <StatusTab
            status={status}
            selectedFile={selectedFile}
            selectedFileStaged={selectedFileStaged}
            diffContent={diffContent}
            onSelectFile={(f, staged) => { setSelectedFile(f); setSelectedFileStaged(staged); }}
            onStage={doStage}
            onUnstage={doUnstage}
            onDiscard={doDiscard}
            loading={loading}
            stagedCollapsed={stagedCollapsed}
            changesCollapsed={changesCollapsed}
            untrackedCollapsed={untrackedCollapsed}
            onToggleStaged={() => setStagedCollapsed((v) => !v)}
            onToggleChanges={() => setChangesCollapsed((v) => !v)}
            onToggleUntracked={() => setUntrackedCollapsed((v) => !v)}
            isMobile={isMobile}
            mobileDiffView={mobileDiffView}
            onBackFromDiff={() => { setMobileDiffView(false); setSelectedFile(null); }}
            gitFontSize={gitFontSize}
          />
        )}
        {activeTab === "log" && (
          <LogTab
            commits={commits}
            graphLayout={graphLayout}
            hasMore={hasMoreCommits}
            onLoadMore={() => fetchLog(commits.length)}
            selectedCommit={selectedCommit}
            onSelectCommit={setSelectedCommit}
            commitDetail={commitDetail}
            commitDiffFile={commitDiffFile}
            commitDiff={commitDiff}
            onSelectCommitDiffFile={setCommitDiffFile}
            isMobile={isMobile}
            mobileCommitView={mobileCommitView}
            onBackFromCommit={() => { setMobileCommitView(false); setSelectedCommit(null); }}
            gitFontSize={gitFontSize}
            showCommitMetadata={showCommitMetadata}
          />
        )}
      </div>

      {/* Commit box (status tab only) */}
      {activeTab === "status" && status && !(isMobile && mobileDiffView) && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: 8, flexShrink: 0 }}>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            style={{
              width: "100%", minHeight: Math.round(gitFontSize * 4), maxHeight: Math.round(gitFontSize * 10), resize: "vertical",
              background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: 4,
              color: "var(--text-primary)", fontSize: gitFontSize, padding: "6px 8px",
              fontFamily: "'Cascadia Code', 'Consolas', monospace",
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(); } }}
          />
          <button
            onClick={doCommit}
            disabled={!commitMessage.trim() || !hasStagedChanges || loading || status.has_conflicts}
            className="panel-icon-button"
            style={{
              ["--panel-bg" as any]: commitMessage.trim() && hasStagedChanges && !loading && !status.has_conflicts ? "var(--success)" : "var(--surface-3)",
              ["--panel-fg" as any]: commitMessage.trim() && hasStagedChanges && !loading && !status.has_conflicts ? "var(--accent-contrast)" : "var(--text-muted)",
              ["--panel-hover-bg" as any]: "var(--success)",
              ["--panel-hover-fg" as any]: "var(--accent-contrast)",
              width: "100%", marginTop: 4, padding: "6px 0", borderRadius: 4,
              fontWeight: 600, fontSize: gitFontSize,
            }}
          >
            {loading ? "Committing..." : status.has_conflicts ? "Resolve conflicts first" : "Commit"}
          </button>
        </div>
      )}
    </div>
  );

  if (isMobile && !embedded) {
    return createPortal(
      <div className="panel-shell" style={{ position: "fixed", top: 44, left: 0, right: 0, bottom: 0, zIndex: 60 }}>
        {panelContent}
      </div>,
      document.body,
    );
  }
  return panelContent;
}

/* =========================================================
   Sub-components
   ========================================================= */

function PanelHeader({ title, onClose, onRefresh, loading, children, gitFontSize, onFontSizeChange, showTitle = true, showWindowControls = true }: {
  title: string; onClose: () => void; onRefresh: () => void; loading: boolean; children?: React.ReactNode; gitFontSize: number; onFontSizeChange: (fn: (s: number) => number) => void; showTitle?: boolean; showWindowControls?: boolean;
}) {
  return (
    <div className="panel-toolbar" style={{
      display: "flex", alignItems: "center", height: 28, padding: "0 8px",
      background: "var(--surface-1)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, userSelect: "none",
    }}>
      {showTitle && <span style={{ fontWeight: 700, fontSize: gitFontSize, color: "var(--text-primary)" }}>{title}</span>}
      {children}
      <div style={{ flex: 1 }} />
      {/* Font size controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 1, marginRight: 8 }}>
        <button
          onClick={() => onFontSizeChange((s) => Math.max(8, s - 1))}
          title="Decrease font size"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
            fontSize: gitFontSize, fontWeight: 700, padding: "0 4px", lineHeight: 1, borderRadius: 3,
          }}
        >-</button>
        <span style={{ fontSize: Math.round(gitFontSize * 0.85), color: "var(--text-muted)", minWidth: "1.5em", textAlign: "center" }}>
          {gitFontSize}
        </span>
        <button
          onClick={() => onFontSizeChange((s) => Math.min(20, s + 1))}
          title="Increase font size"
          className="panel-icon-button"
          style={{
            ["--panel-fg" as any]: "var(--text-muted)",
            ["--panel-hover-fg" as any]: "var(--text-primary)",
            fontSize: gitFontSize, fontWeight: 700, padding: "0 4px", lineHeight: 1, borderRadius: 3,
          }}
        >+</button>
      </div>
      {showWindowControls && (
        <>
          <HeaderBtn title="Refresh" onClick={onRefresh} disabled={loading}>
            <RefreshIcon size={gitFontSize} spinning={loading} />
          </HeaderBtn>
          <HeaderBtn title="Close" onClick={onClose}>
            <CloseIcon size={gitFontSize} />
          </HeaderBtn>
        </>
      )}
    </div>
  );
}

function HeaderBtn({ title, onClick, disabled, children }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      className="panel-icon-button"
      title={title} onClick={onClick} disabled={disabled}
      style={{
        ["--panel-fg" as any]: "var(--text-muted)",
        ["--panel-hover-fg" as any]: "var(--text-primary)",
        padding: "2px 4px", borderRadius: 3, display: "flex", alignItems: "center",
      }}
    >
      {children}
    </button>
  );
}

function TabBtn({ label, active, onClick, gitFontSize }: { label: string; active: boolean; onClick: () => void; gitFontSize: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        border: "none", color: active ? "var(--accent)" : "var(--text-muted)",
        fontSize: Math.round(gitFontSize * 0.92), fontWeight: active ? 700 : 400,
        padding: "2px 8px", borderRadius: 3, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function SmallBtn({ title, onClick, disabled, children, gitFontSize }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; gitFontSize: number;
}) {
  return (
    <button
      className="panel-icon-button panel-icon-button--chip"
      title={title} onClick={onClick} disabled={disabled}
      style={{
        ["--panel-bg" as any]: "var(--surface-2)",
        ["--panel-border" as any]: "var(--border-subtle)",
        ["--panel-fg" as any]: disabled ? "var(--border-strong)" : "var(--text-primary)",
        ["--panel-hover-bg" as any]: "var(--surface-3)",
        fontSize: Math.round(gitFontSize * 0.85), padding: "2px 6px", borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* ---- Status Tab ---- */

function StatusTab({ status, selectedFile, selectedFileStaged, diffContent, onSelectFile, onStage, onUnstage, onDiscard, loading, stagedCollapsed, changesCollapsed, untrackedCollapsed, onToggleStaged, onToggleChanges, onToggleUntracked, isMobile, mobileDiffView, onBackFromDiff, gitFontSize }: {
  status: GitStatusResponse;
  selectedFile: string | null;
  selectedFileStaged: boolean;
  diffContent: GitDiffResponse | null;
  onSelectFile: (f: string | null, staged: boolean) => void;
  onStage: (files: string[]) => void;
  onUnstage: (files: string[]) => void;
  onDiscard: (files: string[]) => void;
  loading: boolean;
  stagedCollapsed: boolean;
  changesCollapsed: boolean;
  untrackedCollapsed: boolean;
  onToggleStaged: () => void;
  onToggleChanges: () => void;
  onToggleUntracked: () => void;
  isMobile: boolean;
  mobileDiffView: boolean;
  onBackFromDiff: () => void;
  gitFontSize: number;
}) {
  // Mobile diff sub-view
  if (isMobile && mobileDiffView && diffContent) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)" }}>
          <button onClick={onBackFromDiff} className="panel-icon-button" style={{ ["--panel-fg" as any]: "var(--accent)", ["--panel-hover-fg" as any]: "var(--text-primary)", fontSize: gitFontSize, padding: "2px 4px" }}>
            {"\u2190"} Back
          </button>
          <span style={{ fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-primary)", marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {basename(diffContent.file_path)}
          </span>
        </div>
        <DiffView diff={diffContent} gitFontSize={gitFontSize} />
      </div>
    );
  }

  const allUnstaged = [...status.unstaged, ...status.untracked];

  return (
    <div>
      {/* Staged Changes */}
      {status.staged.length > 0 && (
        <FileSection
          title="Staged Changes"
          count={status.staged.length}
          color="#a6e3a1"
          collapsed={stagedCollapsed}
          onToggle={onToggleStaged}
          actions={<SectionBtn label={"\u2212"} title="Unstage All" onClick={() => onUnstage(status.staged.map((f) => f.path))} disabled={loading} gitFontSize={gitFontSize} />}
          gitFontSize={gitFontSize}
        >
          {status.staged.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              selected={selectedFile === f.path && selectedFileStaged}
              onClick={() => onSelectFile(f.path, true)}
              actions={
                <RowBtn label={"\u2212"} title="Unstage" color="#f9e2af" onClick={() => onUnstage([f.path])} gitFontSize={gitFontSize} />
              }
              gitFontSize={gitFontSize}
            />
          ))}
        </FileSection>
      )}

      {/* Changes */}
      {status.unstaged.length > 0 && (
        <FileSection
          title="Changes"
          count={status.unstaged.length}
          color="#f9e2af"
          collapsed={changesCollapsed}
          onToggle={onToggleChanges}
          actions={
            <>
              <SectionBtn label="+" title="Stage All" onClick={() => onStage(status.unstaged.map((f) => f.path))} disabled={loading} gitFontSize={gitFontSize} />
              <SectionBtn label={"\u2716"} title="Discard All" onClick={() => onDiscard(status.unstaged.map((f) => f.path))} disabled={loading} gitFontSize={gitFontSize} />
            </>
          }
          gitFontSize={gitFontSize}
        >
          {status.unstaged.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              selected={selectedFile === f.path && !selectedFileStaged}
              onClick={() => onSelectFile(f.path, false)}
              actions={
                <>
                  <RowBtn label="+" title="Stage" color="#a6e3a1" onClick={() => onStage([f.path])} gitFontSize={gitFontSize} />
                  <RowBtn label={"\u2716"} title="Discard" color="#f38ba8" onClick={() => onDiscard([f.path])} gitFontSize={gitFontSize} />
                </>
              }
              gitFontSize={gitFontSize}
            />
          ))}
        </FileSection>
      )}

      {/* Untracked */}
      {status.untracked.length > 0 && (
        <FileSection
          title="Untracked"
          count={status.untracked.length}
          color="#6c7086"
          collapsed={untrackedCollapsed}
          onToggle={onToggleUntracked}
          actions={<SectionBtn label="+" title="Stage All" onClick={() => onStage(status.untracked.map((f) => f.path))} disabled={loading} gitFontSize={gitFontSize} />}
          gitFontSize={gitFontSize}
        >
          {status.untracked.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              selected={selectedFile === f.path && !selectedFileStaged}
              onClick={() => onSelectFile(f.path, false)}
              actions={
                <RowBtn label="+" title="Stage" color="#a6e3a1" onClick={() => onStage([f.path])} gitFontSize={gitFontSize} />
              }
              gitFontSize={gitFontSize}
            />
          ))}
        </FileSection>
      )}

      {/* Empty state */}
      {allUnstaged.length === 0 && status.staged.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: gitFontSize }}>
          No changes detected
        </div>
      )}

      {/* Diff view (desktop) */}
      {!isMobile && diffContent && selectedFile && (
        <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ padding: "4px 8px", fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-muted)", background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}>
            {diffContent.file_path}
            <span style={{ marginLeft: 8, color: "var(--success)" }}>+{diffContent.additions}</span>
            <span style={{ marginLeft: 4, color: "var(--danger)" }}>-{diffContent.deletions}</span>
          </div>
          <DiffView diff={diffContent} gitFontSize={gitFontSize} />
        </div>
      )}
    </div>
  );
}

/* ---- Log Tab ---- */

function LogTab({ commits, graphLayout, hasMore, onLoadMore, selectedCommit, onSelectCommit, commitDetail, commitDiffFile, commitDiff, onSelectCommitDiffFile, isMobile, mobileCommitView, onBackFromCommit, gitFontSize, showCommitMetadata }: {
  commits: GitLogEntry[];
  graphLayout: ReturnType<typeof computeGraphLayout> | null;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedCommit: string | null;
  onSelectCommit: (hash: string | null) => void;
  commitDetail: GitCommitDetail | null;
  commitDiffFile: string | null;
  commitDiff: GitDiffResponse | null;
  onSelectCommitDiffFile: (f: string | null) => void;
  isMobile: boolean;
  mobileCommitView: boolean;
  onBackFromCommit: () => void;
  gitFontSize: number;
  showCommitMetadata: boolean;
}) {
  // Mobile commit detail sub-view
  if (isMobile && mobileCommitView && commitDetail) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)" }}>
          <button onClick={onBackFromCommit} className="panel-icon-button" style={{ ["--panel-fg" as any]: "var(--accent)", ["--panel-hover-fg" as any]: "var(--text-primary)", fontSize: gitFontSize }}>
            {"\u2190"} Back
          </button>
          <span style={{ fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-primary)", marginLeft: 8 }}>{commitDetail.hash.slice(0, 8)}</span>
        </div>
        <CommitDetailView detail={commitDetail} commitDiffFile={commitDiffFile} commitDiff={commitDiff} onSelectFile={onSelectCommitDiffFile} gitFontSize={gitFontSize} />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: gitFontSize }}>
        No commits yet
      </div>
    );
  }

  const ROW_H = Math.round(gitFontSize * 2.3);
  const LANE_W = Math.round(gitFontSize * 1.3);
  const NODE_R = Math.round(gitFontSize * 0.33);
  const maxLane = graphLayout?.maxLane ?? 0;
  const graphW = (maxLane + 1) * LANE_W + 8;

  const showDetail = !isMobile && commitDetail && selectedCommit;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Top: Commit list (scrollable) */}
      <div style={{ flex: showDetail ? "0 0 50%" : 1, overflowY: "auto", minHeight: 0 }}>
        {commits.map((c, i) => {
          const node = graphLayout?.nodes[i];
          const isSelected = selectedCommit === c.hash;

          return (
            <div
              key={c.hash}
              onClick={() => onSelectCommit(isSelected ? null : c.hash)}
              className={`panel-list-row${isSelected ? " is-selected" : ""}`}
              style={{
                display: "flex", alignItems: "center", height: ROW_H, cursor: "pointer",
                ["--row-hover-bg" as any]: "var(--surface-2)",
                ["--row-selected-bg" as any]: "var(--accent-soft)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              {/* Graph column */}
              {!isMobile && (
                <svg width={graphW} height={ROW_H} style={{ flexShrink: 0 }}>
                  {/* Lines from this row */}
                  {graphLayout?.lines.filter((l) => l.fromRow === i).map((l, li) => {
                    const x1 = l.fromLane * LANE_W + LANE_W / 2 + 4;
                    const x2 = l.toLane * LANE_W + LANE_W / 2 + 4;
                    return (
                      <line key={li} x1={x1} y1={ROW_H / 2} x2={x2} y2={ROW_H} stroke={l.color} strokeWidth={Math.max(1, gitFontSize * 0.125)} opacity={0.6} />
                    );
                  })}
                  {/* Incoming lines into this row (continuation + diagonal arrivals) */}
                  {graphLayout?.lines.filter((l) => l.toRow === i).map((l, li) => {
                    const x = l.toLane * LANE_W + LANE_W / 2 + 4;
                    return (
                      <line key={`cont-${li}`} x1={x} y1={0} x2={x} y2={ROW_H / 2} stroke={l.color} strokeWidth={Math.max(1, gitFontSize * 0.125)} opacity={0.6} />
                    );
                  })}
                  {/* Node circle */}
                  {node && (
                    <circle cx={node.lane * LANE_W + LANE_W / 2 + 4} cy={ROW_H / 2} r={NODE_R} fill={node.color} />
                  )}
                </svg>
              )}
              {/* Mobile: color dot only */}
              {isMobile && node && (
                <div style={{ width: Math.round(gitFontSize * 1.3), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: Math.round(gitFontSize * 0.67), height: Math.round(gitFontSize * 0.67), borderRadius: Math.round(gitFontSize * 0.33), background: node.color }} />
                </div>
              )}
              {/* Commit info */}
              <div style={{ flex: 1, minWidth: 0, padding: "0 6px", display: "flex", alignItems: "center", gap: 6 }}>
                {/* Ref badges */}
                {c.refs.length > 0 && c.refs.map((ref, ri) => (
                  <span key={ri} style={{
                    fontSize: Math.round(gitFontSize * 0.75), padding: "1px 4px", borderRadius: 3,
                    background: "var(--accent-soft)", color: "var(--accent)",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {ref.replace("HEAD -> ", "")}
                  </span>
                ))}
                {/* Message */}
                <span style={{
                  fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-primary)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
                }}>
                  {c.message}
                </span>
                {/* Author + date + hash */}
                {showCommitMetadata && (
                  <span style={{ fontSize: Math.round(gitFontSize * 0.85), color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {!isMobile && <>{c.author_name} &middot; </>}
                    {relativeTime(c.date)}
                    {!isMobile && <> &middot; <span style={{ color: "var(--text-secondary)" }}>{c.short_hash}</span></>}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Load more */}
        {hasMore && (
          <div style={{ padding: 8, textAlign: "center" }}>
            <button
              onClick={onLoadMore}
              className="panel-icon-button panel-icon-button--chip"
              style={{
                ["--panel-bg" as any]: "var(--surface-2)",
                ["--panel-border" as any]: "var(--border-subtle)",
                ["--panel-fg" as any]: "var(--text-primary)",
                ["--panel-hover-bg" as any]: "var(--surface-3)",
                fontSize: Math.round(gitFontSize * 0.92), padding: "4px 12px", borderRadius: 4, cursor: "pointer",
              }}
            >
              Load more...
            </button>
          </div>
        )}
      </div>

      {/* Bottom: Commit detail (scrollable, fixed to bottom half) */}
      {showDetail && (
        <div style={{ flex: "0 0 50%", borderTop: "2px solid var(--border-strong)", overflowY: "auto", minHeight: 0 }}>
          <CommitDetailView detail={commitDetail} commitDiffFile={commitDiffFile} commitDiff={commitDiff} onSelectFile={onSelectCommitDiffFile} gitFontSize={gitFontSize} />
        </div>
      )}
    </div>
  );
}

/* ---- Commit Detail View ---- */

function CommitDetailView({ detail, commitDiffFile, commitDiff, onSelectFile, gitFontSize }: {
  detail: GitCommitDetail;
  commitDiffFile: string | null;
  commitDiff: GitDiffResponse | null;
  onSelectFile: (f: string | null) => void;
  gitFontSize: number;
}) {
  return (
    <div style={{ fontSize: Math.round(gitFontSize * 0.92) }}>
      {/* Commit info */}
      <div style={{ padding: 8, borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
          <span style={{ color: "var(--accent)" }}>{detail.hash.slice(0, 12)}</span>
          {detail.parents.length > 0 && (
            <span style={{ marginLeft: 8 }}>Parent: {detail.parents.map((p) => p.slice(0, 8)).join(", ")}</span>
          )}
        </div>
        <div style={{ color: "var(--text-primary)", marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail.message}</div>
        <div style={{ color: "var(--text-muted)" }}>
          {detail.author_name} &lt;{detail.author_email}&gt; &middot; {relativeTime(detail.date)}
        </div>
        <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
          <span style={{ color: "var(--success)" }}>+{detail.additions}</span>
          <span style={{ marginLeft: 6, color: "var(--danger)" }}>-{detail.deletions}</span>
          <span style={{ marginLeft: 6 }}>{detail.files.length} file(s)</span>
        </div>
      </div>

      {/* Changed files */}
      <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {detail.files.map((f) => (
          <div
            key={f.path}
            onClick={() => onSelectFile(commitDiffFile === f.path ? null : f.path)}
            className={`panel-list-row${commitDiffFile === f.path ? " is-selected" : ""}`}
            style={{
              display: "flex", alignItems: "center", padding: "3px 8px", cursor: "pointer",
              ["--row-hover-bg" as any]: "var(--surface-2)",
              ["--row-selected-bg" as any]: "var(--accent-soft)",
            }}
          >
            <span style={{ width: 14, color: statusColor(f.status), fontSize: Math.round(gitFontSize * 0.85), fontWeight: 700, flexShrink: 0, textAlign: "center" }}>{f.status}</span>
            <span style={{ fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 6 }}>
              {f.path}
            </span>
          </div>
        ))}
      </div>

      {/* Diff view */}
      {commitDiff && commitDiffFile && <DiffView diff={commitDiff} gitFontSize={gitFontSize} />}
    </div>
  );
}

/* ---- File Section (collapsible) ---- */

function FileSection({ title, count, color, collapsed, onToggle, actions, children, gitFontSize }: {
  title: string; count: number; color: string; collapsed: boolean; onToggle: () => void;
  actions?: React.ReactNode; children: React.ReactNode; gitFontSize: number;
}) {
  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", padding: "3px 8px", cursor: "pointer",
          background: `color-mix(in srgb, ${color} 12%, transparent)`, borderBottom: "1px solid var(--border-subtle)", userSelect: "none",
        }}
      >
        <span style={{ fontSize: Math.round(gitFontSize * 0.75), color: "var(--text-muted)", marginRight: 4 }}>{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span style={{ fontSize: Math.round(gitFontSize * 0.92), fontWeight: 600, color }}>{title}</span>
        <span style={{ fontSize: Math.round(gitFontSize * 0.85), color: "var(--text-muted)", marginLeft: 4 }}>({count})</span>
        <div style={{ flex: 1 }} />
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2 }}>{actions}</div>
      </div>
      {!collapsed && children}
    </div>
  );
}

function SectionBtn({ label, title, onClick, disabled, gitFontSize }: {
  label: string; title: string; onClick: () => void; disabled?: boolean; gitFontSize: number;
}) {
  return (
    <button
      className="panel-icon-button"
      title={title} onClick={onClick} disabled={disabled}
      style={{
        ["--panel-fg" as any]: "var(--text-muted)",
        ["--panel-hover-fg" as any]: "var(--text-primary)",
        fontSize: Math.round(gitFontSize), fontWeight: 700, padding: "0 4px", lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

/* ---- File Row ---- */

function FileRow({ file, selected, onClick, actions, gitFontSize }: {
  file: GitStatusFile; selected: boolean; onClick: () => void; actions: React.ReactNode; gitFontSize: number;
}) {
  return (
    <div
      onClick={onClick}
      className={`panel-list-row${selected ? " is-selected" : ""}`}
      style={{
        display: "flex", alignItems: "center", padding: "2px 8px 2px 16px", cursor: "pointer",
        ["--row-hover-bg" as any]: "var(--surface-2)",
        ["--row-selected-bg" as any]: "var(--accent-soft)",
      }}
    >
      <span style={{
        width: 14, flexShrink: 0, fontSize: Math.round(gitFontSize * 0.85), fontWeight: 700, textAlign: "center",
        color: statusColor(file.status),
      }}>
        {file.status}
      </span>
      <span style={{
        flex: 1, fontSize: Math.round(gitFontSize * 0.92), color: "var(--text-primary)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 6,
      }} title={file.path}>
        {basename(file.path)}
        {file.old_path && <span style={{ color: "var(--text-muted)" }}> {"\u2190"} {basename(file.old_path)}</span>}
      </span>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2, marginLeft: 4, flexShrink: 0 }}>
        {actions}
      </div>
    </div>
  );
}

function RowBtn({ label, title, color, onClick, gitFontSize }: {
  label: string; title: string; color: string; onClick: () => void; gitFontSize: number;
}) {
  return (
    <button
      className="panel-icon-button"
      title={title} onClick={onClick}
      style={{
        ["--panel-fg" as any]: "var(--border-strong)",
        ["--panel-hover-fg" as any]: color,
        fontSize: Math.round(gitFontSize), fontWeight: 700, padding: "0 3px", lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

/* ---- Diff View ---- */

function DiffView({ diff, gitFontSize }: { diff: GitDiffResponse; gitFontSize: number }) {
  if (diff.is_binary) {
    return <div style={{ padding: 12, color: "var(--text-muted)", fontSize: Math.round(gitFontSize * 0.92), textAlign: "center" }}>Binary file changed</div>;
  }
  if (diff.hunks.length === 0) {
    return <div style={{ padding: 12, color: "var(--text-muted)", fontSize: Math.round(gitFontSize * 0.92), textAlign: "center" }}>No diff available</div>;
  }
  return (
    <div style={{ fontSize: Math.round(gitFontSize * 0.92), fontFamily: "'Cascadia Code', 'Consolas', monospace", overflowX: "auto" }}>
      {diff.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div style={{ padding: "2px 8px", color: "var(--accent)", background: "var(--accent-soft)", fontSize: Math.round(gitFontSize * 0.85), whiteSpace: "pre" }}>
            {hunk.header}
          </div>
          {/* Lines */}
          {hunk.lines.map((line, li) => {
            const isAdd = line.type === "+";
            const isDel = line.type === "-";
            return (
              <div
                key={li}
                style={{
                  display: "flex", whiteSpace: "pre",
                  background: isAdd ? "var(--success-soft)" : isDel ? "var(--danger-soft)" : "transparent",
                  color: isAdd ? "var(--success)" : isDel ? "var(--danger)" : "var(--text-primary)",
                  minHeight: Math.round(gitFontSize * 1.5), lineHeight: `${Math.round(gitFontSize * 1.5)}px`,
                }}
              >
                <span style={{ width: 36, flexShrink: 0, textAlign: "right", paddingRight: 4, color: "var(--text-muted)", userSelect: "none", fontSize: Math.round(gitFontSize * 0.85) }}>
                  {line.old_no ?? ""}
                </span>
                <span style={{ width: 36, flexShrink: 0, textAlign: "right", paddingRight: 4, color: "var(--text-muted)", userSelect: "none", fontSize: Math.round(gitFontSize * 0.85) }}>
                  {line.new_no ?? ""}
                </span>
                <span style={{ width: 14, flexShrink: 0, textAlign: "center", userSelect: "none" }}>
                  {line.type === " " ? "" : line.type}
                </span>
                <span style={{ flex: 1, paddingRight: 8 }}>{line.content}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---- Icons ---- */

function RefreshIcon({ size = 12, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: "spin 1s linear infinite" } : undefined}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <path d="M1.5 2v3h3" />
      <path d="M2.1 7.5a4 4 0 1 0 .6-4.2L1.5 5" />
    </svg>
  );
}

function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}

function BranchIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="3" cy="9" r="1.5" />
      <circle cx="9" cy="3" r="1.5" />
      <line x1="3" y1="4.5" x2="3" y2="7.5" />
      <path d="M3 4.5c0 2 2 2 6 -0.5" />
    </svg>
  );
}

export function GitIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="2.5" r="1.5" />
      <circle cx="3" cy="9.5" r="1.5" />
      <circle cx="9" cy="5" r="1.5" />
      <line x1="3" y1="4" x2="3" y2="8" />
      <path d="M3 4c0 3 3 2.5 6 1" />
    </svg>
  );
}

function StashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="3" rx="0.5" />
      <rect x="3" y="6" width="6" height="2" rx="0.5" opacity="0.6" />
      <rect x="4" y="9" width="4" height="1.5" rx="0.5" opacity="0.3" />
    </svg>
  );
}

