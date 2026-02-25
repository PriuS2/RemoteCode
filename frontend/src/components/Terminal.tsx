import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWebSocket, getWsUrl } from "../hooks/useWebSocket";
import MobileKeyBar from "./MobileKeyBar";
import FileExplorer from "./FileExplorer";

export type ActivityState = "idle" | "processing" | "done";

interface TerminalProps {
  sessionId: string;
  token: string;
  visible?: boolean;
  fontSize?: number;
  onActivityChange?: (sessionId: string, state: ActivityState) => void;
  panelIndex: number;
  splitMode: boolean;
  isFocused: boolean;
  onFocus: () => void;
  sessionName: string;
  workPath: string;
  onClosePanel: () => void;
  onSuspend: () => void;
  onMaximize: () => void;
  onTerminate: () => void;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  connecting: {
    background: "#f9e2af",
    color: "#1e1e2e",
  },
  disconnected: {
    background: "#f38ba8",
    color: "#1e1e2e",
  },
};

export default function Terminal({
  sessionId,
  token,
  visible = true,
  fontSize = 14,
  onActivityChange,
  panelIndex,
  splitMode,
  isFocused,
  onFocus,
  sessionName,
  workPath,
  onClosePanel,
  onSuspend,
  onMaximize,
  onTerminate,
}: TerminalProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const enterTimeRef = useRef(0);
  const onActivityChangeRef = useRef(onActivityChange);
  onActivityChangeRef.current = onActivityChange;

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const stored = localStorage.getItem("explorerWidth");
    return stored ? Number(stored) : 240;
  });
  const explorerDragRef = useRef(false);
  const isMobile = () => window.innerWidth <= 768;

  const wsUrl = sessionId ? getWsUrl(sessionId, token) : null;

  const { sendInput, sendResize, status } = useWebSocket({
    url: wsUrl,
    onMessage: (msg) => {
      if (msg.type === "output" && termRef.current) {
        termRef.current.write(msg.data);

        // Only track activity after user pressed Enter
        if (enterTimeRef.current > 0) {
          const elapsed = Date.now() - enterTimeRef.current;

          // Wait 500ms after Enter to skip echo, then mark processing
          if (elapsed > 500 && !isProcessingRef.current) {
            isProcessingRef.current = true;
            onActivityChangeRef.current?.(sessionId, "processing");
          }

          // Reset done-timer on every output chunk
          if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
          activityTimerRef.current = setTimeout(() => {
            if (isProcessingRef.current) {
              onActivityChangeRef.current?.(sessionId, "done");
            }
            isProcessingRef.current = false;
            enterTimeRef.current = 0;
          }, 3000);
        }
      } else if (msg.type === "status" && msg.data === "closed") {
        termRef.current?.write("\r\n\x1b[31m[Session closed]\x1b[0m\r\n");
      }
    },
    autoReconnect: true,
  });

  useEffect(() => {
    if (!innerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b70",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(innerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      sendInput(data);
      // Detect Enter key
      if (data.includes("\r") || data.includes("\n")) {
        enterTimeRef.current = Date.now();
      }
    });

    term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }
    });
    observer.observe(innerRef.current);

    return () => {
      observer.disconnect();
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [sendInput, sendResize]);

  // fontSize change -> update terminal
  useEffect(() => {
    if (termRef.current && fitAddonRef.current) {
      termRef.current.options.fontSize = fontSize;
      try {
        fitAddonRef.current.fit();
      } catch {
        // ignore
      }
    }
  }, [fontSize]);

  // visible / splitMode / panelIndex / explorerOpen -> refit + refresh
  useEffect(() => {
    if (visible && termRef.current && fitAddonRef.current) {
      // Double-rAF: wait for browser to fully compute layout after DOM change
      let cancelled = false;
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          try {
            fitAddonRef.current?.fit();
            termRef.current?.refresh(0, termRef.current.rows - 1);
          } catch {
            // ignore
          }
        });
      });
      return () => { cancelled = true; };
    }
  }, [visible, splitMode, panelIndex, explorerOpen, explorerWidth]);

  // Focus management
  useEffect(() => {
    if (visible && isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [visible, isFocused]);

  const handleKeyBarInput = useCallback(
    (data: string) => {
      sendInput(data);
      // Detect Enter key from key bar
      if (data.includes("\r") || data.includes("\n")) {
        enterTimeRef.current = Date.now();
      }
      // Refocus terminal
      termRef.current?.focus();
    },
    [sendInput],
  );

  const handleInsertPath = useCallback(
    (text: string) => {
      sendInput(text);
      termRef.current?.focus();
    },
    [sendInput],
  );

  const handleExplorerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    explorerDragRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = explorerWidth;

    const onMove = (ev: MouseEvent) => {
      if (!explorerDragRef.current) return;
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(startWidth + delta, 400));
      setExplorerWidth(newWidth);
    };
    const onUp = () => {
      explorerDragRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setExplorerWidth((w) => {
        localStorage.setItem("explorerWidth", String(w));
        return w;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [explorerWidth]);

  const showBanner = status !== "connected";

  // Compute position style
  const positionStyle: React.CSSProperties = splitMode
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: "50%",
        left: panelIndex === 0 ? 0 : "50%",
        borderLeft: panelIndex === 1 ? "1px solid #313244" : undefined,
      }
    : {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      };

  return (
    <div
      style={{
        ...positionStyle,
        display: visible ? "flex" : "none",
        flexDirection: "column",
      }}
      onMouseDown={onFocus}
    >
      {/* Terminal title bar */}
      <div
        style={{
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          fontSize: 11,
          fontWeight: 600,
          color: "#cdd6f4",
          background: splitMode
            ? (isFocused ? "#313244" : "#1e1e2e")
            : "#181825",
          borderBottom: splitMode
            ? `2px solid ${isFocused ? "#89b4fa" : "#313244"}`
            : "1px solid #313244",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {sessionName}
        </span>
        <div style={{ display: "flex", gap: 2, marginLeft: 8, flexShrink: 0 }}>
          {/* File Explorer toggle */}
          <TitleBarBtn
            icon={<FolderIcon />}
            title="File Explorer"
            hoverColor="#a6e3a1"
            active={explorerOpen}
            onClick={(e) => { e.stopPropagation(); setExplorerOpen((o) => !o); }}
          />
          {/* Minimize = Suspend */}
          <TitleBarBtn
            icon={<MinimizeIcon />}
            title="Suspend"
            hoverColor="#f9e2af"
            onClick={(e) => { e.stopPropagation(); onSuspend(); }}
          />
          {/* Maximize = single mode (split only) */}
          {splitMode && (
            <TitleBarBtn
              icon={<MaximizeIcon />}
              title="Maximize"
              hoverColor="#89b4fa"
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            />
          )}
          {/* Close = Kill */}
          <TitleBarBtn
            icon={<CloseIcon />}
            title="Kill"
            hoverColor="#f38ba8"
            onClick={(e) => { e.stopPropagation(); onTerminate(); }}
          />
        </div>
      </div>

      {showBanner && (
        <div
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            ...(STATUS_STYLE[status] || {}),
          }}
        >
          {status === "connecting" && "Connecting..."}
          {status === "disconnected" && "Disconnected - Reconnecting..."}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {explorerOpen && (
          <div style={{ width: isMobile() ? undefined : explorerWidth, flexShrink: 0 }}>
            <FileExplorer
              token={token}
              rootPath={workPath}
              onInsertPath={handleInsertPath}
              onClose={() => setExplorerOpen(false)}
              isMobile={isMobile()}
            />
          </div>
        )}
        {explorerOpen && !isMobile() && (
          <div
            className="file-explorer-resize"
            onMouseDown={handleExplorerResizeStart}
          />
        )}
        <div ref={innerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>
      {!splitMode && <MobileKeyBar onKey={handleKeyBarInput} />}
    </div>
  );
}

/* ---- Title bar helper components ---- */

function TitleBarBtn({
  icon,
  title,
  hoverColor,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hoverColor: string;
  active?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? `${hoverColor}18` : "none",
        border: "none",
        color: active ? hoverColor : "#6c7086",
        cursor: "pointer",
        padding: "2px 4px",
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = hoverColor;
        btn.style.background = `${hoverColor}18`;
      }}
      onMouseLeave={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = active ? hoverColor : "#6c7086";
        btn.style.background = active ? `${hoverColor}18` : "none";
      }}
    >
      {icon}
    </button>
  );
}

const MinimizeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="2" y1="9" x2="10" y2="9" />
  </svg>
);

const MaximizeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="8" height="8" />
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
);

const FolderIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 3C1 2.45 1.45 2 2 2h2.5l1 1.5H10c.55 0 1 .45 1 1V9.5c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1V3z" />
  </svg>
);
