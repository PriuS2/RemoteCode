import { useState, FormEvent } from "react";
import FolderBrowser from "./FolderBrowser";

interface NewSessionProps {
  token: string;
  onCreated: (sessionId: string) => void;
  onCancel: () => void;
}

export default function NewSession({ token, onCreated, onCancel }: NewSessionProps) {
  const [workPath, setWorkPath] = useState("");
  const [name, setName] = useState("");
  const [createFolder, setCreateFolder] = useState(false);
  const [cliType, setCliType] = useState<"claude" | "opencode" | "terminal" | "custom">("claude");
  const [customCommand, setCustomCommand] = useState("");
  const [customExitCommand, setCustomExitCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workPath.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          work_path: workPath.trim(),
          name: name.trim() || null,
          create_folder: createFolder,
          cli_type: cliType,
          custom_command: cliType === "custom" ? customCommand.trim() || null : null,
          custom_exit_command: cliType === "custom" ? customExitCommand.trim() || null : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to create session");
      }

      const data = await res.json();
      onCreated(data.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: 12,
        }}
        onClick={onCancel}
      >
        <div
          style={{
            background: "#1e1e2e",
            border: "1px solid #313244",
            borderRadius: 12,
            padding: 24,
            width: 420,
            maxWidth: "100%",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            style={{
              margin: "0 0 20px 0",
              fontSize: 18,
              color: "#cdd6f4",
              fontWeight: 600,
            }}
          >
            New Session
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label
                style={{ display: "block", fontSize: 12, color: "#a6adc8", marginBottom: 4 }}
              >
                Work Path *
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={workPath}
                  onChange={(e) => setWorkPath(e.target.value)}
                  placeholder="C:\Users\..."
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#313244",
                    color: "#cdd6f4",
                    border: "1px solid #45475a",
                    borderRadius: 6,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowBrowser(true)}
                  title="Browse folders"
                  style={{
                    padding: "0 12px",
                    background: "#313244",
                    color: "#a6adc8",
                    border: "1px solid #45475a",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 14,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 2H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
                      fill="#a6adc8"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: 12, color: "#a6adc8", marginBottom: 4 }}
              >
                Session Name (optional)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Folder name will be used if empty"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  background: "#313244",
                  color: "#cdd6f4",
                  border: "1px solid #45475a",
                  borderRadius: 6,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "#a6adc8",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={createFolder}
                onChange={(e) => setCreateFolder(e.target.checked)}
                style={{ accentColor: "#89b4fa" }}
              />
              Create folder if it doesn't exist
            </label>

            <div style={{ marginTop: 4 }}>
              <label
                style={{ display: "block", fontSize: 12, color: "#a6adc8", marginBottom: 6 }}
              >
                CLI Type
              </label>
              <div style={{ display: "flex", gap: 16 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: "#cdd6f4",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="cliType"
                    value="claude"
                    checked={cliType === "claude"}
                    onChange={(e) => setCliType(e.target.value as "claude" | "opencode" | "terminal" | "custom")}
                    style={{ accentColor: "#89b4fa" }}
                  />
                  Claude Code
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: "#cdd6f4",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="cliType"
                    value="opencode"
                    checked={cliType === "opencode"}
                    onChange={(e) => setCliType(e.target.value as "claude" | "opencode" | "terminal" | "custom")}
                    style={{ accentColor: "#89b4fa" }}
                  />
                  OpenCode
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: "#cdd6f4",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="cliType"
                    value="terminal"
                    checked={cliType === "terminal"}
                    onChange={(e) => setCliType(e.target.value as "claude" | "opencode" | "terminal" | "custom")}
                    style={{ accentColor: "#89b4fa" }}
                  />
                  Terminal
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: "#cdd6f4",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="cliType"
                    value="custom"
                    checked={cliType === "custom"}
                    onChange={(e) => setCliType(e.target.value as "claude" | "opencode" | "terminal" | "custom")}
                    style={{ accentColor: "#89b4fa" }}
                  />
                  Custom CLI
                </label>
              </div>
            </div>

            {cliType === "custom" && (
              <>
                <div>
                  <label
                    style={{ display: "block", fontSize: 12, color: "#a6adc8", marginBottom: 4 }}
                  >
                    실행 명령어 *
                  </label>
                  <input
                    type="text"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    placeholder="예: mycli --interactive"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 14,
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 6,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{ display: "block", fontSize: 12, color: "#a6adc8", marginBottom: 4 }}
                  >
                    종료 명령어 (선택사항)
                  </label>
                  <input
                    type="text"
                    value={customExitCommand}
                    onChange={(e) => setCustomExitCommand(e.target.value)}
                    placeholder="예: /quit, exit (비워두면 /exit 사용)"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 14,
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 6,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            )}

            {error && (
              <p style={{ color: "#f38ba8", fontSize: 13, margin: 0 }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: "8px 16px",
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
                type="submit"
                disabled={loading || !workPath.trim()}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#89b4fa",
                  color: "#1e1e2e",
                  border: "none",
                  borderRadius: 6,
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading || !workPath.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showBrowser && (
        <FolderBrowser
          token={token}
          initialPath={workPath || ""}
          onSelect={(path) => {
            setWorkPath(path);
            setShowBrowser(false);
          }}
          onCancel={() => setShowBrowser(false)}
        />
      )}
    </>
  );
}
