import type { Session } from "./session";

export interface Project {
  id: string;
  name: string;
  work_path: string;
  created_at: string;
  updated_at: string;
  order_index: number;
  sessions: Session[];
}
