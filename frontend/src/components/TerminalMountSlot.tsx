import { useLayoutEffect, useRef } from "react";

interface TerminalMountSlotProps {
  sessionId: string;
  paneId: string;
  onHostChange: (sessionId: string, paneId: string, element: HTMLDivElement | null) => void;
}

export default function TerminalMountSlot({
  sessionId,
  paneId,
  onHostChange,
}: TerminalMountSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    onHostChange(sessionId, paneId, slotRef.current);
    return () => {
      onHostChange(sessionId, paneId, null);
    };
  }, [onHostChange, paneId, sessionId]);

  return (
    <div
      ref={slotRef}
      className="terminal-mount-slot"
      data-testid={`terminal-slot-${sessionId}`}
      data-terminal-slot={sessionId}
    />
  );
}
