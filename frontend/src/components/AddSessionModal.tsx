import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CliPreflightResponse } from "../types/api";
import { apiFetch, readErrorDetail } from "../utils/api";
import { getCliTone } from "../utils/cliTones";
import { uiPx } from "../utils/uiScale";

interface AddSessionModalProps {
  projectId: string;
  projectName: string;
  workPath: string;
  onCreated: (sessionId: string) => void;
  onCancel: () => void;
}

type CliType = "claude" | "kilo" | "opencode" | "terminal" | "folder" | "git" | "ide" | "custom";
const OPTION_ENABLED_CLI_TYPES: CliType[] = ["claude", "kilo", "opencode", "terminal"];
const CLAUDE_SKIP_PERMISSIONS_OPTION = "--dangerously-skip-permissions";

const CLI_OPTIONS: Array<{
  type: CliType;
  label: string;
  description: string;
}> = [
  { type: "claude", label: "Claude Code", description: "Default interactive coding CLI." },
  { type: "kilo", label: "Kilo Code", description: "Interactive Kilo CLI session." },
  { type: "opencode", label: "OpenCode", description: "Interactive OpenCode terminal session." },
  { type: "terminal", label: "Terminal", description: "Plain shell session without CLI wrapper." },
  { type: "ide", label: "IDE", description: "Monaco-based editor workspace with file editing tools." },
  { type: "folder", label: "Folder", description: "Saved file explorer session for this project." },
  { type: "git", label: "Git", description: "Saved Git panel session for this project." },
  { type: "custom", label: "Custom CLI", description: "Run your own command in the session." },
];

function badgeStyle(ok: boolean, loading: boolean): React.CSSProperties {
  if (loading) {
    return { background: "var(--info-soft)", color: "var(--info)", border: "1px solid var(--border-accent)" };
  }
  if (ok) {
    return { background: "var(--success-soft)", color: "var(--success)", border: "1px solid color-mix(in srgb, var(--success) 35%, transparent)" };
  }
  return { background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 35%, transparent)" };
}

function supportsCliOptions(cliType: CliType): boolean {
  return OPTION_ENABLED_CLI_TYPES.includes(cliType);
}

function hasOptionToken(value: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(value.trim());
}

function countOptionToken(value: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.trim().match(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"))?.length ?? 0;
}

function addOptionToken(value: string, token: string): string {
  if (hasOptionToken(value, token)) {
    return value.trim();
  }
  return `${value.trim()} ${token}`.trim();
}

function removeOptionToken(value: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCliOptionsInput(cliType: CliType, value: string): string {
  if (cliType !== "claude" || countOptionToken(value, CLAUDE_SKIP_PERMISSIONS_OPTION) <= 1) {
    return value;
  }
  return addOptionToken(removeOptionToken(value, CLAUDE_SKIP_PERMISSIONS_OPTION), CLAUDE_SKIP_PERMISSIONS_OPTION);
}

export default function AddSessionModal({
  projectId,
  projectName,
  workPath,
  onCreated,
  onCancel,
}: AddSessionModalProps) {
  const isPanelSession = (type: CliType) => type === "folder" || type === "git";
  const [name, setName] = useState("");
  const [cliType, setCliType] = useState<CliType>("claude");
  const [cliOptions, setCliOptions] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customExitCommand, setCustomExitCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [preflight, setPreflight] = useState<CliPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const isMobile = viewportWidth <= 768;
  const isNarrow = viewportWidth <= 380;
  const cliColumns = isNarrow ? 1 : isMobile ? 2 : 4;
  const optionsEnabled = supportsCliOptions(cliType);
  const selectedOption = useMemo(
    () => CLI_OPTIONS.find((option) => option.type === cliType) ?? CLI_OPTIONS[0],
    [cliType],
  );
  const normalizedCliOptions = useMemo(
    () => optionsEnabled ? cliOptions.trim() || null : null,
    [cliOptions, optionsEnabled],
  );
  const skipPermissionsEnabled = useMemo(
    () => cliType === "claude" && hasOptionToken(cliOptions, CLAUDE_SKIP_PERMISSIONS_OPTION),
    [cliOptions, cliType],
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (isPanelSession(cliType)) {
      setPreflight({
        ok: true,
        code: "ok",
        message: cliType === "folder" ? "Folder session is ready." : "Git session is ready.",
        resolved_command: null,
      });
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
            work_path: workPath,
            create_folder: false,
            cli_type: cliType,
            cli_options: normalizedCliOptions,
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
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cliType, customCommand, normalizedCliOptions, workPath]);

  const preflightSummary = useMemo(() => {
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
  }, [preflight, preflightLoading]);

  const hasBlockingPreflight = Boolean(
    preflight
    && !preflight.ok
    && ["directory_not_found", "custom_command_missing", "invalid_command", "cli_not_found", "permission_denied"].includes(preflight.code),
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (hasBlockingPreflight) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim() || null,
          cli_type: cliType,
          cli_options: normalizedCliOptions,
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
    <div
      className="sheet-overlay"
      style={{
        alignItems: isMobile ? "flex-end" : "center",
        padding: isMobile ? 0 : 16,
      }}
      onClick={onCancel}
    >
      <div
        className={`sheet-panel${isMobile ? " is-mobile" : ""}`}
        data-testid="add-session-modal"
        style={{
          maxWidth: isMobile ? "100%" : 620,
          maxHeight: isMobile ? "calc(100vh - 24px)" : "min(90vh, 760px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2 className="sheet-title" style={{ fontSize: uiPx(20) }}>Add Session</h2>
          <p className="sheet-copy" style={{ fontSize: uiPx(13) }}>
            Create a session inside <strong style={{ color: "var(--text-primary)" }}>{projectName}</strong>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="sheet-form">
          <div className="sheet-body">
            <div className="sheet-field">
              <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                Project Path
              </label>
              <input
                type="text"
                value={workPath}
                readOnly
                className="ui-input ui-input--readonly"
                style={{ width: "100%", fontSize: uiPx(14) }}
              />
            </div>

            <div className="sheet-field">
              <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                Session Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="A default name will be used if left empty"
                autoFocus
                data-testid="add-session-name"
                className="ui-input"
                style={{ width: "100%", fontSize: uiPx(14) }}
              />
            </div>

            <div className="sheet-field">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <label className="sheet-label" style={{ fontSize: uiPx(12), marginBottom: 0 }}>CLI Type</label>
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
                  gap: 8,
                }}
              >
                {CLI_OPTIONS.map((option) => {
                  const active = cliType === option.type;
                  const tone = getCliTone(option.type);
                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => setCliType(option.type)}
                      aria-pressed={active}
                      data-testid={`cli-option-${option.type}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        width: "100%",
                        minWidth: 0,
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: active ? `1px solid ${tone.border}` : "1px solid var(--input-border)",
                        background: active ? tone.soft : "var(--surface-2)",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        minHeight: 58,
                        transition: "border-color 0.18s ease, background 0.18s ease, transform 0.18s ease",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: active ? tone.hover : "var(--text-muted)",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          minWidth: 0,
                          fontSize: uiPx(13),
                          fontWeight: 700,
                          lineHeight: 1.3,
                          color: active ? tone.hover : "var(--text-primary)",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="ui-note" style={{ marginTop: 10 }}>
                <div style={{ fontSize: uiPx(12), color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {selectedOption.description}
                </div>
                {normalizedCliOptions && (
                  <div style={{ marginTop: 6, fontSize: uiPx(11), color: "var(--text-muted)", fontFamily: "'Cascadia Code', 'Consolas', monospace" }}>
                    Options: {normalizedCliOptions}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: uiPx(12), color: preflightSummary.ok ? "var(--success)" : preflightSummary.loading ? "var(--info)" : "var(--warn)", fontWeight: 600 }}>
                  {preflightSummary.title}
                </div>
                {preflightSummary.detail && (
                  <div style={{ marginTop: 4, fontSize: uiPx(11), color: "var(--text-muted)", fontFamily: "'Cascadia Code', 'Consolas', monospace" }}>
                    {preflightSummary.detail}
                  </div>
                )}
              </div>
            </div>

            {cliType === "custom" && (
              <>
                <div className="sheet-field">
                  <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                    Command *
                  </label>
                  <input
                    type="text"
                    value={customCommand}
                    onChange={(e) => setCustomCommand(e.target.value)}
                    placeholder="Example: mycli --interactive"
                    className="ui-input"
                    style={{ width: "100%", fontSize: uiPx(14) }}
                  />
                </div>
                <div className="sheet-field">
                  <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                    Exit Command
                  </label>
                  <input
                    type="text"
                    value={customExitCommand}
                    onChange={(e) => setCustomExitCommand(e.target.value)}
                    placeholder="Example: exit, /quit"
                    className="ui-input"
                    style={{ width: "100%", fontSize: uiPx(14) }}
                  />
                </div>
              </>
            )}

            {optionsEnabled && (
              <>
                <div className="sheet-field">
                  <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                    Options
                  </label>
                  <input
                    type="text"
                    value={cliOptions}
                    onChange={(e) => setCliOptions(normalizeCliOptionsInput(cliType, e.target.value))}
                    placeholder="Example: --verbose --model sonnet"
                    data-testid="add-session-options"
                    className="ui-input"
                    style={{ width: "100%", fontSize: uiPx(14) }}
                  />
                </div>

                {cliType === "claude" && (
                  <label className="sheet-checkbox" style={{ fontSize: uiPx(13) }}>
                    <input
                      type="checkbox"
                      checked={skipPermissionsEnabled}
                      onChange={(e) => {
                        setCliOptions((current) => (
                          e.target.checked
                            ? addOptionToken(current, CLAUDE_SKIP_PERMISSIONS_OPTION)
                            : removeOptionToken(current, CLAUDE_SKIP_PERMISSIONS_OPTION)
                        ));
                      }}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    claude {CLAUDE_SKIP_PERMISSIONS_OPTION} (Skip permissions)
                  </label>
                )}
              </>
            )}

            {error && <div className="ui-error ui-error--block" style={{ fontSize: uiPx(13) }}>{error}</div>}
          </div>

          <div
            className="sheet-footer"
            style={{
              position: isMobile ? "sticky" : "static",
              bottom: 0,
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="secondary-button"
              style={{ padding: "10px 16px", fontSize: uiPx(13) }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || hasBlockingPreflight}
              className="primary-button"
              data-testid="add-session-submit"
              style={{ padding: "10px 16px", fontSize: uiPx(13), opacity: loading || hasBlockingPreflight ? 0.5 : 1 }}
            >
              {loading ? "Creating..." : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
