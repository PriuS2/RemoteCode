export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface CliPreflightResponse {
  ok: boolean;
  code: string;
  message: string;
  resolved_command: string | null;
}

export interface TextPreviewResponse {
  content: string;
  size: number;
  truncated: boolean;
  start_line: number;
  end_line: number;
  total_lines: number;
  has_prev: boolean;
  has_next: boolean;
}
