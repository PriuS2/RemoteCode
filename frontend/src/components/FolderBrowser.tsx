import { useState, useEffect, useRef } from "react";

interface FolderBrowserProps {
  token: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

interface UserFolder {
  label: string;
  path: string;
}

interface BrowseData {
  current: string;
  parent: string | null;
  folders: string[];
  drives: string[] | null;
  user_folders: UserFolder[] | null;
}

const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 2H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
      fill="#89b4fa"
      opacity="0.8"
    />
  </svg>
);

const IconUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path d="M8 3L3 8h3v5h4V8h3L8 3z" fill="#f9e2af" />
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default function FolderBrowser({
  token,
  initialPath,
  onSelect,
  onCancel,
}: FolderBrowserProps) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [editingPath, setEditingPath] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  const browse = async (path: string) => {
    setLoading(true);
    setError(null);
    setCreating(false);
    setNewName("");
    setCreateError(null);
    try {
      const res = await fetch(
        `/api/browse?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to browse");
      }
      const result = await res.json();
      setData(result);
      setPathInput(result.current);
      setEditingPath(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !data) return;

    setCreateError(null);
    try {
      const res = await fetch("/api/mkdir", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: data.current, name }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to create folder");
      }
      const result = await res.json();
      // Refresh and navigate into the new folder
      browse(result.path);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  useEffect(() => {
    browse(initialPath || "");
  }, []);

  useEffect(() => {
    if (creating && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [creating]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 12,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#1e1e2e",
          border: "1px solid #313244",
          borderRadius: 12,
          width: 520,
          maxWidth: "100%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #313244" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#cdd6f4" }}>
              Select Folder
            </div>
            <button
              onClick={() => {
                setCreating(!creating);
                setNewName("");
                setCreateError(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                background: creating ? "#45475a" : "#313244",
                color: creating ? "#cdd6f4" : "#a6e3a1",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              <IconPlus />
              New Folder
            </button>
          </div>
          {data && !editingPath && (
            <div
              onClick={() => {
                setEditingPath(true);
                setPathInput(data.current);
                setTimeout(() => pathInputRef.current?.focus(), 0);
              }}
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: "#313244",
                borderRadius: 6,
                fontSize: 12,
                color: "#89b4fa",
                fontFamily: "'Cascadia Code', 'Consolas', monospace",
                wordBreak: "break-all",
                lineHeight: 1.4,
                cursor: "text",
              }}
              title="Click to edit path"
            >
              {data.current}
            </div>
          )}
          {editingPath && (
            <input
              ref={pathInputRef}
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pathInput.trim()) browse(pathInput.trim());
                if (e.key === "Escape") setEditingPath(false);
              }}
              onBlur={() => {
                if (pathInput.trim() && pathInput.trim() !== data?.current) {
                  browse(pathInput.trim());
                } else {
                  setEditingPath(false);
                }
              }}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "6px 10px",
                background: "#313244",
                border: "1px solid #89b4fa",
                borderRadius: 6,
                fontSize: 12,
                color: "#89b4fa",
                fontFamily: "'Cascadia Code', 'Consolas', monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>

        {/* New folder input */}
        {creating && (
          <div style={{ padding: "10px 16px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={newInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Folder name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "8px 10px",
                  fontSize: 13,
                  background: "#313244",
                  color: "#cdd6f4",
                  border: "1px solid #45475a",
                  borderRadius: 6,
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#a6e3a1",
                  color: "#1e1e2e",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  opacity: newName.trim() ? 1 : 0.4,
                  flexShrink: 0,
                }}
              >
                Create
              </button>
            </div>
            {createError && (
              <div style={{ color: "#f38ba8", fontSize: 12, marginTop: 4 }}>{createError}</div>
            )}
          </div>
        )}

        {/* Drives */}
        {data?.drives && data.drives.length > 0 && (
          <div
            style={{
              padding: "8px 16px 0",
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {data.drives.map((drive) => {
              const active = data.current.toUpperCase().startsWith(drive.charAt(0));
              return (
                <button
                  key={drive}
                  onClick={() => browse(drive)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: active ? "#89b4fa" : "#313244",
                    color: active ? "#1e1e2e" : "#a6adc8",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  {drive.replace("\\", "")}
                </button>
              );
            })}
          </div>
        )}

        {/* User folder presets */}
        {data?.user_folders && data.user_folders.length > 0 && (
          <div
            style={{
              padding: "6px 16px 0",
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {data.user_folders.map((uf) => {
              const active = data.current.toLowerCase() === uf.path.toLowerCase();
              return (
                <button
                  key={uf.path}
                  onClick={() => browse(uf.path)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: active ? "#f9e2af" : "#313244",
                    color: active ? "#1e1e2e" : "#a6adc8",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  {uf.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Folder list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "6px 8px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {loading && (
            <div style={{ padding: 20, textAlign: "center", color: "#6c7086" }}>
              Loading...
            </div>
          )}

          {error && (
            <div style={{ padding: 12, color: "#f38ba8", fontSize: 13 }}>{error}</div>
          )}

          {!loading && data && (
            <>
              {data.parent !== null && (
                <FolderRow icon={<IconUp />} name=".." onClick={() => browse(data.parent!)} />
              )}
              {data.folders.length === 0 && !data.parent && (
                <div style={{ padding: 20, color: "#6c7086", fontSize: 13, textAlign: "center" }}>
                  Empty
                </div>
              )}
              {data.folders.map((name) => (
                <FolderRow
                  key={name}
                  icon={<IconFolder />}
                  name={name}
                  onClick={() => {
                    const sep = data.current.endsWith("\\") ? "" : "\\";
                    browse(data.current + sep + name);
                  }}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #313244",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              background: "transparent",
              color: "#a6adc8",
              border: "1px solid #45475a",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => data && onSelect(data.current)}
            disabled={!data}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "#89b4fa",
              color: "#1e1e2e",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  icon,
  name,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 10px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: "#cdd6f4",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#313244";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {icon}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </div>
  );
}
