interface MobileKeyBarProps {
  onKey: (data: string) => void;
}

interface KeyDef {
  label: string;
  value: string;
  width?: number;
  highlight?: boolean;
}

const ARROW_GROUP_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 2,
  background: "#313244",
  borderRadius: 6,
  padding: "0 2px",
};

const ArrowIcon = ({
  direction,
}: {
  direction: "up" | "down" | "left" | "right";
}) => {
  const paths: Record<string, string> = {
    up: "M6 10L12 4L18 10",
    down: "M6 14L12 20L18 14",
    left: "M14 6L8 12L14 18",
    right: "M10 6L16 12L10 18",
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[direction]} />
    </svg>
  );
};

const PRE_ARROWS: KeyDef[] = [
  { label: "⇧Tab", value: "\x1b[Z" },
  { label: "Tab", value: "\t" },
];

const ARROWS = [
  { dir: "up" as const, value: "\x1b[A" },
  { dir: "down" as const, value: "\x1b[B" },
  { dir: "left" as const, value: "\x1b[D" },
  { dir: "right" as const, value: "\x1b[C" },
];

const POST_ARROWS: KeyDef[] = [
  { label: "Enter", value: "\r" },
  { label: "Esc", value: "\x1b" },
  { label: "C-c", value: "\x03" },
  { label: "Y", value: "y" },
  { label: "N", value: "n" },
];

const BTN_BASE: React.CSSProperties = {
  height: 34,
  padding: "0 8px",
  border: "none",
  borderRadius: 5,
  background: "#313244",
  color: "#cdd6f4",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "'Cascadia Code', 'Consolas', monospace",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
  WebkitTapHighlightColor: "transparent",
  userSelect: "none",
  touchAction: "manipulation",
};

const ARROW_BTN: React.CSSProperties = {
  ...BTN_BASE,
  flex: "none",
  minWidth: 28,
  padding: "0 2px",
  background: "transparent",
};

export default function MobileKeyBar({
  onKey,
}: MobileKeyBarProps) {
  const renderBtn = (key: KeyDef, i: number) => (
    <button
      key={i}
      style={BTN_BASE}
      onClick={() => onKey(key.value)}
    >
      {key.label}
    </button>
  );

  return (
    <div className="mobile-keybar">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 6px",
          height: "100%",
        }}
      >
        {PRE_ARROWS.map(renderBtn)}

        {/* Arrow group */}
        <div style={ARROW_GROUP_STYLE}>
          {ARROWS.map((a) => (
            <button
              key={a.dir}
              style={ARROW_BTN}
              onClick={() => onKey(a.value)}
            >
              <ArrowIcon direction={a.dir} />
            </button>
          ))}
        </div>

        {POST_ARROWS.map(renderBtn)}
      </div>
    </div>
  );
}
