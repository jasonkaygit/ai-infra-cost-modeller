import type {
  Scenario,
  UsageDriver,
  CallVolumeResult,
} from "../domain/types";

/**
 * A UsageContext holds every resolved quantity a pricing rule might reference.
 * It is derived purely from a Scenario's profiles so that pricing rules stay
 * data-only and the engine never has to know how, say, GB-months are computed.
 */
export interface UsageContext {
  drivers: Record<UsageDriver, number>;
  volumes: CallVolumeResult;
  concurrencyProfile?: number[];
}

const GB_PER_MB = 1 / 1024;
const GB_PER_KB = 1 / (1024 * 1024);

/** Compute call volumes and concurrency from the scenario. */
export function computeVolumes(scenario: Scenario): CallVolumeResult {
  const { callProfile: cp, outcome } = scenario;
  const annual = Math.max(0, cp.annualIncomingCalls);

  // Clamp each percentage individually, then normalise so containment + escalation +
  // abandoned + failed never exceeds 100% of AI calls.
  let cr = clamp01(outcome.resolutionRate);
  let er = clamp01(outcome.escalationRate);
  let ar = clamp01(outcome.abandonedPercentage);
  let fr = clamp01(outcome.failedPercentage);
  const sum = cr + er + ar + fr;
  if (sum > 1) {
    cr /= sum;
    er /= sum;
    ar /= sum;
    fr /= sum;
  }

  const aiCalls = annual * clamp01(outcome.aiAdoptionPercentage);
  const resolvedCalls = aiCalls * cr;
  const escalatedCalls = aiCalls * er;
  const abandonedCalls = aiCalls * ar;
  const failedCalls = aiCalls * fr;

  // Residual human calls: calls never offered to AI, plus escalated + failed.
  const notOfferedToAi = annual - aiCalls;
  const residualHumanCalls = notOfferedToAi + escalatedCalls + failedCalls;

  // Concurrency via arrival-rate model.
  // Average simultaneous calls (Erlang traffic intensity) across the operating
  // window: calls/hour × avg handle time (hours).
  const callsPerOperatingDay =
    cp.operatingDaysPerYear > 0 ? annual / cp.operatingDaysPerYear : 0;
  const callsPerHour =
    cp.operatingHoursPerDay > 0 ? callsPerOperatingDay / cp.operatingHoursPerDay : 0;
  const avgHandleHours = cp.averageCallDurationMin / 60;
  const avgSimultaneousCalls = callsPerHour * avgHandleHours;

  // Peak concurrency: use 24-hour profile if provided, otherwise Erlang formula.
  let peakConcurrentCalls: number;
  if (cp.concurrencyProfile && cp.concurrencyProfile.length === 24) {
    peakConcurrentCalls = Math.max(...cp.concurrencyProfile);
  } else {
    const peakHourCalls =
      callsPerOperatingDay * clamp01(cp.peakHourCallPercentage);
    peakConcurrentCalls =
      peakHourCalls * avgHandleHours * Math.max(1, cp.peakToAverageMultiplier);
  }

  return {
    annualIncomingCalls: annual,
    aiCalls,
    resolvedCalls,
    escalatedCalls,
    abandonedCalls,
    failedCalls,
    residualHumanCalls,
    avgSimultaneousCalls,
    peakConcurrentCalls,
  };
}

/** Build the full driver table used by the pricing engine. */
export function buildUsageContext(
  scenario: Scenario,
  driverOverrides?: Partial<Record<UsageDriver, number>>
): UsageContext {
  const v = computeVolumes(scenario);
  const { aiUsage: ai, callProfile: cp, storage: st, evaluation: ev, outcome } = scenario;

  // Phased ramp: linear ramp from 0→100% over yearOneRampMonths.
  // Average monthly volume during ramp = S × N/2 (area under linear curve).
  // Post-ramp: S × (12-N). Total: S × (N/2 + 12 - N) = S × (12 - N/2).
  // rampFactor = (12 - N/2) / 12 = 1 - N/24.
  // N=0 (instant): 1.0; N=6: 0.75; N=12: 0.50.
  const rampMonths = Math.min(12, Math.max(0, cp.yearOneRampMonths ?? 0));
  const rampFactor = rampMonths > 0 ? (12 - rampMonths / 2) / 12 : 1;

  // Per-interaction token totals (an "interaction" == an AI call).
  const inputTokens = v.aiCalls * ai.avgInputTokensPerInteraction * ai.llmCallsPerConversation;
  const outputTokens = v.aiCalls * ai.avgOutputTokensPerInteraction * ai.llmCallsPerConversation;
  const reasoningTokens = v.aiCalls * ai.avgReasoningTokensPerInteraction * ai.llmCallsPerConversation;
  const totalTokens = inputTokens + outputTokens + reasoningTokens;

  // Keep duration assumptions simple and auditable: resolved AI calls consume the
  // full average call duration; escalations consume a shorter AI leg plus a human leg.
  const aiResolvedMin = cp.averageCallDurationMin;
  const aiHandoffMin = cp.averageCallDurationMin * 0.5;
  const humanHandoffMin = cp.averageCallDurationMin;

  // AI minutes: resolved calls spend full AI time; escalated/abandoned/failed
  // spend only the pre-handoff AI time.
  const aiMinutes =
    v.resolvedCalls * aiResolvedMin +
    (v.escalatedCalls + v.abandonedCalls + v.failedCalls) * aiHandoffMin;

  // Human minutes: AHT reduction applies only to escalated calls.
  // (residualHuman - escalated) = notOffered + failed → full duration, no AI benefit.
  const humanMinutes =
    (v.residualHumanCalls - v.escalatedCalls) * humanHandoffMin +
    v.escalatedCalls * humanHandoffMin * (1 - clamp01(outcome.ahtReductionAfterTransfer));

  // Telephony minutes: AI leg + human leg for escalated calls.
  const telephonyMinutes = aiMinutes + v.escalatedCalls * humanHandoffMin;

  // Storage GB-months (steady state): retained volume averaged over retention window.
  const audioGbPerCall = cp.averageCallDurationMin * st.audioMbPerMinute * GB_PER_MB;
  const transcriptGbPerCall = st.transcriptKbPerCall * GB_PER_KB;
  const logGbPerCall = st.logKbPerCall * GB_PER_KB;
  const traceGbPerCall = st.traceKbPerCall * GB_PER_KB;

  const audioGb = v.aiCalls * audioGbPerCall;
  const transcriptGb = v.aiCalls * transcriptGbPerCall;
  const logGb = v.annualIncomingCalls * logGbPerCall;
  const traceGb = v.aiCalls * traceGbPerCall;

  // Stored GB-months = annual volume produced × (retentionDays/30) averaged.
  // Steady-state stored volume ≈ dailyProduction × retentionDays.
  const dailyAudioGb = audioGb / 365;
  const dailyTranscriptGb = transcriptGb / 365;
  const dailyLogGb = logGb / 365;
  const dailyTraceGb = traceGb / 365;

  const storedGbMonths =
    (dailyAudioGb * st.audioRetentionDays +
      dailyTranscriptGb * st.transcriptRetentionDays +
      dailyLogGb * st.logsRetentionDays +
      dailyTraceGb * st.traceRetentionDays) *
    12; // 12 monthly billing periods per year

  const egressGb = (audioGb + transcriptGb) * clamp01(st.egressPercentage);

  // Evaluation.
  const evaluatedCalls = v.aiCalls * clamp01(ev.autoEvaluatedPercentage);
  const deepEvaluatedCalls = evaluatedCalls * clamp01(ev.deepEvaluatedPercentage);
  const evaluationTokens = evaluatedCalls * ev.tokensPerEvaluation;

  // Requests.
  const llmRequests = v.aiCalls * ai.llmCallsPerConversation;
  const toolCalls = v.aiCalls * ai.toolCallsPerConversation;
  const knowledgeSearches = v.aiCalls * ai.knowledgeSearchesPerConversation;
  const apiCalls = v.aiCalls * ai.apiCallsPerConversation;

  const drivers: Record<UsageDriver, number> = {
    ANNUAL_CALLS: v.annualIncomingCalls,
    AI_CALLS: v.aiCalls,
    RESOLVED_CALLS: v.resolvedCalls,
    ESCALATED_CALLS: v.escalatedCalls,
    AI_MINUTES: aiMinutes,
    AI_SECONDS: aiMinutes * 60,
    HUMAN_MINUTES: humanMinutes,
    TELEPHONY_MINUTES: telephonyMinutes,
    SESSIONS: v.aiCalls,
    INPUT_TOKENS: inputTokens,
    OUTPUT_TOKENS: outputTokens,
    TOTAL_TOKENS: totalTokens,
    REASONING_TOKENS: reasoningTokens,
    LLM_REQUESTS: llmRequests,
    TOOL_CALLS: toolCalls,
    KNOWLEDGE_SEARCHES: knowledgeSearches,
    API_CALLS: apiCalls,
    AUDIO_GB: audioGb,
    TRANSCRIPT_GB: transcriptGb,
    LOG_GB: logGb,
    TRACE_GB: traceGb,
    STORED_GB_MONTHS: storedGbMonths,
    EGRESS_GB: egressGb,
    EVALUATED_CALLS: evaluatedCalls,
    DEEP_EVALUATED_CALLS: deepEvaluatedCalls,
    EVALUATION_TOKENS: evaluationTokens,
    PEAK_CONCURRENCY: v.peakConcurrentCalls,
    COMPUTE_HOURS: aiMinutes / 60,
    PROVISIONED_MONTHS: 12,
    NONE: 1,
  };

  // Apply ramp factor to volume-dependent drivers. Excludes PEAK_CONCURRENCY
  // (infrastructure must be provisioned for steady-state peak from day 1),
  // PROVISIONED_MONTHS, and NONE.
  if (rampFactor < 1) {
    const volumeDrivers: UsageDriver[] = [
      "ANNUAL_CALLS", "AI_CALLS", "RESOLVED_CALLS", "ESCALATED_CALLS",
      "AI_MINUTES", "AI_SECONDS", "HUMAN_MINUTES", "TELEPHONY_MINUTES",
      "SESSIONS", "INPUT_TOKENS", "OUTPUT_TOKENS", "TOTAL_TOKENS", "REASONING_TOKENS",
      "LLM_REQUESTS", "TOOL_CALLS", "KNOWLEDGE_SEARCHES", "API_CALLS",
      "AUDIO_GB", "TRANSCRIPT_GB", "LOG_GB", "TRACE_GB",
      "STORED_GB_MONTHS", "EGRESS_GB",
      "EVALUATED_CALLS", "DEEP_EVALUATED_CALLS", "EVALUATION_TOKENS",
      "COMPUTE_HOURS",
    ];
    for (const driver of volumeDrivers) {
      drivers[driver] *= rampFactor;
    }
  }

  // Apply any manual overrides on top of computed driver values.
  if (driverOverrides) {
    for (const [key, val] of Object.entries(driverOverrides)) {
      if (val != null && key in drivers) {
        drivers[key as UsageDriver] = val;
      }
    }
  }

  return { drivers, volumes: v, concurrencyProfile: cp.concurrencyProfile };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
