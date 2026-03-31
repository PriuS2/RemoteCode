import { FormEvent, useEffect, useState } from "react";
import FolderBrowser from "./FolderBrowser";
import { apiFetch, readErrorDetail } from "../utils/api";
import { isDesktopChromium, openFolderDialog } from "../runtime";
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
  const desktopChromium = isDesktopChromium();

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
        className="sheet-overlay"
        style={{
          alignItems: isMobile ? "flex-end" : "center",
          padding: isMobile ? 0 : 16,
        }}
        onClick={onCancel}
      >
        <div
          className={`sheet-panel${isMobile ? " is-mobile" : ""}`}
          data-testid="new-project-modal"
          style={{
            maxWidth: isMobile ? "100%" : 540,
            maxHeight: isMobile ? "calc(100vh - 24px)" : "min(90vh, 640px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sheet-header">
            <h2 className="sheet-title" style={{ fontSize: uiPx(20) }}>New Project</h2>
            <p className="sheet-copy" style={{ fontSize: uiPx(13) }}>
              Create a project container with a fixed workspace path. Sessions will be added under it later.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="sheet-form">
            <div className="sheet-body">
              <div className="sheet-field">
                <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
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
                    data-testid="new-project-path"
                    className="ui-input"
                    style={{ width: "100%", minWidth: 0, fontSize: uiPx(14) }}
                  />
                  {desktopChromium && (
                    <button
                      type="button"
                      onClick={async () => {
                        const selectedPath = await openFolderDialog();
                        if (selectedPath) {
                          setWorkPath(selectedPath);
                        }
                      }}
                      title="Choose a local folder with the desktop app"
                      className="secondary-button"
                      style={{ padding: "0 14px", minHeight: 42, fontSize: uiPx(13), fontWeight: 600 }}
                    >
                      Choose Local Folder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowBrowser(true)}
                    title="Browse folders on the server"
                    className="secondary-button"
                    style={{ padding: "0 14px", minHeight: 42, fontSize: uiPx(13), fontWeight: 600 }}
                  >
                    Browse Server Folder
                  </button>
                </div>
              </div>

              <div className="sheet-field">
                <label className="sheet-label" style={{ fontSize: uiPx(12) }}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Folder name will be used if left empty"
                  data-testid="new-project-name"
                  className="ui-input"
                  style={{ width: "100%", fontSize: uiPx(14) }}
                />
              </div>

              <label className="sheet-checkbox" style={{ fontSize: uiPx(13) }}>
                <input
                  type="checkbox"
                  checked={createFolder}
                  onChange={(e) => setCreateFolder(e.target.checked)}
                  data-testid="new-project-create-folder"
                  style={{ accentColor: "var(--accent)" }}
                />
                Create the folder if it does not exist
              </label>

              <div className="ui-note" style={{ fontSize: uiPx(12) }}>
                Projects own the workspace path. Sessions created under this project will reuse the same path.
              </div>

              {error && <div className="ui-error ui-error--block" style={{ fontSize: uiPx(13) }}>{error}</div>}
            </div>

            <div
              className="sheet-footer"
              style={{
                position: isMobile ? "sticky" : "static",
                bottom: 0,
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                className="secondary-button"
                style={{ padding: "10px 16px", fontSize: uiPx(13) }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !workPath.trim()}
                className="primary-button"
                data-testid="new-project-submit"
                style={{ padding: "10px 16px", fontSize: uiPx(13), opacity: loading || !workPath.trim() ? 0.5 : 1 }}
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
