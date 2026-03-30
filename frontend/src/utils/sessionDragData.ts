export const SESSION_DRAG_MIME = "application/x-remote-code-session";

export function setSessionDragData(dataTransfer: DataTransfer, sessionId: string) {
  dataTransfer.setData(SESSION_DRAG_MIME, sessionId);
  dataTransfer.setData("text/plain", sessionId);
}

export function hasSessionDragData(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types ?? []).includes(SESSION_DRAG_MIME);
}

export function getSessionDragData(dataTransfer: DataTransfer | null | undefined): string | null {
  if (!dataTransfer) {
    return null;
  }
  const sessionId = dataTransfer.getData(SESSION_DRAG_MIME).trim();
  return sessionId || null;
}
