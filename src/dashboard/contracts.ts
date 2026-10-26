import type { CheckResult, Project, Run } from "../domain.js";
import type { RunEvent } from "../storage.js";

export interface RunView extends Run {
  active: boolean;
  interrupted: boolean;
  pauseRequested: boolean;
}
export interface DashboardState {
  projects: Project[];
  runs: RunView[];
  busy: boolean;
  activeRunId?: string;
  dataDir: string;
}
export interface Artifact {
  name: string;
  size: number;
  modifiedAt: string;
}
export interface RunDetail {
  run: RunView;
  attempts: number;
  events: RunEvent[];
  checks: (CheckResult & { key: string })[];
  files: Artifact[];
}
export interface FileSlice {
  name: string;
  text: string;
  start: number;
  end: number;
  size: number;
}
