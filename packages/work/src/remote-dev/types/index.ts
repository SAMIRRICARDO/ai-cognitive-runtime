// packages/work/src/remote-dev/types/index.ts
// VRAXIA Remote Development Agent — Core Types

// ── Job ───────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'analyzing'
  | 'planning'
  | 'editing'
  | 'testing'
  | 'lint'
  | 'build'
  | 'deploy'
  | 'waiting_approval'
  | 'completed'
  | 'error'
  | 'cancelled';

export type JobMode = 'chat' | 'code' | 'refactor' | 'deploy' | 'diagnose';

export interface JobPermissions {
  editFiles:    boolean;
  runTests:     boolean;
  commit:       boolean;
  deploy:       boolean;
  docker:       boolean;
  terminal:     boolean;
}

export interface RdaJob {
  id:           string;           // uuid
  deviceId:     string;
  executorId:   string;
  projectPath:  string;
  mode:         JobMode;
  prompt:       string;
  permissions:  JobPermissions;
  status:       JobStatus;
  createdAt:    string;
  startedAt?:   string;
  completedAt?: string;
  errorMsg?:    string;
}

export interface JobEvent {
  id:        string;
  jobId:     string;
  type:      JobEventType;
  payload:   string;           // JSON string
  createdAt: string;
}

export type JobEventType =
  | 'status_change'
  | 'log'
  | 'file_changed'
  | 'diff_preview'
  | 'approval_required'
  | 'approval_response'
  | 'metric'
  | 'stream_chunk'
  | 'test_result'
  | 'build_result'
  | 'deploy_result'
  | 'git_event';

// ── Device ────────────────────────────────────────────────────────────────────

export type DeviceStatus = 'online' | 'offline' | 'busy';

export interface Device {
  id:           string;           // uuid
  name:         string;
  platform:     string;           // win32 / darwin / linux
  nodeVersion:  string;
  hostname:     string;
  status:       DeviceStatus;
  lastSeenAt:   string;
  registeredAt: string;
  token:        string;           // hashed JWT secret
}

export interface WorkspaceInfo {
  projects:    ProjectInfo[];
  nodeVersion: string;
  npmVersion:  string;
  gitVersion:  string;
  dockerAvail: boolean;
  pythonAvail: boolean;
}

export interface ProjectInfo {
  name:       string;
  path:       string;
  git:        boolean;
  branch?:    string;
  framework?: string;             // detected: next, vite, express, etc.
  hasTests:   boolean;
  hasDocker:  boolean;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export type ExecutorId = 'claude-code' | 'codex' | 'gemini' | 'cursor' | 'aider' | 'windsurf';

export interface ExecutorInfo {
  id:          ExecutorId;
  name:        string;
  description: string;
  available:   boolean;
  version?:    string;
}

export interface ExecutorResult {
  success:      boolean;
  output:       string;
  filesChanged: string[];
  tokensUsed?:  number;
  durationMs:   number;
  exitCode?:    number;
}

// ── WebSocket Messages ────────────────────────────────────────────────────────

export type WsMessageType =
  | 'auth'
  | 'auth_ok'
  | 'auth_error'
  | 'heartbeat'
  | 'heartbeat_ack'
  | 'workspace_info'
  | 'job_assigned'
  | 'job_event'
  | 'job_cancel'
  | 'executor_stream'
  | 'approval_required'
  | 'approval_response'
  | 'device_status';

export interface WsMessage<T = unknown> {
  type:    WsMessageType;
  payload: T;
  ts:      number;           // epoch ms
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface JobMetrics {
  jobId:        string;
  cpuPct:       number;
  ramMb:        number;
  tokensUsed:   number;
  filesChanged: number;
  testsRun:     number;
  testsPassed:  number;
  commits:      number;
  durationMs:   number;
  sampledAt:    string;
}

// ── Git ───────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch:     string;
  ahead:      number;
  behind:     number;
  modified:   string[];
  untracked:  string[];
  staged:     string[];
}

export interface GitDiff {
  file:    string;
  patch:   string;
  added:   number;
  removed: number;
}

// ── Deploy Provider ───────────────────────────────────────────────────────────

export type DeployProvider = 'vercel' | 'railway' | 'render' | 'docker' | 'aws' | 'azure';

export interface DeployConfig {
  provider:  DeployProvider;
  projectId: string;
  env:       Record<string, string>;
}

export interface DeployResult {
  success: boolean;
  url?:    string;
  logs:    string;
  durationMs: number;
}

// ── API Types ─────────────────────────────────────────────────────────────────

export interface CreateJobRequest {
  deviceId:    string;
  executorId:  ExecutorId;
  projectPath: string;
  mode:        JobMode;
  prompt:      string;
  permissions: JobPermissions;
}

export interface PaginatedResponse<T> {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
}
