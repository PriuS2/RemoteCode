import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWebSocket, getWsUrl } from "../hooks/useWebSocket";
import MobileKeyBar from "./MobileKeyBar";
import FileExplorer from "./FileExplorer";
import GitPanel, { GitIcon } from "./GitPanel";

type MouseEventType = "press" | "release" | "move" | "drag" | "scroll";
type MouseButton = 0 | 1 | 2 | 64 | 65;

interface MouseEventData {
  event: MouseEventType;
  button: MouseButton;
  x: number;
  y: number;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
  };
}

export type ActivityState = "idle" | "processing" | "done";

interface TerminalProps {
  sessionId: string;
  token: string;
  visible?: boolean;
  fontSize?: number;
  onFontSizeChange?: (delta: number) => void;
  onActivityChange?: (sessionId: string, state: ActivityState) => void;
  panelIndex: number;
  splitMode: boolean;
  splitRatio?: number;
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
  onFontSizeChange,
  onActivityChange,
  panelIndex,
  splitMode,
  splitRatio = 0.5,
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
  const mouseDownButtonsRef = useRef(0);
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const sendResizeRef = useRef<((cols: number, rows: number) => void) | null>(null);
  const sendMouseRef = useRef<((data: MouseEventData) => void) | null>(null);
  const onActivityChangeRef = useRef(onActivityChange);
  onActivityChangeRef.current = onActivityChange;

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const stored = localStorage.getItem("explorerWidth");
    return stored ? Number(stored) : 240;
  });
  const [gitPanelWidth, setGitPanelWidth] = useState(() => {
    const stored = localStorage.getItem("gitPanelWidth");
    return stored ? Number(stored) : 300;
  });
  const explorerDragRef = useRef(false);
  const gitPanelDragRef = useRef(false);
  const isMobileDevice = () => window.innerWidth <= 768;
  const isMobile = isMobileDevice;
  const [scrollThumb, setScrollThumb] = useState<{ top: number; height: number } | null>(null);
  const [scrollbarActive, setScrollbarActive] = useState(false);

  const wsUrl = sessionId ? getWsUrl(sessionId, token) : null;

  const { sendInput, sendResize, sendMouse, status } = useWebSocket({
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

    // Enable mouse events - SGR mode (1006)
    term.element?.classList.add("xterm-enable-mouse");

    term.open(innerRef.current);
    fitAddon.fit();

    // Enable SGR mouse tracking mode (1006)
    // This tells xterm.js to send mouse events via escape sequences
    term.write("\x1b[?1006h");

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
    sendMouseRef.current = sendMouse;

    term.onData((data) => {
      const sendInput = sendInputRef.current;
      const sendMouse = sendMouseRef.current;
      
      if (!sendInput || !sendMouse) return;

      // Check for mouse escape sequences (SGR 1006 mode)
      if (data.startsWith("\x1b[") && data.includes("M")) {
        // Parse SGR mouse sequence: ESC [ < Pb ; Px ; Py M
        // Or extended: ESC [ < Pb ; Px ; Px ; Py ; Py T (for 1006)
        const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([MTm])/);
        if (match) {
          const button = parseInt(match[1], 10);
          const x = parseInt(match[2], 10);
          const y = parseInt(match[3], 10);
          const type = match[4];

          let eventType: MouseEventType;
          let actualButton: MouseButton;

          // Button encoding in SGR mode:
          // 0 = left button, 1 = middle, 2 = right
          // 32 = motion flag added
          // 64 = scroll up, 65 = scroll down
          const isMotion = (button & 32) !== 0;
          const buttonNum = button & 3;

          if (button === 64 || button === 65) {
            // Scroll events
            eventType = "scroll";
            actualButton = button as MouseButton;
          } else if (type === "M") {
            // Press (button down)
            if (isMotion) {
              eventType = mouseDownButtonsRef.current > 0 ? "drag" : "move";
            } else {
              eventType = "press";
              mouseDownButtonsRef.current = buttonNum + 1;
            }
            actualButton = buttonNum as MouseButton;
          } else if (type === "m") {
            // Release (button up)
            eventType = "release";
            actualButton = buttonNum as MouseButton;
            mouseDownButtonsRef.current = 0;
          } else {
            return; // Not a mouse event we recognize
          }

          sendMouse({
            event: eventType,
            button: actualButton,
            x: x - 1, // Convert to 0-indexed
            y: y - 1,
            modifiers: {
              shift: false,
              ctrl: false,
              alt: false,
            },
          });
          return;
        }
      }

      // Regular keyboard input
      sendInput(data);
      // Detect Enter key
      if (data.includes("\r") || data.includes("\n")) {
        enterTimeRef.current = Date.now();
      }
    });

    term.onResize(({ cols, rows }) => {
      sendResizeRef.current?.(cols, rows);
    });

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          // termRef.current?.scrollToBottom();
        } catch {
          // ignore
        }
      }
    });
    observer.observe(innerRef.current);

    // Mobile touch scroll — immediately block xterm, handle scroll ourselves
    const container = innerRef.current;
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
    const xtermScreen = container.querySelector(".xterm-screen") as HTMLElement | null;
    const SCROLLBAR_ZONE = 20; // px from right edge — scrollbar touch zone
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let didScroll = false;
    let onScrollbar = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastY = startY;
      didScroll = false;

      // Check if touch is on the scrollbar area (right edge)
      const rect = container.getBoundingClientRect();
      onScrollbar = (startX >= rect.right - SCROLLBAR_ZONE);
      if (onScrollbar) setScrollbarActive(true);

      // Block xterm immediately so it never interferes
      if (xtermScreen) xtermScreen.style.pointerEvents = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !viewport) return;
      const curY = e.touches[0].clientY;

      if (onScrollbar) {
        // Scrollbar drag: map touch Y position to scroll position
        e.preventDefault();
        const vpRect = viewport.getBoundingClientRect();
        const ratio = (curY - vpRect.top) / vpRect.height;
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        viewport.scrollTop = Math.max(0, Math.min(ratio * maxScroll, maxScroll));
        didScroll = true;
        return;
      }

      // Start scrolling after 5px vertical movement
      if (!didScroll) {
        const dy = Math.abs(curY - startY);
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dy > 5 && dy > dx) {
          didScroll = true;
        } else {
          return;
        }
      }

      e.preventDefault();
      viewport.scrollTop += (lastY - curY);
      lastY = curY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Restore xterm pointer events
      if (xtermScreen) xtermScreen.style.pointerEvents = "";

      if (onScrollbar) { onScrollbar = false; setScrollbarActive(false); return; }

      // If it was a tap (no scroll), forward click to xterm
      if (!didScroll && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && container.contains(el)) {
          el.dispatchEvent(new MouseEvent("mousedown", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
          el.dispatchEvent(new MouseEvent("mouseup", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
          el.dispatchEvent(new MouseEvent("click", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
        }
      }
    };

    container.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
      container.removeEventListener("touchend", onTouchEnd, { capture: true });
      container.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [sendInput, sendResize, sendMouse]);

  // fontSize change -> update terminal
  useEffect(() => {
    if (termRef.current && fitAddonRef.current) {
      termRef.current.options.fontSize = fontSize;
      try {
        fitAddonRef.current.fit();
        // termRef.current.scrollToBottom();
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
            // termRef.current?.scrollToBottom();
          } catch {
            // ignore
          }
        });
      });
      return () => { cancelled = true; };
    }
  }, [visible, splitMode, splitRatio, panelIndex, explorerOpen, explorerWidth, gitPanelOpen, gitPanelWidth]);

  // Mobile custom scrollbar — track viewport scroll position
  useEffect(() => {
    if (!isMobileDevice()) return;
    const container = innerRef.current;
    if (!container) return;
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
    if (!viewport) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      if (scrollHeight <= clientHeight) { setScrollThumb(null); return; }
      const ratio = clientHeight / scrollHeight;
      const thumbH = Math.max(ratio * clientHeight, 30);
      const trackSpace = clientHeight - thumbH;
      const scrollRatio = scrollTop / (scrollHeight - clientHeight);
      setScrollThumb({ top: scrollRatio * trackSpace, height: thumbH });
    };

    viewport.addEventListener("scroll", update, { passive: true });
    // Also update on resize / content changes
    const mo = new MutationObserver(update);
    mo.observe(viewport, { childList: true, subtree: true, characterData: true });
    update();

    return () => {
      viewport.removeEventListener("scroll", update);
      mo.disconnect();
    };
  }, [visible]);

  // Refit terminal when any panel resize drag ends
  useEffect(() => {
    const handleResizeEnd = () => {
      if (!visible || !termRef.current || !fitAddonRef.current) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
            termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1);
          } catch { /* ignore */ }
        });
      });
    };
    window.addEventListener("panel-resize-end", handleResizeEnd);
    return () => window.removeEventListener("panel-resize-end", handleResizeEnd);
  }, [visible]);

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
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.max(180, Math.min(startWidth + delta, maxWidth));
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
      window.dispatchEvent(new Event("panel-resize-end"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [explorerWidth]);

  const handleGitPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    gitPanelDragRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = gitPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!gitPanelDragRef.current) return;
      const delta = ev.clientX - startX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.max(220, Math.min(startWidth + delta, maxWidth));
      setGitPanelWidth(newWidth);
    };
    const onUp = () => {
      gitPanelDragRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setGitPanelWidth((w) => {
        localStorage.setItem("gitPanelWidth", String(w));
        return w;
      });
      window.dispatchEvent(new Event("panel-resize-end"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [gitPanelWidth]);

  const showBanner = status !== "connected";

  // Compute position style
  const positionStyle: React.CSSProperties = splitMode
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: panelIndex === 0 ? `${splitRatio * 100}%` : `${(1 - splitRatio) * 100}%`,
        left: panelIndex === 0 ? 0 : `${splitRatio * 100}%`,
        borderLeft: panelIndex === 1 ? "1px solid #313244" : undefined,
      }
    : {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      };

  const iconSize = Math.round(fontSize * 0.86);

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
          height: fontSize * 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${Math.round(fontSize * 0.7)}px`,
          fontSize: Math.round(fontSize * 0.8),
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
        <div style={{ display: "flex", gap: 2, marginLeft: 8, flexShrink: 0, alignItems: "center" }}>
          {/* Font size controls */}
          {onFontSizeChange && (
            <>
              <FontSizeBtn label="−" title="Font Size −" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(-1); }} />
              <span style={{ fontSize: Math.round(fontSize * 0.7), color: "#a6adc8", minWidth: Math.round(fontSize * 1.4), textAlign: "center", lineHeight: 1 }}>{fontSize}</span>
              <FontSizeBtn label="+" title="Font Size +" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(1); }} />
              <div style={{ width: 1, height: fontSize, background: "#45475a", margin: `0 ${Math.round(fontSize * 0.3)}px` }} />
            </>
          )}
          {/* File Explorer toggle */}
          <TitleBarBtn
            icon={<FolderIcon size={iconSize} />}
            title="File Explorer"
            hoverColor="#a6e3a1"
            active={explorerOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setExplorerOpen((o) => { if (!o) setGitPanelOpen(false); return !o; }); }}
          />
          {/* Git Panel toggle */}
          <TitleBarBtn
            icon={<GitIcon size={iconSize} />}
            title="Git"
            hoverColor="#fab387"
            active={gitPanelOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setGitPanelOpen((o) => { if (!o) setExplorerOpen(false); return !o; }); }}
          />
          {/* Refresh terminal */}
          <TitleBarBtn
            icon={<RefreshIcon size={iconSize} />}
            title="Refresh"
            hoverColor="#94e2d5"
            fontSize={fontSize}
            onClick={(e) => {
              e.stopPropagation();
              try {
                fitAddonRef.current?.fit();
                termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1);
                // termRef.current?.scrollToBottom();
              } catch { /* ignore */ }
            }}
          />
          {/* Minimize = Suspend */}
          <TitleBarBtn
            icon={<MinimizeIcon size={iconSize} />}
            title="Suspend"
            hoverColor="#f9e2af"
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); onSuspend(); }}
          />
          {/* Maximize = single mode (split only) */}
          {splitMode && (
            <TitleBarBtn
              icon={<MaximizeIcon size={iconSize} />}
              title="Maximize"
              hoverColor="#89b4fa"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            />
          )}
          {/* Close = Kill */}
          <TitleBarBtn
            icon={<CloseIcon size={iconSize} />}
            title="Kill"
            hoverColor="#f38ba8"
            fontSize={fontSize}
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
        {gitPanelOpen && (
          <div style={{ width: isMobile() ? undefined : gitPanelWidth, flexShrink: 0 }}>
            <GitPanel
              token={token}
              workPath={workPath}
              onClose={() => setGitPanelOpen(false)}
              isMobile={isMobile()}
            />
          </div>
        )}
        {gitPanelOpen && !isMobile() && (
          <div
            className="file-explorer-resize"
            onMouseDown={handleGitPanelResizeStart}
          />
        )}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div ref={innerRef} style={{ width: "100%", height: "100%" }} />
          {/* Mobile custom scrollbar */}
          {scrollThumb && isMobile() && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 18,
                height: "100%",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: scrollThumb.top,
                  right: 2,
                  width: 10,
                  height: scrollThumb.height,
                  borderRadius: 5,
                  background: scrollbarActive ? "rgba(137, 180, 250, 0.9)" : "rgba(88, 91, 112, 0.8)",
                  border: scrollbarActive ? "1px solid rgba(137, 180, 250, 0.6)" : "1px solid rgba(108, 112, 134, 0.4)",
                  transition: "background 0.15s, border 0.15s",
                }}
              />
            </div>
          )}
        </div>
      </div>
      {!splitMode && <MobileKeyBar onKey={handleKeyBarInput} />}
    </div>
  );
}

/* ---- Title bar helper components ---- */

function FontSizeBtn({ label, title, fontSize = 14, onClick }: { label: string; title: string; fontSize?: number; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "none",
        color: "#6c7086",
        cursor: "pointer",
        padding: `${Math.round(fontSize * 0.07)}px ${Math.round(fontSize * 0.2)}px`,
        borderRadius: 3,
        fontSize: Math.round(fontSize * 0.86),
        fontWeight: 700,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = "#cdd6f4";
        btn.style.background = "#45475a";
      }}
      onMouseLeave={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = "#6c7086";
        btn.style.background = "none";
      }}
    >
      {label}
    </button>
  );
}

function TitleBarBtn({
  icon,
  title,
  hoverColor,
  active,
  fontSize = 14,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hoverColor: string;
  active?: boolean;
  fontSize?: number;
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
        padding: `${Math.round(fontSize * 0.14)}px ${Math.round(fontSize * 0.29)}px`,
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

const MinimizeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="2" y1="9" x2="10" y2="9" />
  </svg>
);

const MaximizeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="8" height="8" />
  </svg>
);

const CloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
);

const RefreshIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 2v3h3" />
    <path d="M2.1 7.5a4 4 0 1 0 .6-4.2L1.5 5" />
  </svg>
);

const FolderIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 3C1 2.45 1.45 2 2 2h2.5l1 1.5H10c.55 0 1 .45 1 1V9.5c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1V3z" />
  </svg>
);
