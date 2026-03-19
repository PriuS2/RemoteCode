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
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="dialog-panel"
        onMouseDown={(event) => event.stopPropagation()}
        style={{ maxWidth }}
      >
        <div className="dialog-header">
          <div className="dialog-title">{title}</div>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`dialog-button${primary ? " is-primary" : ""}${danger ? " is-danger" : ""}`}
    >
      {label}
    </button>
  );
}

export function MessageDialog({
  title,
  message,
  closeLabel = "Close",
  onClose,
}: {
  title: string;
  message: string;
  closeLabel?: string;
  onClose: () => void;
}) {
  return (
    <BaseDialog
      title={title}
      onClose={onClose}
      footer={<DialogButton label={closeLabel} primary onClick={onClose} />}
    >
      <p className="dialog-copy">{message}</p>
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
      <p className="dialog-copy">{description}</p>
      {error && <p className="ui-error">{error}</p>}
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
      <label className="dialog-label">
        <span>{label}</span>
        <input
          ref={inputRef}
          type="text"
          className="ui-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
          }}
          placeholder={placeholder}
        />
      </label>
      {error && <p className="ui-error">{error}</p>}
    </BaseDialog>
  );
}
