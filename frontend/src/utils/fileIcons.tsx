const EXT_MAP: Record<string, { color: string; label: string }> = {
  ".ts":    { color: "#89b4fa", label: "TS" },
  ".tsx":   { color: "#89b4fa", label: "TX" },
  ".js":    { color: "#f9e2af", label: "JS" },
  ".jsx":   { color: "#f9e2af", label: "JX" },
  ".py":    { color: "#89b4fa", label: "PY" },
  ".json":  { color: "#f9e2af", label: "{}" },
  ".md":    { color: "#89b4fa", label: "MD" },
  ".css":   { color: "#cba6f7", label: "CS" },
  ".scss":  { color: "#cba6f7", label: "SC" },
  ".html":  { color: "#fab387", label: "HT" },
  ".svg":   { color: "#a6e3a1", label: "SV" },
  ".png":   { color: "#a6e3a1", label: "IM" },
  ".jpg":   { color: "#a6e3a1", label: "IM" },
  ".jpeg":  { color: "#a6e3a1", label: "IM" },
  ".gif":   { color: "#a6e3a1", label: "IM" },
  ".webp":  { color: "#a6e3a1", label: "IM" },
  ".ico":   { color: "#a6e3a1", label: "IM" },
  ".yaml":  { color: "#f38ba8", label: "YM" },
  ".yml":   { color: "#f38ba8", label: "YM" },
  ".toml":  { color: "#fab387", label: "TM" },
  ".env":   { color: "#f9e2af", label: "EN" },
  ".sh":    { color: "#a6e3a1", label: "SH" },
  ".bash":  { color: "#a6e3a1", label: "SH" },
  ".bat":   { color: "#a6e3a1", label: "BA" },
  ".ps1":   { color: "#89b4fa", label: "PS" },
  ".rs":    { color: "#fab387", label: "RS" },
  ".go":    { color: "#94e2d5", label: "GO" },
  ".java":  { color: "#f38ba8", label: "JA" },
  ".c":     { color: "#89b4fa", label: "C" },
  ".cpp":   { color: "#89b4fa", label: "C+" },
  ".h":     { color: "#89b4fa", label: "H" },
  ".sql":   { color: "#f9e2af", label: "SQ" },
  ".db":    { color: "#f9e2af", label: "DB" },
  ".lock":  { color: "#6c7086", label: "LK" },
  ".txt":   { color: "#a6adc8", label: "TX" },
  ".log":   { color: "#6c7086", label: "LG" },
  ".zip":   { color: "#fab387", label: "ZP" },
  ".gz":    { color: "#fab387", label: "GZ" },
  ".tar":   { color: "#fab387", label: "TR" },
  ".wasm":  { color: "#cba6f7", label: "WA" },
  ".cs":    { color: "#a6e3a1", label: "C#" },
  ".mp3":   { color: "#f5c2e7", label: "♪" },
  ".wav":   { color: "#f5c2e7", label: "♪" },
  ".flac":  { color: "#f5c2e7", label: "♪" },
  ".ogg":   { color: "#f5c2e7", label: "♪" },
  ".aac":   { color: "#f5c2e7", label: "♪" },
  ".m4a":   { color: "#f5c2e7", label: "♪" },
  ".wma":   { color: "#f5c2e7", label: "♪" },
  ".opus":  { color: "#f5c2e7", label: "♪" },
};

const DEFAULT_FILE = { color: "#6c7086", label: "" };

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
      fill="#89b4fa"
      opacity="0.8"
    />
  </svg>
);

function ImageIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill={color} opacity="0.15" stroke={color} strokeWidth="0.8" opacity="0.6" />
      <circle cx="5.5" cy="6" r="1.5" fill={color} opacity="0.6" />
      <path d="M1.5 11l3-3 2 2 3-4 5 5" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function AudioIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" fill={color} opacity="0.15" stroke={color} strokeWidth="0.8" opacity="0.6" />
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
      {/* Document shape */}
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
      {/* Fold corner */}
      <path d="M10 1v3h3" stroke={color} strokeWidth="0.8" opacity="0.4" />
      {/* Extension label */}
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
