import { useRef, useEffect, useCallback, useState } from "react";

interface WsMessage {
  type: "output" | "status";
  data: string;
}

interface MouseEventData {
  event: "press" | "release" | "move" | "drag" | "scroll";
  button: 0 | 1 | 2 | 64 | 65;
  x: number;
  y: number;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
  };
}

type ExtendedConnectionStatus =
  | "connecting"
  | "reconnecting"
  | "connected"
  | "disconnected"
  | "auth_failed"
  | "taken_over"
  | "not_found"
  | "closed";

interface UseWebSocketOptions {
  url: string | null;
  onMessage: (msg: WsMessage) => void;
  onClose?: () => void;
  onError?: () => void;
  autoReconnect?: boolean;
}

const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;
const AUTH_EXPIRED_EVENT = "remote-code-auth-expired";

export function useWebSocket({
  url,
  onMessage,
  onClose,
  onError,
  autoReconnect = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const permanentStatusRef = useRef<ExtendedConnectionStatus | null>(null);
  const [status, setStatus] = useState<ExtendedConnectionStatus>("disconnected");

  onMessageRef.current = onMessage;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;

  useEffect(() => {
    unmountedRef.current = false;

    if (!url) {
      setStatus("disconnected");
      permanentStatusRef.current = null;
      return;
    }

    const socketUrl = url;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function connect() {
      if (unmountedRef.current) return;
      if (permanentStatusRef.current && permanentStatusRef.current !== "disconnected") return;

      clearReconnectTimer();

      const existing = wsRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
      const ws = new WebSocket(socketUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) return;
        reconnectAttemptRef.current = 0;
        permanentStatusRef.current = null;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          if (msg.type === "status") {
            if (msg.data === "closed") {
              permanentStatusRef.current = "closed";
              setStatus("closed");
            } else if (msg.data === "taken_over") {
              permanentStatusRef.current = "taken_over";
              setStatus("taken_over");
            } else if (msg.data === "not_found") {
              permanentStatusRef.current = "not_found";
              setStatus("not_found");
            }
          }
          onMessageRef.current(msg);
        } catch {
          // Ignore malformed messages.
        }
      };

      ws.onclose = (event) => {
        if (unmountedRef.current) return;
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        const closeCode = event.code;
        if (closeCode === 4401) {
          permanentStatusRef.current = "auth_failed";
          setStatus("auth_failed");
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        } else if (closeCode === 4404) {
          permanentStatusRef.current = "not_found";
          setStatus("not_found");
        } else if (closeCode === 4409) {
          permanentStatusRef.current = "taken_over";
          setStatus("taken_over");
        } else if (!permanentStatusRef.current) {
          setStatus(autoReconnect ? "reconnecting" : "disconnected");
        }
        onCloseRef.current?.();

        if (
          autoReconnect
          && !permanentStatusRef.current
          && ![4401, 4404, 4409].includes(closeCode)
        ) {
          const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY,
          );
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        onErrorRef.current?.();
      };
    }

    function handleVisibilityChange() {
      const readyState = wsRef.current?.readyState;
      if (
        document.hidden ||
        permanentStatusRef.current !== null ||
        readyState === WebSocket.OPEN ||
        readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      reconnectAttemptRef.current = 0;
      clearReconnectTimer();
      connect();
    }

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unmountedRef.current = true;
      permanentStatusRef.current = null;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, autoReconnect]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", data: { cols, rows } }));
    }
  }, []);

  const sendMouse = useCallback((data: MouseEventData) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "mouse", data }));
    }
  }, []);

  return { sendInput, sendResize, sendMouse, status };
}

export function getWsUrl(sessionId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${sessionId}`;
}
