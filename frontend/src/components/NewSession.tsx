import { FormEvent, useEffect, useState } from "react";
import FolderBrowser from "./FolderBrowser";
import { apiFetch, readErrorDetail } from "../utils/api";
import { uiPx } from "../utils/uiScale";

interface NewProjectProps {
  onCreated: (projectId: string) => void;
  onCancel: () => void;
}

export default function NewProject({ onCreated, onCancel }: NewProjectProps) {
  const [workPath, setWorkPath] = useState("");
  const [name, setName] = useState("");
  const [createFolder, setCreateFolder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  const isMobile = viewportWidth <= 768;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workPath.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          work_path: workPath.trim(),
          name: name.trim() || null,
          create_folder: createFolder,
        }),
      });

      if (!res.ok) {
        const detail = await readErrorDetail(res, "Failed to create project");
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
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.7)",
          display: "flex",
          alignItems: isMobile ? "flex-end" : "center",
          justifyContent: "center",
          zIndex: 100,
          padding: isMobile ? 0 : 16,
        }}
        onClick={onCancel}
      >
        <div
          style={{
            background: "#1e1e2e",
            border: "1px solid #313244",
            borderRadius: isMobile ? "18px 18px 0 0" : 16,
            width: "100%",
            maxWidth: isMobile ? "100%" : 540,
            maxHeight: isMobile ? "calc(100vh - 24px)" : "min(90vh, 640px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: "20px 22px 16px", borderBottom: "1px solid #313244" }}>
            <h2
              style={{
                margin: 0,
                fontSize: uiPx(20),
                color: "#cdd6f4",
                fontWeight: 700,
              }}
            >
              New Project
            </h2>
            <p style={{ margin: "8px 0 0", fontSize: uiPx(13), color: "#a6adc8", lineHeight: 1.5 }}>
              Create a project container with a fixed workspace path. Sessions will be added under it later.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
                padding: "18px 22px 22px",
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                  Project Path *
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    value={workPath}
                    onChange={(e) => setWorkPath(e.target.value)}
                    placeholder="C:\\Users\\..."
                    autoFocus
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: "11px 12px",
                      fontSize: uiPx(14),
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 8,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowBrowser(true)}
                    title="Browse folders on the server"
                    style={{
                      padding: "0 14px",
                      minHeight: 42,
                      background: "#313244",
                      color: "#cdd6f4",
                      border: "1px solid #45475a",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: uiPx(13),
                      fontWeight: 600,
                    }}
                  >
                    Browse Server Folder
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: uiPx(12), color: "#a6adc8", marginBottom: 6 }}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Folder name will be used if left empty"
                  style={{
                    width: "100%",
                    padding: "11px 12px",
                    fontSize: uiPx(14),
                    background: "#313244",
                    color: "#cdd6f4",
                    border: "1px solid #45475a",
                    borderRadius: 8,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: uiPx(13),
                  color: "#cdd6f4",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={createFolder}
                  onChange={(e) => setCreateFolder(e.target.checked)}
                  style={{ accentColor: "#89b4fa" }}
                />
                Create the folder if it does not exist
              </label>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "#181825",
                  border: "1px solid #313244",
                  color: "#a6adc8",
                  fontSize: uiPx(12),
                  lineHeight: 1.6,
                }}
              >
                Projects own the workspace path. Sessions created under this project will reuse the same path.
              </div>

              {error && (
                <div
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    background: "#f38ba81a",
                    border: "1px solid #f38ba84a",
                    color: "#f38ba8",
                    fontSize: uiPx(13),
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "14px 22px 18px",
                borderTop: "1px solid #313244",
                background: "#1e1e2e",
                position: isMobile ? "sticky" : "static",
                bottom: 0,
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: "10px 16px",
                  fontSize: uiPx(13),
                  background: "transparent",
                  color: "#a6adc8",
                  border: "1px solid #45475a",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !workPath.trim()}
                style={{
                  padding: "10px 16px",
                  fontSize: uiPx(13),
                  fontWeight: 700,
                  background: "#89b4fa",
                  color: "#1e1e2e",
                  border: "none",
                  borderRadius: 8,
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading || !workPath.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showBrowser && (
        <FolderBrowser
          initialPath={workPath || ""}
          onSelect={(path) => {
            setWorkPath(path);
            setShowBrowser(false);
          }}
          onCancel={() => setShowBrowser(false)}
        />
      )}
    </>
  );
}
