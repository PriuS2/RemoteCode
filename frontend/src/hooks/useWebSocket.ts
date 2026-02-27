import { useRef, useEffect, useCallback, useState } from "react";

interface WsMessage {
  type: "output" | "status";
  data: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketOptions {
  url: string | null;
  onMessage: (msg: WsMessage) => void;
  onClose?: () => void;
  onError?: () => void;
  autoReconnect?: boolean;
}

const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;

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
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  onMessageRef.current = onMessage;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;

  useEffect(() => {
    unmountedRef.current = false;

    if (!url) {
      setStatus("disconnected");
      return;
    }

    function connect() {
      if (unmountedRef.current) return;

      setStatus("connecting");
      const ws = new WebSocket(url!);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) return;
        reconnectAttemptRef.current = 0;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch {
          // ignore
        }
      };

      ws.onclose = (event) => {
        if (unmountedRef.current) return;
        setStatus("disconnected");
        onCloseRef.current?.();

        // 4001 = auth failed, do not reconnect
        if (autoReconnect && event.code !== 4001) {
          const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        onErrorRef.current?.();
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
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

  return { sendInput, sendResize, status };
}

export function getWsUrl(sessionId: string, token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${sessionId}?token=${encodeURIComponent(token)}`;
}
