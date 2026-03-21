import React from "react";
import { uiPx } from "../utils/uiScale";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "var(--surface-base)",
            color: "var(--text-primary)",
            fontFamily: "monospace",
            gap: 16,
            padding: 24,
          }}
        >
          <h2 style={{ color: "var(--danger)", margin: 0 }}>Something went wrong</h2>
          <pre
            style={{
              color: "var(--text-muted)",
              fontSize: uiPx(13),
              maxWidth: "80vw",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="primary-button"
            style={{
              padding: "8px 20px",
              fontSize: uiPx(14),
              fontWeight: 600,
              borderRadius: 6,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

