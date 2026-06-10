export type Variant = 'A' | 'B' | 'C' | 'D' | 'E';
export type Intent  = 'high' | 'medium' | 'low' | 'none';

export interface ClassificationResult {
  variant:                Variant;
  intent:                 Intent;
  handoff:                boolean;
  reason:                 string;
  suggested_next_action:  string;
}

export interface ClassificationInput {
  linkedin_response: string;
  lead_name?:        string;
  company?:          string;
}

/** Full record persisted after classification */
export interface ClassifiedLead {
  input:      ClassificationInput;
  result:     ClassificationResult;
  model:      string;
  latency_ms: number;
  classified_at: string;
}
