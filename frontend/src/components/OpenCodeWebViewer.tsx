import { useEffect, useState, useRef } from "react";

interface OpenCodeWebViewerProps {
  token: string;
  onClose: () => void;
}

export default function OpenCodeWebViewer({ token, onClose }: OpenCodeWebViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    const init = async () => {
      try {
        const statusRes = await fetch("/api/opencode-web/status", {
          headers: authHeaders,
        });
        
        if (!statusRes.ok) {
          const errData = await statusRes.json();
          throw new Error(errData.detail || `HTTP ${statusRes.status}`);
        }
        
        const status = await statusRes.json();

        if (!status.running) {
          const startRes = await fetch("/api/opencode-web/start", {
            method: "POST",
            headers: authHeaders,
          });
          
          if (!startRes.ok) {
            const errData = await startRes.json();
            throw new Error(errData.detail || `HTTP ${startRes.status}`);
          }
        }
        
        setLoading(false);
        
        if (!openedRef.current) {
          openedRef.current = true;
          const host = window.location.host;
          const openUrl = `http://${host.split(':')[0]}:8096`;
          window.open(openUrl, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      }
    };
    init();
  }, [token]);

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          flexDirection: "column",
          gap: 16,
          color: "#f38ba8",
          background: "#1e1e2e",
        }}
      >
        <div>Error: {error}</div>
        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            background: "#313244",
            color: "#cdd6f4",
            border: "1px solid #45475a",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#cdd6f4",
          background: "#1e1e2e",
        }}
      >
        Starting OpenCode Web...
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: "#1e1e2e", color: "#cdd6f4" }}>
      <div>OpenCode Web이 새 창에서 열렸습니다.</div>
      <div style={{ fontSize: 12, color: "#a6adc8" }}>브라우저 팝업 차단을 확인해 주세요.</div>
      <button
        onClick={onClose}
        style={{
          padding: "8px 16px",
          background: "#313244",
          color: "#cdd6f4",
          border: "1px solid #45475a",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}
