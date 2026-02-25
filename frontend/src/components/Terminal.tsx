import { useRef, useEffect, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWebSocket, getWsUrl } from "../hooks/useWebSocket";
import MobileKeyBar from "./MobileKeyBar";

export type ActivityState = "idle" | "processing" | "done";

interface TerminalProps {
  sessionId: string;
  token: string;
  visible?: boolean;
  fontSize?: number;
  onActivityChange?: (sessionId: string, state: ActivityState) => void;
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
}: TerminalProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const enterTimeRef = useRef(0);
  const onActivityChangeRef = useRef(onActivityChange);
  onActivityChangeRef.current = onActivityChange;

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

  // visible -> refit + refresh
  useEffect(() => {
    if (visible && termRef.current && fitAddonRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          termRef.current?.refresh(0, termRef.current.rows - 1);
        } catch {
          // ignore
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [visible]);

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

  const showBanner = status !== "connected";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: visible ? "flex" : "none",
        flexDirection: "column",
      }}
    >
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
      <div ref={innerRef} style={{ flex: 1, minHeight: 0 }} />
      <MobileKeyBar onKey={handleKeyBarInput} />
    </div>
  );
}
