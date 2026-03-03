export interface Session {
  id: string;
  name: string;
  work_path: string;
  status: string;
  cli_type: "claude" | "opencode" | "opencode-web" | "terminal" | "custom";
  created_at: string;
  last_accessed_at: string;
  claude_session_id: string | null;
  custom_command: string | null;
  custom_exit_command: string | null;
  order_index: number;
}
