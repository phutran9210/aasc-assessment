export type RuleOperator = 'eq' | 'in' | 'contains' | 'gte' | 'lte' | 'exists';
export type Predicate =
  | { field: string; op: 'exists' }
  | {
      field: string;
      op: Exclude<RuleOperator, 'exists'>;
      value: string | number | boolean | Array<string | number | boolean>;
    };
export type RuleCondition = Predicate | { all: RuleCondition[] } | { any: RuleCondition[] };

export type LeadRuleContext = Record<string, unknown>;
export type AssignmentPolicy = {
  strategy: 'fallback' | 'round_robin';
  fallback_sales_id: string;
  sales_ids: string[];
  campaign_rules?: Array<{ campaign_id: string; sales_id: string }>;
  city_rules?: Array<{ city: string; sales_id: string }>;
};
export type PipelinePolicy = {
  pipeline_id: number;
  stage_id: string;
  probability: number;
};
export type FeedbackPolicy = {
  enabled: boolean;
  events?: string[];
  event_mapping?: Partial<Record<'lead_qualified' | 'deal_created' | 'deal_won', string>>;
  matching_keys?: Array<'email' | 'phone' | 'ttclid'>;
  hash_email?: boolean;
  hash_phone?: boolean;
};
export type ReportingPolicy = { timezone: string };
export type AlertPolicy = { enabled: boolean };
export type ScorePolicy = {
  weights: {
    email: number;
    phone: number;
    form: number;
    interaction: number;
    budget: number;
    timeline: number;
  };
  interaction_window_days: number;
  interaction_points: number;
  interaction_cap: number;
  interaction_allowlist?: string[];
  // Form answers that earn the budget and timeline points. Without a list the component scores 0.
  budget_values?: string[];
  timeline_values?: string[];
};
export type ScoreInput = {
  email: string | null;
  phone_e164: string | null;
  form_complete: boolean;
  interactions: Array<{ event_id: string; occurred_at: string; event: string }>;
  budget_match: boolean;
  timeline_match: boolean;
};
export type ScoreResult = {
  total: number;
  breakdown: {
    email: number;
    phone: number;
    form: number;
    interaction: number;
    budget: number;
    timeline: number;
  };
  evaluatedAt: string;
};
export type RuleDefinition = {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition;
  action: 'create_deal';
  pipeline_id: number;
  stage_id: string;
  probability: number;
  assignment: { sales_id?: string };
};
export type RulesConfig = {
  schema_version: 1;
  auto_conversion: { enabled: boolean };
  manual_conversion: PipelinePolicy & { enabled: boolean; fallback_sales_id: string };
  stage_probabilities: PipelinePolicy[];
  assignment: AssignmentPolicy;
  quality_scoring: ScorePolicy;
  feedback: FeedbackPolicy;
  reporting: ReportingPolicy;
  alerts: AlertPolicy;
  rules: RuleDefinition[];
};
export type RuleMatch = { rule: RuleDefinition };
