import { useRef, useCallback } from "react";
import { uiPx } from "../utils/uiScale";

interface MobileKeyBarProps {
  onKey: (data: string) => void;
}

/* ?? Arrow SVG icon (reused from original) ?? */
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

/* ?? Enter icon ?? */
const EnterIcon = () => (
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
    <path d="M20 7V13H6M10 9L6 13L10 17" />
  </svg>
);

/* ?? Undo icon ?? */
const UndoIcon = () => (
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
    <path d="M4 7h10a4 4 0 0 1 0 8H11M4 7L8 3M4 7L8 11" />
  </svg>
);

/* ?? Styles ?? */
const BTN_BASE: React.CSSProperties = {
  height: 34,
  padding: "0 4px",
  border: "1px solid var(--border-subtle)",
  borderRadius: 5,
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  fontSize: uiPx(12),
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

const PREFIX_BTN: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--surface-3)",
  color: "var(--accent)",
  fontWeight: 700,
  fontSize: uiPx(14),
};

const ARROW_BTN: React.CSSProperties = {
  ...BTN_BASE,
  flex: "none",
  width: 38,
  height: 34,
  padding: 0,
  background: "var(--surface-3)",
  borderRadius: 4,
};

const ENTER_BTN: React.CSSProperties = {
  ...BTN_BASE,
  flex: "none",
  background: "var(--surface-3)",
  borderRadius: 5,
  gridArea: "en",
  width: "100%",
  fontSize: uiPx(13),
  gap: 4,
};

const DPAD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateAreas: `
    "en en  en"
    ".  up  ."
    "lt dn  rt"
  `,
  gridTemplateColumns: "38px 38px 38px",
  gridTemplateRows: "34px 34px 34px",
  gap: 2,
  background: "var(--surface-2)",
  borderRadius: 6,
  padding: "0 2px",
};

const OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: 3,
  padding: "3px 4px",
  height: "100%",
};

const LEFT_COL: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
};

const ROW: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: 3,
  flex: 1,
};

/* ?? Row definitions ?? */
interface BtnDef {
  label: React.ReactNode;
  value: string;
  style?: React.CSSProperties;
  handler?: "esc" | "typeCommand" | "default";
}

const ROW1: BtnDef[] = [
  { label: "!", value: "!", style: PREFIX_BTN },
  { label: "/", value: "/", style: PREFIX_BTN },
  { label: "@", value: "@", style: PREFIX_BTN },
  { label: "&", value: "&", style: PREFIX_BTN },
  { label: <><span>Esc</span><span style={{ fontSize: uiPx(8), opacity: 0.5, marginLeft: 2 }}>2x</span></>, value: "\x1b", handler: "esc" },
  { label: "C-c", value: "\x03" },
];

const ROW2: BtnDef[] = [
  { label: "Tab", value: "\t" },
  { label: "S-Tab", value: "\x1b[Z" },
  { label: <UndoIcon />, value: "\x1f" },
  { label: "model", value: "/model", handler: "typeCommand" },
];

const ROW3: BtnDef[] = [
  { label: <><span>^V</span><span style={{ fontSize: uiPx(8), opacity: 0.5, marginLeft: 2 }}>paste</span></>, value: "\x16" },
  { label: <><span>A-v</span><span style={{ fontSize: uiPx(8), opacity: 0.5, marginLeft: 2 }}>img</span></>, value: "\x1bv" },
  { label: "^O", value: "\x0f" },
  { label: "^L", value: "\x0c" },
];

/* ?? Haptic feedback ?? */
const vibrate = (ms = 8) => {
  if (navigator.vibrate) navigator.vibrate(ms);
};

/* ?? Component ?? */
export default function MobileKeyBar({ onKey }: MobileKeyBarProps) {
  const escTimeRef = useRef(0);

  const typeCommand = useCallback(
    async (cmd: string) => {
      vibrate();
      for (const ch of cmd) {
        onKey(ch);
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 300));
      onKey("\r");
    },
    [onKey],
  );

  const handleEsc = useCallback(async () => {
    vibrate();
    const now = Date.now();
    if (now - escTimeRef.current < 300) {
      onKey("\x1b");
      await new Promise((r) => setTimeout(r, 300));
      onKey("\x1b");
      escTimeRef.current = 0;
    } else {
      onKey("\x1b");
      escTimeRef.current = now;
    }
  }, [onKey]);

  const tap = useCallback(
    (value: string) => {
      vibrate();
      onKey(value);
    },
    [onKey],
  );

  const renderBtn = (btn: BtnDef, i: number) => (
    <button
      key={i}
      style={btn.style || BTN_BASE}
      onClick={() => {
        if (btn.handler === "esc") {
          handleEsc();
        } else if (btn.handler === "typeCommand") {
          typeCommand(btn.value);
        } else {
          tap(btn.value);
        }
      }}
    >
      {btn.label}
    </button>
  );

  return (
    <div className="mobile-keybar">
      <div style={OUTER}>
        {/* Left: 3 rows of shortcut buttons */}
        <div style={LEFT_COL}>
          <div style={ROW}>{ROW1.map(renderBtn)}</div>
          <div style={ROW}>{ROW2.map(renderBtn)}</div>
          <div style={ROW}>{ROW3.map(renderBtn)}</div>
        </div>

        {/* Right: Enter + D-pad grid */}
        <div style={DPAD_GRID}>
          <button style={ENTER_BTN} onClick={() => tap("\r")}>
            <EnterIcon />
          </button>
          <button
            style={{ ...ARROW_BTN, gridArea: "up" }}
            onClick={() => tap("\x1b[A")}
          >
            <ArrowIcon direction="up" />
          </button>
          <button
            style={{ ...ARROW_BTN, gridArea: "lt" }}
            onClick={() => tap("\x1b[D")}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            style={{ ...ARROW_BTN, gridArea: "dn" }}
            onClick={() => tap("\x1b[B")}
          >
            <ArrowIcon direction="down" />
          </button>
          <button
            style={{ ...ARROW_BTN, gridArea: "rt" }}
            onClick={() => tap("\x1b[C")}
          >
            <ArrowIcon direction="right" />
          </button>
        </div>
      </div>
    </div>
  );
}

