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

export interface IdeFileResponse {
  path: string;
  content: string;
  version: string | null;
  readonly: boolean;
  too_large: boolean;
  language_id: string;
  size: number;
}

export interface IdeSaveFileResponse {
  path: string;
  version: string;
  size: number;
  language_id: string;
}

export interface IdeLanguageStatus {
  language_id: string;
  label: string;
  transport: "native" | "lsp" | "syntax";
  available: boolean;
  detail: string | null;
  extensions: string[];
}

export interface LayoutLeafNode {
  type: "leaf";
  paneId: string;
  sessionId: string;
}

export interface LayoutSplitNode {
  type: "split";
  splitId: string;
  direction: "row" | "column";
  ratio: number;
  first: ProjectLayoutNode;
  second: ProjectLayoutNode;
}

export type ProjectLayoutNode = LayoutLeafNode | LayoutSplitNode;

export interface ProjectLayoutResponse {
  layout: ProjectLayoutNode | null;
}

export interface UpdateProjectLayoutRequest {
  layout: ProjectLayoutNode | null;
}
