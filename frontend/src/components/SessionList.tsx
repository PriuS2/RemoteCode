import type { ActivityState } from "./Terminal";

interface Session {
  id: string;
  name: string;
  work_path: string;
  status: string;
  created_at: string;
  last_accessed_at: string;
  claude_session_id: string | null;
}

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  sessionActivity: Record<string, ActivityState>;
  onSelect: (id: string) => void;
  onSuspend: (id: string) => void;
  onResume: (id: string) => void;
  onTerminate: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSession: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#a6e3a1",
  suspended: "#f9e2af",
  closed: "#6c7086",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

const Spinner = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    style={{ animation: "ccr-spin 1s linear infinite", flexShrink: 0 }}
  >
    <circle
      cx="7"
      cy="7"
      r="5.5"
      fill="none"
      stroke="#89b4fa"
      strokeWidth="2"
      strokeDasharray="20 12"
      strokeLinecap="round"
    />
    <style>{`@keyframes ccr-spin { to { transform: rotate(360deg); } }`}</style>
  </svg>
);

const DoneBadge = () => (
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "#a6e3a1",
      boxShadow: "0 0 6px #a6e3a1",
      flexShrink: 0,
      animation: "ccr-pulse 1.5s ease-in-out infinite",
    }}
  >
    <style>{`@keyframes ccr-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
  </span>
);

export default function SessionList({
  sessions,
  activeSessionId,
  sessionActivity,
  onSelect,
  onSuspend,
  onResume,
  onTerminate,
  onDelete,
  onNewSession,
}: SessionListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #313244",
          fontWeight: 600,
          fontSize: 14,
          color: "#cdd6f4",
        }}
      >
        Sessions
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {sessions.length === 0 && (
          <div
            style={{
              padding: "16px",
              color: "#6c7086",
              textAlign: "center",
              fontSize: 13,
            }}
          >
            No sessions
          </div>
        )}

        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const activity = sessionActivity[session.id];
          return (
            <div
              key={session.id}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                background: isActive ? "#313244" : "transparent",
                borderLeft: isActive ? "3px solid #89b4fa" : "3px solid transparent",
                transition: "background 0.15s",
              }}
              onClick={() => {
                if (session.status === "active") onSelect(session.id);
                if (session.status === "closed" || session.status === "suspended")
                  onResume(session.id);
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLDivElement).style.background = "#28283d";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_COLORS[session.status] || "#6c7086",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#cdd6f4",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {session.name}
                </span>
                {/* Activity indicator */}
                {activity === "processing" && <Spinner />}
                {activity === "done" && <DoneBadge />}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: "#6c7086",
                  marginLeft: 16,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {session.work_path}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginTop: 6,
                  marginLeft: 16,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#313244",
                    color: STATUS_COLORS[session.status] || "#6c7086",
                  }}
                >
                  {STATUS_LABELS[session.status] || session.status}
                </span>

                {session.status === "active" && (
                  <>
                    <ActionButton
                      label="Suspend"
                      color="#f9e2af"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSuspend(session.id);
                      }}
                    />
                    <ActionButton
                      label="Kill"
                      color="#f38ba8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTerminate(session.id);
                      }}
                    />
                  </>
                )}

                {session.status === "suspended" && (
                  <>
                    <ActionButton
                      label="Resume"
                      color="#a6e3a1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onResume(session.id);
                      }}
                    />
                    <ActionButton
                      label="Delete"
                      color="#f38ba8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(session.id);
                      }}
                    />
                  </>
                )}

                {session.status === "closed" && (
                  <>
                    <ActionButton
                      label="Reopen"
                      color="#a6e3a1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onResume(session.id);
                      }}
                    />
                    <ActionButton
                      label="Delete"
                      color="#f38ba8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(session.id);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid #313244" }}>
        <button
          onClick={onNewSession}
          style={{
            width: "100%",
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            background: "#89b4fa",
            color: "#1e1e2e",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          + New Session
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: "transparent",
        color,
        border: `1px solid ${color}40`,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = `${color}20`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}
