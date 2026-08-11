import type { Currency } from "./money";

/* ============================================================================
 * TAXONOMY
 * ==========================================================================*/

export type CostCategory =
  | "VOICE_SERVICE"
  | "AI_AND_COMPUTE"
  | "TELEPHONY_AND_INTEGRATION"
  | "KNOWLEDGE"
  | "AUDIO_TRANSCRIPT_STORAGE"
  | "EVALUATION_AND_ASSURANCE"
  | "OPERATIONS_AND_OBSERVABILITY"
  | "DATA_AND_ANALYTICS"
  | "HUMAN_ESCALATION"
  | "FIXED_OPERATIONAL";

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  VOICE_SERVICE: "Voice Supplier",
  AI_AND_COMPUTE: "AI / LLM & Compute",
  TELEPHONY_AND_INTEGRATION: "Telephony & Integration",
  KNOWLEDGE: "Knowledge",
  AUDIO_TRANSCRIPT_STORAGE: "Storage",
  EVALUATION_AND_ASSURANCE: "Evaluation & Assurance",
  OPERATIONS_AND_OBSERVABILITY: "Observability",
  DATA_AND_ANALYTICS: "Data & Analytics",
  HUMAN_ESCALATION: "Human Escalation",
  FIXED_OPERATIONAL: "Operational Costs",
};

/** Ordered category list used for waterfall display. */
export const WATERFALL_ORDER: CostCategory[] = [
  "VOICE_SERVICE",
  "TELEPHONY_AND_INTEGRATION",
  "AI_AND_COMPUTE",
  "KNOWLEDGE",
  "AUDIO_TRANSCRIPT_STORAGE",
  "EVALUATION_AND_ASSURANCE",
  "OPERATIONS_AND_OBSERVABILITY",
  "DATA_AND_ANALYTICS",
  "HUMAN_ESCALATION",
  "FIXED_OPERATIONAL",
];

/* ============================================================================
 * PRICING MODELS
 * ==========================================================================*/

export type PricingModel =
  | "FIXED_MONTHLY"
  | "FIXED_ANNUAL"
  | "ONE_OFF"
  | "PER_CALL"
  | "PER_SESSION"
  | "PER_MINUTE"
  | "PER_SECOND"
  | "PER_REQUEST"
  | "PER_API_CALL"
  | "PER_1000_REQUESTS"
  | "PER_GB"
  | "PER_GB_MONTH"
  | "PER_GB_TRANSFERRED"
  | "PER_TOKEN"
  | "PER_1000_TOKENS"
  | "PER_1000000_TOKENS"
  | "INPUT_OUTPUT_TOKENS"
  | "HOURLY_COMPUTE"
  | "PROVISIONED_INSTANCE"
  | "CONCURRENT_SESSION"
  | "TIERED_DURATION"
  | "TIERED_VOLUME"
  | "MIN_MONTHLY_COMMITMENT"
  | "BUNDLED_ALLOWANCE"
  | "STEPPED_INFRASTRUCTURE"
  | "PERCENT_OF_TRAFFIC"
  | "SAMPLED_ACTIVITY";

/**
 * A usage driver names the quantity the engine multiplies a unit price by.
 * These are resolved against a UsageContext at calculation time so that the
 * pricing rules stay pure data.
 */
export type UsageDriver =
  | "ANNUAL_CALLS"
  | "AI_CALLS"
  | "RESOLVED_CALLS"
  | "ESCALATED_CALLS"
  | "AI_MINUTES"
  | "AI_SECONDS"
  | "HUMAN_MINUTES"
  | "TELEPHONY_MINUTES"
  | "SESSIONS"
  | "INPUT_TOKENS"
  | "OUTPUT_TOKENS"
  | "TOTAL_TOKENS"
  | "REASONING_TOKENS"
  | "LLM_REQUESTS"
  | "TOOL_CALLS"
  | "KNOWLEDGE_SEARCHES"
  | "API_CALLS"
  | "AUDIO_GB"
  | "TRANSCRIPT_GB"
  | "LOG_GB"
  | "TRACE_GB"
  | "STORED_GB_MONTHS"
  | "EGRESS_GB"
  | "EVALUATED_CALLS"
  | "DEEP_EVALUATED_CALLS"
  | "EVALUATION_TOKENS"
  | "PEAK_CONCURRENCY"
  | "COMPUTE_HOURS"
  | "PROVISIONED_MONTHS"
  | "NONE"; // for fixed / one-off costs

export type FixedVariableClass =
  | "ONE_OFF"
  | "FIXED"
  | "SEMI_VARIABLE"
  | "VARIABLE"
  | "STEPPED";

export type Environment = "PROD" | "NON_PROD" | "SHARED";

export type Frequency = "MONTHLY" | "ANNUAL" | "ONE_OFF";

/* ============================================================================
 * PRICING RULE + TIERS + SCALING
 * ==========================================================================*/

export interface PricingTier {
  /** inclusive lower bound of driver units this tier applies from */
  readonly upTo: number | null; // null == unbounded (final tier)
  /** unit price within this tier, in currency units (not micros) */
  readonly unitPrice: number;
  readonly label?: string;
}

/**
 * Capacity/stepped scaling: one "unit" (e.g. an EKS node, EC2 instance,
 * LiveKit worker) supports `capacityPerUnit` of the capacity driver. The engine
 * computes ceil(demand / capacityPerUnit) units and multiplies by unitPrice.
 */
export interface ScalingRule {
  readonly capacityDriver: UsageDriver; // e.g. PEAK_CONCURRENCY
  readonly capacityPerUnit: number; // sessions per node, etc.
  readonly minUnits: number;
  readonly maxUnits: number | null;
  /** Set to bypass capacity calculation and force an exact unit count. */
  readonly manualUnits?: number;
}

export interface PricingRule {
  readonly model: PricingModel;
  /** price per pricing unit, in currency units (not micros) */
  readonly unitPrice: number;
  readonly currency: Currency;
  /** human-readable unit, e.g. "per 1,000 tokens" */
  readonly pricingUnit: string;
  /** for INPUT_OUTPUT_TOKENS model */
  readonly inputUnitPrice?: number;
  readonly outputUnitPrice?: number;
  /** tiers for TIERED_* models, ordered ascending by upTo */
  readonly tiers?: PricingTier[];
  /** capacity/stepped scaling for infrastructure */
  readonly scaling?: ScalingRule;
  /** minimum monthly commitment in currency units */
  readonly minMonthlyCommitment?: number;
  /** bundled allowance included before charging (in driver units, per month) */
  readonly bundledAllowance?: number;
  /** maximum billable allowance (cap) in driver units per period */
  readonly maxAllowance?: number;
  /** for PERCENT_OF_TRAFFIC / SAMPLED_ACTIVITY: fraction 0..1 */
  readonly samplingFraction?: number;
}

/* ============================================================================
 * COST COMPONENT
 * ==========================================================================*/

export interface CostComponent {
  readonly id: string;
  readonly category: CostCategory;
  readonly provider: string;
  readonly service: string;
  readonly description: string;
  readonly usageDriver: UsageDriver;
  readonly classification: FixedVariableClass;
  readonly environment: Environment;
  readonly frequency: Frequency;
  readonly pricing: PricingRule;
  readonly assumptions: string;
  readonly enabled: boolean;
  /** true if this component is sample/illustrative pricing */
  readonly sampleData: boolean;
}

/* ============================================================================
 * SUPPLIER
 * ==========================================================================*/

export interface Supplier {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** components specific to this supplier (voice platform pricing etc.) */
  readonly componentIds: string[];
  readonly sampleData: boolean;
}

/* ============================================================================
 * PROFILES (INPUTS)
 * ==========================================================================*/

export interface CallProfile {
  annualIncomingCalls: number;
  operatingDaysPerYear: number;
  operatingHoursPerDay: number;
  averageCallDurationMin: number;
  aiDurationBeforeContainmentMin: number;
  aiDurationBeforeEscalationMin: number;
  humanDurationAfterEscalationMin: number;
  peakHourCallPercentage: number; // fraction of daily calls in peak hour, 0..1
  peakToAverageMultiplier: number;
  /** Months to ramp from 0→100% of steady-state volume. 0 = instant.  */
  yearOneRampMonths: number;
  /** 24-hour concurrency profile (hour 0–23). If provided, max(profile) replaces
   * the Erlang formula for PEAK_CONCURRENCY. */
  concurrencyProfile?: number[];
}

export interface AIUsageProfile {
  avgInputTokensPerInteraction: number;
  avgOutputTokensPerInteraction: number;
  avgReasoningTokensPerInteraction: number;
  llmCallsPerConversation: number;
  toolCallsPerConversation: number;
  knowledgeSearchesPerConversation: number;
  apiCallsPerConversation: number;
}

export interface HumanContactCentreBaseline {
  mode: "WORKFORCE" | "SIMPLE_COST_PER_CONTACT";
  // workforce modelling
  numberOfAgents: number;
  fullyLoadedAgentAnnualCost: number;
  currentAverageHandleTimeMin: number;
  occupancy: number; // 0..1
  // simple mode
  simpleCurrentCostPerContact: number;
  currentAnnualCallVolume: number;
}

export interface StorageProfile {
  audioMbPerMinute: number;
  transcriptKbPerCall: number;
  logKbPerCall: number;
  traceKbPerCall: number;
  audioRetentionDays: number;
  transcriptRetentionDays: number;
  logsRetentionDays: number;
  traceRetentionDays: number;
  archiveRetentionDays: number;
  retrievalPercentage: number; // 0..1
  egressPercentage: number; // 0..1
}

export interface EvaluationProfile {
  autoEvaluatedPercentage: number; // 0..1
  deepEvaluatedPercentage: number; // 0..1 (subset of auto)
  tokensPerEvaluation: number;
  evaluationStorageKbPerCall: number;
}

export interface AIOutcomeModel {
  aiAdoptionPercentage: number; // fraction of calls offered to AI, 0..1
  resolutionRate: number; // 0..1 of AI calls fully resolved by AI
  escalationRate: number; // 0..1 of AI calls escalated (containment+escalation<=1)
  abandonedPercentage: number; // 0..1 of AI calls abandoned
  failedPercentage: number; // 0..1 of AI calls failed
  /** does AI pre-processing reduce human AHT after transfer? */
  ahtReductionAfterTransfer: number; // 0..1 reduction applied to human duration
}

/* ============================================================================
 * SCENARIO
 * ==========================================================================*/

export type ScenarioMode =
  | "BUDGET_LED"
  | "VOLUME_LED"
  | "ROI_LED"
  | "TARGET_SAVINGS"
  | "CAPACITY"
  | "SUPPLIER_COMPARISON";

export interface Scenario {
  id: string;
  name: string;
  mode: ScenarioMode;
  supplierId: string;
  currency: Currency;
  callProfile: CallProfile;
  aiUsage: AIUsageProfile;
  baseline: HumanContactCentreBaseline;
  storage: StorageProfile;
  evaluation: EvaluationProfile;
  outcome: AIOutcomeModel;
  /** mode-specific targets */
  budget?: number;
  targetSaving?: number;
  targetPeakConcurrency?: number;
  /** one-off investment for ROI (implementation, integration, etc.) */
  investment: number;
  /** DR overhead as percentage of infrastructure cost (0 = no DR, 40 = warm standby, 60 = hot standby) */
  drOverheadPct: number;
  /** component enable/disable overrides by id */
  disabledComponentIds: string[];
  createdAt: string;
  updatedAt: string;
}

/* ============================================================================
 * RESULTS
 * ==========================================================================*/

export interface ComponentCostLine {
  componentId: string;
  category: CostCategory;
  provider: string;
  service: string;
  classification: FixedVariableClass;
  /** annual cost in currency units */
  annualCost: number;
  /** cost per incoming call in currency units */
  perCall: number;
  /** the resolved usage quantity that drove this cost */
  usageQuantity: number;
  usageDriver: UsageDriver;
  /** human-readable calculation trace */
  trace: string;
}

export interface CategoryCost {
  category: CostCategory;
  annualCost: number;
  perCall: number;
}

export interface CostBreakdown {
  lines: ComponentCostLine[];
  byCategory: CategoryCost[];
  byClassification: Record<FixedVariableClass, number>;
  totalAnnual: number;
  fixedAnnual: number;
  variableAnnual: number;
  semiVariableAnnual: number;
  steppedAnnual: number;
  oneOffAnnual: number;
}

export interface CallVolumeResult {
  annualIncomingCalls: number;
  aiCalls: number;
  resolvedCalls: number;
  escalatedCalls: number;
  abandonedCalls: number;
  failedCalls: number;
  residualHumanCalls: number; // never-offered-to-AI + escalated + failed
  avgSimultaneousCalls: number;
  peakConcurrentCalls: number;
}

export interface ROIResult {
  baselineAnnualCost: number;
  futureAnnualOperatingCost: number;
  investment: number;
  grossAvoidedCost: number;
  netBenefit: number;
  roiPercentage: number;
  paybackPeriodYears: number;
  breakEvenCallVolume: number;
}

export interface MarginalCostResult {
  nextOneCall: number;
  nextThousandCalls: number;
  nextMillionCalls: number;
}

export interface Customer {
  id: string;
  name: string;
  scenarioId: string;
  concurrencyProfile?: number[];
}

export interface ScenarioResult {
  scenarioId: string;
  currency: Currency;
  volumes: CallVolumeResult;
  breakdown: CostBreakdown;
  roi: ROIResult;
  marginal: MarginalCostResult;
  costPerIncomingCall: number;
  costPerAiCall: number;
  costPerResolvedCall: number;
  costPerAiMinute: number;
  costPerTelephonyMinute: number;
  /** mode-specific extras keyed by name */
  modeExtras: Record<string, number>;
}
