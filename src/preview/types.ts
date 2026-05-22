/**
 * Shared types for the diagram live preview server.
 */

export interface PlanMeta {
  title?: string;
  summary?: string;
  status?: string;
}

export interface DiagramInfo {
  planId: string;
  path: string;
  modifiedAt: string;
  meta?: PlanMeta;
  content?: string;
}

export interface DiagramPayload {
  planId: string;
  path: string;
  content: string;
  updatedAt: string;
  meta?: PlanMeta;
}

export interface DiagramListResponse {
  diagrams: DiagramInfo[];
}

export interface PreviewServerState {
  running: boolean;
  port: number | null;
  host: string;
  plansDir: string | null;
  slug: string | null;
}

export interface PreviewLifecycleResult {
  action: string;
  running: boolean;
  port: number | null;
  url: string | null;
  message: string;
}
