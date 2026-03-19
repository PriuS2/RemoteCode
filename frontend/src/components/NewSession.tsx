import { FormEvent, useEffect, useMemo, useState } from "react";
import FolderBrowser from "./FolderBrowser";
import type { CliPreflightResponse } from "../types/api";
import { apiFetch, readErrorDetail } from "../utils/api";
import { uiPx } from "../utils/uiScale";

interface NewSessionProps {
  onCreated: (sessionId: string) => void;
  onCancel: () => void;
}

type CliType = "claude" | "opencode" | "opencode-web" | "terminal" | "custom";

const CLI_OPTIONS: Array<{
  type: CliType;
  label: string;
  description: string;
}> = [
  { type: "claude", label: "Claude Code", description: "Default interactive coding CLI." },
  { type: "opencode", label: "OpenCode", description: "Interactive OpenCode terminal session." },
  { type: "opencode-web", label: "OpenCode Web", description: "Browser-based OpenCode session." },
  { type: "terminal", label: "Terminal", description: "Plain shell session without CLI wrapper." },
  { type: "custom", label: "Custom CLI", description: "Run your own command in the session." },
];

function badgeStyle(ok: boolean, loading: boolean): React.CSSProperties {
  if (loading) {
    return { background: "#89b4fa22", color: "#89b4fa", border: "1px solid #89b4fa55" };
  }
  if (ok) {
    return { background: "#a6e3a122", color: "#a6e3a1", border: "1px solid #a6e3a155" };
  }
  return { background: "#f38ba822", color: "#f38ba8", border: "1px solid #f38ba855" };
}

export default function NewSession({ onCreated, onCancel }: NewSessionProps) {
  const [workPath, setWorkPath] = useState("");
  const [name, setName] = useState("");
  const [createFolder, setCreateFolder] = useState(false);
  const [cliType, setCliType] = useState<CliType>("claude");
  const [customCommand, setCustomCommand] = useState("");
  const [customExitCommand, setCustomExitCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [preflight, setPreflight] = useState<CliPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const isMobile = viewportWidth <= 768;
  const isNarrow = viewportWidth <= 380;
  const cliColumns = isNarrow ? 1 : isMobile ? 2 : CLI_OPTIONS.length;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const trimmedPath = workPath.trim();
    if (!trimmedPath) {
      setPreflight(null);
      setPreflightLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreflightLoading(true);
      try {
        const response = await apiFetch("/api/sessions/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_path: trimmedPath,
            create_folder: createFolder,
            cli_type: cliType,
            custom_command: cliType === "custom" ? customCommand.trim() || null : null,
          }),
        });
        if (!response.ok) {
          const detail = await readErrorDetail(response, "Failed to validate CLI");
          if (!cancelled) {
            setPreflight({
              ok: false,
              code: detail.code,
              message: detail.message,
              resolved_command: null,
            });
          }
          return;
        }

        const result: CliPreflightResponse = await response.json();
        if (!cancelled) {
          setPreflight(result);
        }
      } catch {
        if (!cancelled) {
          setPreflight({
            ok: false,
            code: "preflight_failed",
            message: "Unable to validate the selected CLI right now.",
            resolved_command: null,
          });
        }
      } finally {
        if (!cancelled) {
          setPreflightLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workPath, createFolder, cliType, customCommand]);

  const preflightSummary = useMemo(() => {
    if (!workPath.trim()) {
      return {
        ok: false,
        loading: false,
        title: "Select a work path to validate the session.",
        detail: null as string | null,
      };
    }

    if (preflightLoading) {
      return {
        ok: false,
        loading: true,
        title: "Validating CLI availability...",
        detail: null as string | null,
      };
    }

    if (!preflight) {
      return {
        ok: true,
        loading: false,
        title: "Ready to validate.",
        detail: null as string | null,
      };
    }

    return {
      ok: preflight.ok,
      loading: false,
      title: preflight.message,
      detail: preflight.resolved_command ? `Resolved command: ${preflight.resolved_command}` : null,
    };
  }, [workPath, preflightLoading, preflight]);

  const hasBlockingPreflight = Boolean(
    preflight
    && !preflight.ok
    && [
      "work_path_missing",
      "directory_not_found",
      "custom_command_missing",
      "invalid_command",
      "cli_not_found",
      "permission_denied",
    ].includes(preflight.code),
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workPath.trim() || hasBlockingPreflight) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
        const detail = await readErrorDetail(res, "Failed to create session");
        throw new Error(detail.message);
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
          background: "rgba(0, 0, 0, 0.7)",
          display: "flex",
          alignItems: isMobile ? "flex-end" : "center",
          justifyContent: "center",
          zIndex: 100,
          padding: isMobile ? 0 : 16,
        }}
        onClick={onCancel}
      >
        <div
          style={{
            background: "#1e1e2e",
            border: "1px solid #313244",
            borderRadius: isMobile ? "18px 18px 0 0" : 16,
            width: "100%",
            maxWidth: isMobile ? "100%" : 540,
            maxHeight: isMobile ? "calc(100vh - 24px)" : "min(90vh, 760px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: "20px 22px 16px", borderBottom: "1px solid #313244" }}>
            <h2
              style={{
                margin: 0,
                fontSize: uiPx(20),
                color: "#cdd6f4",
                fontWeight: 700,
              }}
            >
              New Session
            </h2>
            <p style={{ margin: "8px 0 0", fontSize: uiPx(13), color: "#a6adc8", lineHeight: 1.5 }}>
              Choose a workspace and the CLI that should power the session.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
                padding: "18px 22px 22px",
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                  Work Path *
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    value={workPath}
                    onChange={(e) => setWorkPath(e.target.value)}
                    placeholder="C:\\Users\\..."
                    autoFocus
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: "11px 12px",
                      fontSize: uiPx(14),
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 8,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowBrowser(true)}
                    title="Browse folders on the server"
                    style={{
                      padding: "0 14px",
                      minHeight: 42,
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: uiPx(13),
                      fontWeight: 600,
                    }}
                  >
                    Browse Server Folder
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                  Session Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Folder name will be used if left empty"
                  style={{
                    width: "100%",
                    padding: "11px 12px",
                    fontSize: uiPx(14),
                    background: "#313244",
                    color: "#cdd6f4",
                    border: "1px solid #45475a",
                    borderRadius: 8,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: uiPx(13),
                  color: "#cdd6f4",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={createFolder}
                  onChange={(e) => setCreateFolder(e.target.checked)}
                  style={{ accentColor: "#89b4fa" }}
                />
                Create the folder if it does not exist
              </label>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <label style={{ fontSize: uiPx(12), color: "#a6adc8" }}>CLI Type</label>
                  <span
                    style={{
                      ...badgeStyle(preflightSummary.ok, preflightSummary.loading),
                      padding: "3px 8px",
                      fontSize: uiPx(11),
                      fontWeight: 700,
                      borderRadius: 999,
                    }}
                  >
                    {preflightSummary.loading ? "VALIDATING" : preflightSummary.ok ? "READY" : "CHECK"}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${cliColumns}, minmax(0, 1fr))`,
                    gap: 10,
                  }}
                >
                  {CLI_OPTIONS.map((option) => {
                    const active = cliType === option.type;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setCliType(option.type)}
                        style={{
                          textAlign: "left",
                          padding: "12px 12px 11px",
                          borderRadius: 10,
                          border: active ? "1px solid #89b4fa" : "1px solid #45475a",
                          background: active ? "#313244" : "#242438",
                          color: "#cdd6f4",
                          cursor: "pointer",
                          minHeight: 88,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: active ? "#89b4fa" : "#6c7086",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: uiPx(13), fontWeight: 700 }}>{option.label}</span>
                        </div>
                        <div style={{ fontSize: uiPx(11), color: "#a6adc8", lineHeight: 1.45 }}>
                          {option.description}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "#181825" }}>
                  <div style={{ fontSize: uiPx(12), color: preflightSummary.ok ? "#a6e3a1" : preflightSummary.loading ? "#89b4fa" : "#f9e2af", fontWeight: 600 }}>
                    {preflightSummary.title}
                  </div>
                  {preflightSummary.detail && (
                    <div style={{ marginTop: 4, fontSize: uiPx(11), color: "#6c7086", fontFamily: "'Cascadia Code', 'Consolas', monospace" }}>
                      {preflightSummary.detail}
                    </div>
                  )}
                </div>
              </div>

              {cliType === "custom" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                      Command *
                    </label>
                    <input
                      type="text"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                      placeholder="Example: mycli --interactive"
                      style={{
                        width: "100%",
                        padding: "11px 12px",
                        fontSize: uiPx(14),
                        background: "#313244",
                        color: "#cdd6f4",
                        border: "1px solid #45475a",
                        borderRadius: 8,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                      Exit Command
                    </label>
                    <input
                      type="text"
                      value={customExitCommand}
                      onChange={(e) => setCustomExitCommand(e.target.value)}
                      placeholder="Example: exit, /quit"
                      style={{
                        width: "100%",
                        padding: "11px 12px",
                        fontSize: uiPx(14),
                        background: "#313244",
                        color: "#cdd6f4",
                        border: "1px solid #45475a",
                        borderRadius: 8,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </>
              )}

              {error && (
                <div
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    background: "#f38ba81a",
                    border: "1px solid #f38ba84a",
                    color: "#f38ba8",
                    fontSize: uiPx(13),
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "14px 22px 18px",
                borderTop: "1px solid #313244",
                background: "#1e1e2e",
                position: isMobile ? "sticky" : "static",
                bottom: 0,
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: "10px 16px",
                  fontSize: uiPx(13),
                  background: "transparent",
                  color: "#a6adc8",
                  border: "1px solid #45475a",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !workPath.trim() || hasBlockingPreflight}
                style={{
                  padding: "10px 16px",
                  fontSize: uiPx(13),
                  fontWeight: 700,
                  background: "#89b4fa",
                  color: "#1e1e2e",
                  border: "none",
                  borderRadius: 8,
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading || !workPath.trim() || hasBlockingPreflight ? 0.5 : 1,
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

