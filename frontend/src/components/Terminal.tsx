import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWebSocket, getWsUrl } from "../hooks/useWebSocket";
import MobileKeyBar from "./MobileKeyBar";
import FileExplorer from "./FileExplorer";
import GitPanel, { GitIcon } from "./GitPanel";
import { getCliTone } from "../utils/cliTones";

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
type ThemeMode = "light" | "dark";

interface TerminalProps {
  sessionId: string;
  visible?: boolean;
  fontSize?: number;
  onFontSizeChange?: (delta: number) => void;
  onActivityChange?: (sessionId: string, state: ActivityState) => void;
  refreshNonce: number;
  isFocused: boolean;
  onFocus: () => void;
  theme: ThemeMode;
  sessionName: string;
  paneLabel?: string;
  workPath: string;
  onClosePanel: () => void;
  canClosePanel?: boolean;
  canSuspend?: boolean;
  onSuspend: () => void;
  onMaximize?: () => void;
  showRestoreLayout?: boolean;
  onRestoreLayout?: () => void;
  onTerminate: () => void;
  showMobileKeyBar?: boolean;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  connecting: {
    background: "var(--terminal-status-connecting-bg)",
    color: "var(--terminal-status-connecting-text)",
  },
  reconnecting: {
    background: "var(--terminal-status-reconnecting-bg)",
    color: "var(--terminal-status-reconnecting-text)",
  },
  disconnected: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  auth_failed: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  taken_over: {
    background: "var(--terminal-status-takenover-bg)",
    color: "var(--terminal-status-takenover-text)",
  },
  not_found: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  closed: {
    background: "var(--terminal-status-closed-bg)",
    color: "var(--terminal-status-closed-text)",
  },
};

function getTerminalPalette(theme: ThemeMode) {
  if (theme === "light") {
    return {
      background: "#f5efe0",
      foreground: "#18202b",
      cursor: "#18202b",
      selectionBackground: "#d8deea",
      black: "#303845",
      red: "#b85b63",
      green: "#507c63",
      yellow: "#9b7331",
      blue: "#5175a6",
      magenta: "#8e628f",
      cyan: "#4d8280",
      white: "#d9e0eb",
      brightBlack: "#5a6678",
      brightRed: "#c36d74",
      brightGreen: "#649177",
      brightYellow: "#b58841",
      brightBlue: "#6289bb",
      brightMagenta: "#a377a5",
      brightCyan: "#5c9794",
      brightWhite: "#f5f7fb",
    };
  }

  return {
    background: "#161a21",
    foreground: "#d9e1ee",
    cursor: "#f2f5f8",
    selectionBackground: "#404c60",
    black: "#394555",
    red: "#ef8ca2",
    green: "#9ed7b0",
    yellow: "#f1cd86",
    blue: "#91bfff",
    magenta: "#d7b0ef",
    cyan: "#97ddd9",
    white: "#c2d0e1",
    brightBlack: "#576477",
    brightRed: "#f4a0b2",
    brightGreen: "#b2e6c2",
    brightYellow: "#f5daa1",
    brightBlue: "#a9cdff",
    brightMagenta: "#e1c0f5",
    brightCyan: "#ace6e2",
    brightWhite: "#e7edf7",
  };
}

export default function Terminal({
  sessionId,
  visible = true,
  fontSize = 14,
  onFontSizeChange,
  onActivityChange,
  refreshNonce,
  isFocused,
  onFocus,
  theme,
  sessionName,
  paneLabel = "Terminal",
  workPath,
  onClosePanel,
  canClosePanel = true,
  canSuspend = true,
  onSuspend,
  onMaximize,
  showRestoreLayout = false,
  onRestoreLayout,
  onTerminate,
  showMobileKeyBar = true,
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
  const visibleRef = useRef(visible);
  const focusedRef = useRef(isFocused);
  const themeRef = useRef(theme);
  const fontSizeRef = useRef(fontSize);
  onActivityChangeRef.current = onActivityChange;
  visibleRef.current = visible;
  focusedRef.current = isFocused;
  themeRef.current = theme;
  fontSizeRef.current = fontSize;

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [shouldInitialize, setShouldInitialize] = useState(visible);
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
  const refreshFramesRef = useRef<number[]>([]);
  const isMobileDevice = () => window.innerWidth <= 768;
  const isMobile = isMobileDevice;
  const [scrollThumb, setScrollThumb] = useState<{ top: number; height: number } | null>(null);
  const [scrollbarActive, setScrollbarActive] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const refitAndRefresh = useCallback((restoreFocus = false) => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    try {
      fitAddon.fit();
    } catch {
      // ignore
    }

    try {
      term.clearTextureAtlas();
    } catch {
      // ignore
    }

    try {
      term.refresh(0, Math.max(term.rows - 1, 0));
    } catch {
      // ignore
    }

    sendResizeRef.current?.(term.cols, term.rows);
    if (restoreFocus && visible && isFocused) {
      term.focus();
    }
  }, [isFocused, visible]);

  const cancelScheduledHardRefresh = useCallback(() => {
    refreshFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
    refreshFramesRef.current = [];
  }, []);

  const scheduleHardRefresh = useCallback((restoreFocus = false) => {
    if (!visible || !termRef.current || !fitAddonRef.current) return;

    cancelScheduledHardRefresh();
    const frameIds: number[] = [];

    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        refitAndRefresh(restoreFocus);
        refreshFramesRef.current = [];
      });
      frameIds.push(secondFrame);
      refreshFramesRef.current = [...frameIds];
    });

    frameIds.push(firstFrame);
    refreshFramesRef.current = [...frameIds];
  }, [cancelScheduledHardRefresh, refitAndRefresh, visible]);

  const scheduleHardRefreshRef = useRef(scheduleHardRefresh);
  scheduleHardRefreshRef.current = scheduleHardRefresh;

  const wsUrl = sessionId ? getWsUrl(sessionId) : null;

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
      } else if (msg.type === "status" && msg.data === "taken_over") {
        termRef.current?.write("\r\n\x1b[33m[Session taken over by another client]\x1b[0m\r\n");
      } else if (msg.type === "status" && msg.data === "not_found") {
        termRef.current?.write("\r\n\x1b[31m[Session not found]\x1b[0m\r\n");
      }
    },
    autoReconnect: true,
  });

  useEffect(() => {
    if (visible) {
      setShouldInitialize(true);
    }
  }, [visible]);

  useEffect(() => {
    if (!shouldInitialize || !innerRef.current || termRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: fontSizeRef.current,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      theme: getTerminalPalette(themeRef.current),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // Enable mouse events - SGR mode (1006)
    term.element?.classList.add("xterm-enable-mouse");

    term.open(innerRef.current);
    fitAddon.fit();
    sendResize(term.cols, term.rows);

    // Enable SGR mouse tracking mode (1006)
    // This tells xterm.js to send mouse events via escape sequences
    term.write("\x1b[?1006h");

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
    sendMouseRef.current = sendMouse;
    (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug ??= {};
    (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug![sessionId] = { sessionId, sessionName, term };

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
      scheduleHardRefreshRef.current(focusedRef.current);
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
      cancelScheduledHardRefresh();
      const debugStore = (
        window as Window & {
          __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
        }
      ).__remoteCodeTerminalDebug;
      if (debugStore) {
        delete debugStore[sessionId];
      }
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [cancelScheduledHardRefresh, sendInput, sendMouse, sendResize, sessionId, shouldInitialize]);

  useEffect(() => {
    return () => {
      cancelScheduledHardRefresh();
    };
  }, [cancelScheduledHardRefresh]);

  useEffect(() => {
    const debugStore = (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug;
    const entry = debugStore?.[sessionId];
    if (entry) {
      entry.sessionName = sessionName;
    }
  }, [sessionId, sessionName]);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const container = innerRef.current;
    if (!term || !fitAddon || !container) return;

    const palette = getTerminalPalette(theme);
    term.options.theme = palette;

    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
    const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
    const rows = container.querySelector(".xterm-rows") as HTMLElement | null;

    container.style.backgroundColor = palette.background;
    container.style.color = palette.foreground;
    if (viewport) viewport.style.backgroundColor = palette.background;
    if (screen) screen.style.backgroundColor = palette.background;
    if (rows) rows.style.color = palette.foreground;

    requestAnimationFrame(() => {
      refitAndRefresh(isFocused);
    });
  }, [isFocused, refitAndRefresh, theme]);

  // fontSize change -> update terminal
  useEffect(() => {
    if (termRef.current && fitAddonRef.current && visible) {
      termRef.current.options.fontSize = fontSize;
      scheduleHardRefresh(isFocused);
    }
  }, [fontSize, isFocused, scheduleHardRefresh, visible]);

  // visible / panel toggles -> refit + refresh
  useEffect(() => {
    if (visible && termRef.current && fitAddonRef.current) {
      // Double-rAF: wait for browser to fully compute layout after DOM change
      let cancelled = false;
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          refitAndRefresh(isFocused);
        });
      });
      return () => { cancelled = true; };
    }
  }, [explorerOpen, explorerWidth, gitPanelOpen, gitPanelWidth, isFocused, refitAndRefresh, visible]);

  useEffect(() => {
    if (!visible || !termRef.current || !fitAddonRef.current) return;
    scheduleHardRefresh(true);
  }, [refreshNonce, scheduleHardRefresh, visible]);

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
      scheduleHardRefresh(isFocused);
    };
    window.addEventListener("panel-resize-end", handleResizeEnd);
    return () => window.removeEventListener("panel-resize-end", handleResizeEnd);
  }, [isFocused, scheduleHardRefresh]);

  // Focus management
  useEffect(() => {
    if (visible && isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [visible, isFocused]);

  // Ctrl+Shift+C copy handling
  useEffect(() => {
    const container = innerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+C: Copy selection to clipboard
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const term = termRef.current;
        if (!term) return;
        const selection = term.getSelection();
        if (selection) {
          void navigator.clipboard.writeText(selection);
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => container.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopy = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection);
    }
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        sendInput(text);
      }
    } catch {
      // Clipboard access denied or empty
    }
    handleCloseContextMenu();
  }, [sendInput, handleCloseContextMenu]);

  const handleSelectAll = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.selectAll();
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  const handleClear = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.clear();
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => handleCloseContextMenu();
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu, handleCloseContextMenu]);

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
  const statusLabel =
    status === "connecting"
      ? "Connecting..."
      : status === "reconnecting"
        ? "Reconnecting..."
        : status === "auth_failed"
          ? "Authentication expired. Please log in again."
          : status === "taken_over"
            ? "Session taken over by another client."
            : status === "not_found"
              ? "Session not found."
              : status === "closed"
                ? "Session closed."
                : status === "disconnected"
                  ? "Disconnected."
                  : "";
  const statusToneClass =
    status === "connecting" || status === "reconnecting"
      ? "status-info"
      : status === "taken_over" || status === "closed"
        ? "status-warn"
        : "status-danger";

  const iconSize = Math.round(fontSize * 0.86);
  const toolbarTitle = workPath ? `${sessionName} | ${paneLabel} | ${workPath}` : `${sessionName} | ${paneLabel}`;

  return (
    <div
      className="terminal-panel"
      data-testid="terminal-panel"
      style={{
        display: visible ? "flex" : "none",
        flexDirection: "column",
        height: "100%",
      }}
      onMouseDown={onFocus}
    >
      <div
        className={`terminal-toolbar${isFocused ? " is-focused" : ""}`}
        style={{
          minHeight: Math.max(34, Math.round(fontSize * 2.2)),
          padding: `${Math.max(4, Math.round(fontSize * 0.25))}px ${Math.max(10, Math.round(fontSize * 0.5))}px`,
        }}
        title={toolbarTitle}
      >
        <div className="terminal-toolbar__meta">
          <span className="terminal-toolbar__title">{sessionName}</span>
          <span className="terminal-toolbar__separator" aria-hidden="true">|</span>
          <span className="terminal-toolbar__chip">{paneLabel}</span>
        </div>
        <div className="terminal-toolbar__actions">
          <TitleBarBtn
            icon={<FolderIcon size={iconSize} />}
            title="File Explorer"
            hoverColor={getCliTone("folder").hover}
            hoverBackground={getCliTone("folder").soft}
            active={explorerOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setExplorerOpen((o) => { if (!o) setGitPanelOpen(false); return !o; }); }}
          />
          <TitleBarBtn
            icon={<GitIcon size={iconSize} />}
            title="Git"
            hoverColor={getCliTone("git").hover}
            hoverBackground={getCliTone("git").soft}
            active={gitPanelOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setGitPanelOpen((o) => { if (!o) setExplorerOpen(false); return !o; }); }}
          />
          <TitleBarBtn
            icon={<RefreshIcon size={iconSize} />}
            title="Refresh"
            hoverColor="var(--info)"
            fontSize={fontSize}
            onClick={(e) => {
              e.stopPropagation();
              scheduleHardRefresh(true);
            }}
          />
          {onFontSizeChange && (
            <div className="terminal-font-controls">
              <FontSizeBtn label="-" title="Font Size -" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(-1); }} />
              <span className="terminal-font-value">{fontSize}</span>
              <FontSizeBtn label="+" title="Font Size +" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(1); }} />
            </div>
          )}
          {canSuspend && (
            <TitleBarBtn
              icon={<MinimizeIcon size={iconSize} />}
              title="Suspend"
              hoverColor="var(--warn)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onSuspend(); }}
            />
          )}
          {canClosePanel && (
            <TitleBarBtn
              icon={<PaneCloseIcon size={iconSize} />}
              title="Close Pane"
              hoverColor="var(--danger)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onClosePanel(); }}
            />
          )}
          {showRestoreLayout && onRestoreLayout ? (
            <TitleBarBtn
              icon={<RestoreLayoutIcon size={iconSize} />}
              title="Restore Layout"
              hoverColor="var(--accent)"
              fontSize={fontSize}
              onClick={(e) => {
                e.stopPropagation();
                onRestoreLayout();
              }}
            />
          ) : onMaximize && (
            <TitleBarBtn
              icon={<MaximizeIcon size={iconSize} />}
              title="Open Alone"
              hoverColor="var(--accent)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            />
          )}
        </div>
      </div>

      {showBanner && (
        <div className={`terminal-statusbar ${statusToneClass}`} style={STATUS_STYLE[status] || undefined}>
          {statusLabel}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {explorerOpen && (
          <div style={{ width: isMobile() ? undefined : explorerWidth, flexShrink: 0 }}>
            <FileExplorer
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
        <div style={{ flex: 1, minHeight: 0, position: "relative" }} onContextMenu={handleContextMenu}>
          <div ref={innerRef} data-testid="terminal-xterm" style={{ width: "100%", height: "100%" }} />
          {/* Context Menu */}
          {contextMenu && (
            <div
              className="terminal-context-menu"
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1000,
                background: "var(--panel-bg)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                minWidth: 140,
                padding: "4px 0",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <ContextMenuItem label="Copy" onClick={handleCopy} disabled={!termRef.current?.getSelection()} />
              <ContextMenuItem label="Paste" onClick={handlePaste} />
              <ContextMenuItem label="Select All" onClick={handleSelectAll} />
              <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />
              <ContextMenuItem label="Clear" onClick={handleClear} />
            </div>
          )}
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
                  background: scrollbarActive ? "var(--accent)" : "var(--terminal-scrollbar)",
                  border: scrollbarActive ? "1px solid var(--accent-strong)" : "1px solid var(--border-subtle)",
                  transition: "background 0.15s, border 0.15s",
                }}
              />
            </div>
          )}
        </div>
      </div>
      {showMobileKeyBar && <MobileKeyBar onKey={handleKeyBarInput} />}
    </div>
  );
}

/* ---- Title bar helper components ---- */

function FontSizeBtn({ label, title, fontSize = 14, onClick }: { label: string; title: string; fontSize?: number; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      className="terminal-tool-button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        padding: `${Math.round(fontSize * 0.07)}px ${Math.round(fontSize * 0.2)}px`,
        fontSize: Math.round(fontSize * 0.86),
        fontWeight: 700,
        lineHeight: 1,
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
  hoverBackground,
  active,
  fontSize = 14,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hoverColor: string;
  hoverBackground?: string;
  active?: boolean;
  fontSize?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const activeBackground = hoverBackground ?? `${hoverColor}18`;

  return (
    <button
      className={`terminal-tool-button${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        background: active ? activeBackground : "none",
        color: active ? hoverColor : "var(--text-muted)",
        padding: `${Math.round(fontSize * 0.14)}px ${Math.round(fontSize * 0.29)}px`,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = hoverColor;
        btn.style.background = activeBackground;
      }}
      onMouseLeave={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = active ? hoverColor : "var(--text-muted)";
        btn.style.background = active ? activeBackground : "none";
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

const RestoreLayoutIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4.5V2.5h6v6h-2" />
    <rect x="2" y="4" width="6" height="5" rx="0.6" />
  </svg>
);

const PaneCloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
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

function ContextMenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        padding: "6px 16px",
        textAlign: "left",
        background: "none",
        border: "none",
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--hover-bg, rgba(255,255,255,0.05))";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
      }}
    >
      {label}
    </button>
  );
}
