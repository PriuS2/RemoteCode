import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface BaseDialogProps {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  maxWidth?: number;
}

function BaseDialog({
  title,
  children,
  footer,
  onClose,
  maxWidth = 420,
}: BaseDialogProps) {
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    firstFocusableRef.current?.focus();
  }, []);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth,
          background: "#1e1e2e",
          border: "1px solid #313244",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #313244" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd6f4" }}>{title}</div>
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {children}
        </div>
        <div
          style={{
            padding: "12px 18px 18px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid #313244",
          }}
        >
          {footer}
        </div>
      </div>
      <button
        ref={firstFocusableRef}
        type="button"
        onClick={onClose}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>,
    document.body,
  );
}

function DialogButton({
  label,
  onClick,
  danger = false,
  primary = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
}) {
  let background = "transparent";
  let color = "#a6adc8";
  let border = "1px solid #45475a";

  if (primary) {
    background = "#89b4fa";
    color = "#1e1e2e";
    border = "none";
  } else if (danger) {
    background = "#f38ba8";
    color = "#11111b";
    border = "none";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "9px 14px",
        borderRadius: 8,
        border,
        background,
        color,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function MessageDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <BaseDialog
      title={title}
      onClose={onClose}
      footer={<DialogButton label="Close" primary onClick={onClose} />}
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#cdd6f4" }}>{message}</p>
    </BaseDialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <BaseDialog
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <DialogButton label={cancelLabel} onClick={onCancel} disabled={pending} />
          <DialogButton
            label={pending ? "Working..." : confirmLabel}
            danger={danger}
            primary={!danger}
            onClick={onConfirm}
            disabled={pending}
          />
        </>
      )}
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#cdd6f4" }}>{description}</p>
      {error && <p style={{ margin: 0, fontSize: 12, color: "#f38ba8" }}>{error}</p>}
    </BaseDialog>
  );
}

export function PromptDialog({
  title,
  label,
  value,
  confirmLabel,
  cancelLabel = "Cancel",
  placeholder = "",
  pending = false,
  error,
  onChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  cancelLabel?: string;
  placeholder?: string;
  pending?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [didFocus, setDidFocus] = useState(false);

  useEffect(() => {
    if (!didFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
      setDidFocus(true);
    }
  }, [didFocus]);

  return (
    <BaseDialog
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <DialogButton label={cancelLabel} onClick={onCancel} disabled={pending} />
          <DialogButton
            label={pending ? "Saving..." : confirmLabel}
            primary
            onClick={onConfirm}
            disabled={pending || !value.trim()}
          />
        </>
      )}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "#a6adc8" }}>{label}</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
          }}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #45475a",
            background: "#313244",
            color: "#cdd6f4",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </label>
      {error && <p style={{ margin: 0, fontSize: 12, color: "#f38ba8" }}>{error}</p>}
    </BaseDialog>
  );
}
