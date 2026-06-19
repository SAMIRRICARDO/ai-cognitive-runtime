export interface Lead {
  id: string;
  name: string;
  company: string;
  role: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
  score?: number;
  fit?: string;
  enriched?: boolean;
}

export interface SearchFilters {
  industry?: string;
  department?: string;
  position?: string;
  location?: string;
  company_size?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PipelineStep[];
  autonomy_level: number;
  estimated_cost_usd: number;
}

export interface PipelineStep {
  agent: string;
  action: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
}

export interface AgentOutput {
  success: boolean;
  data: Record<string, unknown>;
  next_action?: string;
  error?: string;
}
