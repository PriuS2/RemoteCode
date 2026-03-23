const EXT_MAP: Record<string, { color: string; label: string }> = {
  ".ts": { color: "var(--info)", label: "TS" },
  ".tsx": { color: "var(--info)", label: "TX" },
  ".js": { color: "var(--warn)", label: "JS" },
  ".jsx": { color: "var(--warn)", label: "JX" },
  ".py": { color: "var(--info)", label: "PY" },
  ".json": { color: "var(--warn)", label: "{}" },
  ".md": { color: "var(--accent)", label: "MD" },
  ".pdf": { color: "var(--danger)", label: "PDF" },
  ".css": { color: "var(--accent)", label: "CS" },
  ".scss": { color: "var(--accent)", label: "SC" },
  ".html": { color: "var(--warn)", label: "HT" },
  ".svg": { color: "var(--success)", label: "SV" },
  ".png": { color: "var(--success)", label: "IM" },
  ".jpg": { color: "var(--success)", label: "IM" },
  ".jpeg": { color: "var(--success)", label: "IM" },
  ".gif": { color: "var(--success)", label: "IM" },
  ".webp": { color: "var(--success)", label: "IM" },
  ".ico": { color: "var(--success)", label: "IM" },
  ".yaml": { color: "var(--danger)", label: "YM" },
  ".yml": { color: "var(--danger)", label: "YM" },
  ".toml": { color: "var(--warn)", label: "TM" },
  ".env": { color: "var(--warn)", label: "EN" },
  ".sh": { color: "var(--success)", label: "SH" },
  ".bash": { color: "var(--success)", label: "SH" },
  ".bat": { color: "var(--success)", label: "BA" },
  ".ps1": { color: "var(--info)", label: "PS" },
  ".rs": { color: "var(--warn)", label: "RS" },
  ".go": { color: "var(--info)", label: "GO" },
  ".java": { color: "var(--danger)", label: "JA" },
  ".c": { color: "var(--info)", label: "C" },
  ".cpp": { color: "var(--info)", label: "C+" },
  ".h": { color: "var(--info)", label: "H" },
  ".sql": { color: "var(--warn)", label: "SQ" },
  ".db": { color: "var(--warn)", label: "DB" },
  ".lock": { color: "var(--text-muted)", label: "LK" },
  ".txt": { color: "var(--text-secondary)", label: "TX" },
  ".log": { color: "var(--text-muted)", label: "LG" },
  ".zip": { color: "var(--warn)", label: "ZP" },
  ".gz": { color: "var(--warn)", label: "GZ" },
  ".tar": { color: "var(--warn)", label: "TR" },
  ".wasm": { color: "var(--accent)", label: "WA" },
  ".cs": { color: "var(--success)", label: "C#" },
  ".mp3": { color: "var(--accent)", label: "AU" },
  ".wav": { color: "var(--accent)", label: "AU" },
  ".flac": { color: "var(--accent)", label: "AU" },
  ".ogg": { color: "var(--accent)", label: "AU" },
  ".aac": { color: "var(--accent)", label: "AU" },
  ".m4a": { color: "var(--accent)", label: "AU" },
  ".wma": { color: "var(--accent)", label: "AU" },
  ".opus": { color: "var(--accent)", label: "AU" },
};

const DEFAULT_FILE = { color: "var(--text-muted)", label: "" };

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"]);

function getExtInfo(ext: string | null | undefined) {
  if (!ext) return DEFAULT_FILE;
  return EXT_MAP[ext.toLowerCase()] || DEFAULT_FILE;
}

export const IconFolder = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 2H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
      fill="var(--accent)"
      opacity="0.8"
    />
  </svg>
);

function ImageIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="0.8" strokeOpacity="0.6" />
      <circle cx="5.5" cy="6" r="1.5" fill={color} opacity="0.6" />
      <path d="M1.5 11l3-3 2 2 3-4 5 5" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function AudioIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="0.8" strokeOpacity="0.6" />
      <path d="M6 5v5.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <path d="M8 3.5v8" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <path d="M10 5.5v4" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function FileIcon({ extension, size = 16 }: { extension?: string | null; size?: number }) {
  const { color, label } = getExtInfo(extension);
  const ext = extension?.toLowerCase() ?? "";

  if (IMAGE_EXTS.has(ext)) return <ImageIcon size={size} color={color} />;
  if (AUDIO_EXTS.has(ext)) return <AudioIcon size={size} color={color} />;

  const isSmall = size <= 16;
  const fontSize = isSmall ? 5.5 : 9;
  const labelY = isSmall ? 12.5 : 12;

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M3 1.5C3 1.22 3.22 1 3.5 1H10l3 3v10.5c0 .28-.22.5-.5.5h-9a.5.5 0 01-.5-.5v-13z"
        fill={color}
        opacity="0.15"
      />
      <path
        d="M3 1.5C3 1.22 3.22 1 3.5 1H10l3 3v10.5c0 .28-.22.5-.5.5h-9a.5.5 0 01-.5-.5v-13z"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
      />
      <path d="M10 1v3h3" stroke={color} strokeWidth="0.8" opacity="0.4" />
      {label && (
        <text
          x="8"
          y={labelY}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
          fill={color}
        >
          {label}
        </text>
      )}
    </svg>
  );
}
