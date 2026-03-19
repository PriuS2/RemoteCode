import { useEffect, useRef, useState } from "react";
import { apiFetch, readErrorMessage } from "../utils/api";
import { uiPx } from "../utils/uiScale";

interface OpenCodeWebViewerProps {
  onClose: () => void;
}

export default function OpenCodeWebViewer({ onClose }: OpenCodeWebViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const statusRes = await apiFetch("/api/opencode-web/status");
        if (!statusRes.ok) {
          throw new Error(await readErrorMessage(statusRes, `HTTP ${statusRes.status}`));
        }

        const status = await statusRes.json();
        if (!status.running) {
          const startRes = await apiFetch("/api/opencode-web/start", {
            method: "POST",
          });
          if (!startRes.ok) {
            throw new Error(await readErrorMessage(startRes, `HTTP ${startRes.status}`));
          }
        }

        setLoading(false);
        if (!openedRef.current) {
          openedRef.current = true;
          window.open("/api/opencode-web/proxy/", "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      }
    };

    init();
  }, []);

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
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        background: "#1e1e2e",
        color: "#cdd6f4",
      }}
    >
      <div>OpenCode Web was opened in a new tab.</div>
      <div style={{ fontSize: uiPx(12), color: "#a6adc8" }}>
        If nothing opened, check your popup blocker and try again.
      </div>
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

