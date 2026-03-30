import { describe, expect, it } from "vitest";
import type { Session } from "../types/session";
import {
  isPersistentTerminalSession,
  mergePersistentTerminalSessionIds,
  prunePersistentTerminalSessionIds,
} from "./persistentTerminalRegistry";

function createSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? "session-1",
    project_id: overrides.project_id ?? "project-1",
    name: overrides.name ?? "Session",
    work_path: overrides.work_path ?? "C:/workspace",
    status: overrides.status ?? "active",
    cli_type: overrides.cli_type ?? "terminal",
    created_at: overrides.created_at ?? "2026-03-30T00:00:00Z",
    last_accessed_at: overrides.last_accessed_at ?? "2026-03-30T00:00:00Z",
    claude_session_id: overrides.claude_session_id ?? null,
    cli_options: overrides.cli_options ?? null,
    custom_command: overrides.custom_command ?? null,
    custom_exit_command: overrides.custom_exit_command ?? null,
    order_index: overrides.order_index ?? 0,
  };
}

describe("persistentTerminalRegistry", () => {
  it("detects terminal-backed sessions only", () => {
    expect(isPersistentTerminalSession(createSession({ cli_type: "terminal" }))).toBe(true);
    expect(isPersistentTerminalSession(createSession({ cli_type: "claude" }))).toBe(true);
    expect(isPersistentTerminalSession(createSession({ cli_type: "folder" }))).toBe(false);
    expect(isPersistentTerminalSession(undefined)).toBe(false);
  });

  it("merges active terminal sessions from the current layout", () => {
    const sessions = [
      createSession({ id: "term-1", cli_type: "terminal" }),
      createSession({ id: "git-1", cli_type: "git" }),
      createSession({ id: "term-2", cli_type: "claude" }),
      createSession({ id: "term-3", cli_type: "terminal", status: "suspended" }),
    ];

    expect(mergePersistentTerminalSessionIds(["term-1"], ["git-1", "term-2", "term-3"], sessions)).toEqual([
      "term-1",
      "term-2",
    ]);
  });

  it("does not duplicate kept-alive terminals", () => {
    const sessions = [
      createSession({ id: "term-1" }),
      createSession({ id: "term-2", cli_type: "custom" }),
    ];

    expect(mergePersistentTerminalSessionIds(["term-1"], ["term-1", "term-2"], sessions)).toEqual([
      "term-1",
      "term-2",
    ]);
  });

  it("prunes non-active or missing terminal runtimes", () => {
    const sessions = [
      createSession({ id: "term-1", status: "active" }),
      createSession({ id: "term-2", status: "suspended" }),
      createSession({ id: "folder-1", cli_type: "folder" }),
    ];

    expect(prunePersistentTerminalSessionIds(["term-1", "term-2", "folder-1", "missing"], sessions)).toEqual([
      "term-1",
    ]);
  });
});
