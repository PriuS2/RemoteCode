import type { Session } from "../types/session";

export function isPersistentTerminalSession(session: Pick<Session, "cli_type"> | null | undefined): boolean {
  if (!session) {
    return false;
  }

  return session.cli_type !== "folder" && session.cli_type !== "git" && session.cli_type !== "ide";
}

export function mergePersistentTerminalSessionIds(
  currentIds: string[],
  layoutSessionIds: string[],
  sessions: Session[],
): string[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const nextIds = [...currentIds];
  const seen = new Set(currentIds);

  layoutSessionIds.forEach((sessionId) => {
    const session = sessionById.get(sessionId);
    if (!session || session.status !== "active" || !isPersistentTerminalSession(session) || seen.has(sessionId)) {
      return;
    }
    seen.add(sessionId);
    nextIds.push(sessionId);
  });

  return nextIds;
}

export function prunePersistentTerminalSessionIds(currentIds: string[], sessions: Session[]): string[] {
  const activeTerminalIds = new Set(
    sessions
      .filter((session) => session.status === "active" && isPersistentTerminalSession(session))
      .map((session) => session.id),
  );

  return currentIds.filter((sessionId) => activeTerminalIds.has(sessionId));
}
